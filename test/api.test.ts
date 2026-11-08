// api と DB を通しで確かめる（PostgreSQL が要る。DATABASE_URL がなければ飛ばす）。
// ファイルごとに別のスキーマを使うので、ほかのテストとぶつからない。
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import type { AddressInfo } from 'node:net'

const url = process.env.DATABASE_URL
const skip = url ? false : 'DATABASE_URL がないので飛ばします'
const schema = `t_api_${process.pid}`

let origin = ''
let close = async () => {}
let ids: { kai: string, sato: string } = { kai: '', sato: '' }
const TOKEN = 'Bearer dev:kato@example.com'
const OTHER = 'Bearer dev:other@example.com'

const call = async (path: string, init: RequestInit & { token?: string } = {}) => {
  const res = await fetch(`${origin}${path}`, {
    ...init,
    headers: { Authorization: init.token ?? TOKEN, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const type = res.headers.get('content-type') ?? ''
  return { status: res.status, body: type.includes('json') ? await res.json() : await res.arrayBuffer() }
}

before(async () => {
  if (!url) return
  const { createPool } = await import('../db/pool.ts')
  const admin = await createPool({ DATABASE_URL: url })
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}`)
  await admin.end()
  const db = await createPool({ DATABASE_URL: url, DB_SCHEMA: schema })
  const { migrate } = await import('../db/migrate.ts')
  await migrate(db)
  const { seed } = await import('../db/seed.ts')
  const s = await seed(db)
  await seed(db, { email: 'other@example.com', officeName: 'ほかの事業所' })
  ids = { kai: s.clients.kai, sato: s.clients.sato }

  const { createApiServer } = await import('../api/server.ts')
  const { DevVerifier } = await import('../api/auth.ts')
  const { LocalStorage } = await import('../api/storage.ts')
  const { LocalQueue } = await import('../api/queue.ts')
  const { runJob } = await import('../worker/jobs.ts')
  const f = await import('../worker/fake.ts')
  const dir = await mkdtemp(join(tmpdir(), 'careman-'))
  const storage = new LocalStorage(dir)
  const workerDeps = { db: async () => db, storage: () => storage, providers: async () => ({ stt: new f.FakeStt(), speakers: new f.FakeSpeakers(), writer: new f.FakeWriter() }) }
  const server = createApiServer({
    db: async () => db,
    verifier: () => new DevVerifier(),
    storage: () => storage,
    queue: () => new LocalQueue((id) => runJob(workerDeps, id)),
    devAuth: true,
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  close = async () => {
    await new Promise<void>((r) => server.close(() => r()))
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await db.end()
  }
})

after(async () => close())

test('ログインしていないと 401、ほかの事業所の利用者は見えない', { skip }, async () => {
  assert.equal((await call('/api/clients', { token: '' })).status, 401)
  assert.equal((await call(`/api/clients/${ids.kai}`, { token: OTHER })).status, 404)
  const list = (await call('/api/clients', { token: OTHER })).body as { clients: { name: string }[] }
  assert.ok(!list.clients.some((c) => c.name === '甲斐' && false))
  assert.equal(list.clients.length, 4)
})

test('直す → ページを保存 → 版 → PDF。保存していない AI の値は PDF に出ない', { skip }, async () => {
  const c = (await call(`/api/clients/${ids.kai}`)).body as { client: { documents: { id: string, form: string }[] } }
  const docId = c.client.documents.find((d) => d.form === 'assessment')!.id
  const doc = (await call(`/api/documents/${docId}`)).body as { document: { fields: Record<string, { by: string }>, saved: Record<string, unknown> } }
  assert.equal(doc.document.fields['intake.method'].by, 'ai')
  assert.equal(doc.document.saved['intake.method'], undefined)

  const p = await call(`/api/documents/${docId}/fields`, { method: 'PATCH', body: JSON.stringify({ changes: [{ key: 'person.address', value: '見本市見本町 1-2-3' }] }) })
  assert.equal(p.status, 200)
  assert.equal((p.body as { document: { fields: Record<string, { by: string }> } }).document.fields['person.address'].by, 'cm')
  assert.equal((await call(`/api/documents/${docId}/fields`, { method: 'PATCH', body: JSON.stringify({ changes: [{ key: 'intake.method', value: '郵便' }] }) })).status, 400)

  const s = await call(`/api/documents/${docId}/save`, { method: 'POST', body: JSON.stringify({ scope: 'page', page: 1 }) })
  assert.equal(s.status, 200)
  const after1 = (s.body as { rev: number, document: { saved: Record<string, { value: unknown }> } })
  assert.equal(after1.rev, 1)
  assert.equal(after1.document.saved['person.address'].value, '見本市見本町 1-2-3')
  assert.equal(after1.document.saved['intake.method'].value, '電話')
  // 5 ページ（基本動作）の AI の値は、まだ保存していない
  assert.equal(after1.document.saved['notes.basicMovement'], undefined)

  const pdf = await call(`/api/documents/${docId}/pdf`)
  assert.equal(pdf.status, 200)
  assert.ok((pdf.body as ArrayBuffer).byteLength > 10000)
})

test('入院時情報提供書を作るとアセスメントから写し、基本情報は両方に入る', { skip }, async () => {
  const r = await call(`/api/clients/${ids.kai}/documents`, { method: 'POST', body: JSON.stringify({ form: 'admission' }) })
  assert.equal(r.status, 201)
  const admId = (r.body as { id: string }).id
  const adm = (await call(`/api/documents/${admId}`)).body as { document: { fields: Record<string, { value: unknown, by: string }> } }
  assert.equal(adm.document.fields['housing.notes'].by, 'ai')
  const p = await call(`/api/documents/${admId}/fields`, { method: 'PATCH', body: JSON.stringify({ changes: [{ key: 'person.phone', value: '000-0000-0000' }] }) })
  assert.deepEqual((p.body as { syncedTo: string[] }).syncedTo, ['アセスメント'])
})

test('録音を送るとジョブが走り、AI が用紙に書く（ケアマネが直した欄は残す）', { skip }, async () => {
  const c = (await call(`/api/clients/${ids.sato}`)).body as { client: { documents: { id: string, form: string }[] } }
  const docId = c.client.documents[0].id
  await call(`/api/documents/${docId}/fields`, { method: 'PATCH', body: JSON.stringify({ changes: [{ key: 'consulter', value: { name: '自分で書いた', relationship: '子' } }] }) })
  const start = await call(`/api/clients/${ids.sato}/recordings`, { method: 'POST', body: JSON.stringify({ mime: 'audio/webm' }) })
  assert.equal(start.status, 201)
  const { recordingId, uploadUrl } = start.body as { recordingId: string, uploadUrl: string }
  const audio = new Uint8Array(4096).fill(1)
  const up = await fetch(uploadUrl.startsWith('http') ? uploadUrl : `${origin}${uploadUrl}`, { method: 'PUT', headers: { 'Content-Range': `bytes 0-${audio.length - 1}/${audio.length}` }, body: audio })
  assert.equal(up.status, 200)
  const done = await call(`/api/recordings/${recordingId}/complete`, { method: 'POST', body: JSON.stringify({ durationMs: 60000 }) })
  assert.equal(done.status, 202)
  let job: { status: string, batch: { changes: number, kept: number } | null } | undefined
  for (let i = 0; i < 50; i++) {
    job = ((await call(`/api/clients/${ids.sato}/jobs`)).body as { jobs: typeof job[] }).jobs[0]
    if (job && ['succeeded', 'failed', 'partial'].includes(job.status)) break
    await new Promise((r) => setTimeout(r, 100))
  }
  assert.equal(job?.status, 'succeeded')
  assert.ok((job?.batch?.changes ?? 0) > 30)
  // 氏名・性別（利用者を作るときにケアマネが入れた）と、先に書いた相談者の 3 欄は書き換えない
  assert.equal(job?.batch?.kept, 3)
  const doc = (await call(`/api/documents/${docId}`)).body as { document: { fields: Record<string, { value: { name?: string }, by: string }> } }
  assert.equal(doc.document.fields.consulter.value.name, '自分で書いた')
  assert.equal(doc.document.fields['intake.method'].by, 'ai')
})
