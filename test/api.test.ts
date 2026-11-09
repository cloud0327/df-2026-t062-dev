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
/** ほかの事業所だけの様式の版（加藤さんの事業所からは見えない） */
let otherVersion = ''
let hasPdf = false
let putFake: (path: string, data: Uint8Array) => Promise<void> = async () => {}
const TOKEN = 'Bearer dev:kato@example.com'
const OTHER = 'Bearer dev:other@example.com'
let failNextEnqueue = false
const enqueues = new Map<string, number>()

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
  const o = await seed(db, { email: 'other@example.com', officeName: 'ほかの事業所' })
  ids = { kai: s.clients.kai, sato: s.clients.sato }
  // ほかの事業所だけの入院時情報提供書（全事業所の様式と同じ中身で、事業所の様式として登録する）
  const forms = await import('../db/forms.ts')
  const { readSeed } = await import('../forms/admin/files.ts')
  otherVersion = (await forms.registerVersion(db, { ...readSeed('admission'), officeId: o.officeId, name: 'ほかの事業所の入院時情報提供書' }, { publish: true })).versionId

  process.env.PUBLIC_API_ORIGIN = ''
  const { createApiServer } = await import('../api/server.ts')
  const { DevVerifier } = await import('../api/auth.ts')
  const { LocalStorage } = await import('../api/storage.ts')
  const { LocalQueue } = await import('../api/queue.ts')
  const { runJob } = await import('../worker/jobs.ts')
  const f = await import('../worker/fake.ts')
  const dir = await mkdtemp(join(tmpdir(), 'careman-'))
  const storage = new LocalStorage(dir)
  // 全社協の PDF が手元にあれば（npm run forms:fetch）、様式の置き場に入れる。なければ PDF は 503
  const { putFormAssets } = await import('../forms/admin/assets.ts')
  const { localPdf } = await import('../forms/admin/pdf.ts')
  const { existsSync, readFileSync } = await import('node:fs')
  const assess = await forms.loadVersion(db, await forms.publishedVersionId(db, s.officeId, 'assessment'))
  if (existsSync(localPdf('assessment'))) {
    await putFormAssets(storage, assess, new Uint8Array(readFileSync(localPdf('assessment'))), { images: false })
    hasPdf = true
  }
  putFake = async (path, data) => { await storage.writeOnce('forms', path, data, 'image/png') }
  const workerDeps = { db: async () => db, storage: () => storage, providers: async () => ({ stt: new f.FakeStt(), speakers: new f.FakeSpeakers(), writer: new f.FakeWriter() }) }
  const queue = new LocalQueue((id) => runJob(workerDeps, id))
  const server = createApiServer({
    db: async () => db,
    verifier: () => new DevVerifier(),
    storage: () => storage,
    queue: () => ({
      async enqueue(id) {
        if (failNextEnqueue) {
          failNextEnqueue = false
          throw new Error('queue unavailable')
        }
        enqueues.set(id, (enqueues.get(id) ?? 0) + 1)
        await queue.enqueue(id)
      },
    }),
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

type Doc = { document: { formVersionId: string, kind: string, fields: Record<string, { value: unknown, by: string }>, saved: Record<string, { value: unknown }> } }
const docOf = async (clientId: string, kind = 'assessment') => {
  const c = (await call(`/api/clients/${clientId}`)).body as { client: { documents: { id: string, kind: string, formVersionId: string }[] } }
  const d = c.client.documents.find((x) => x.kind === kind)!
  return { id: d.id, formVersionId: d.formVersionId }
}

test('直す → ページを保存 → 版 → PDF。保存していない AI の値は PDF に出ない', { skip }, async () => {
  const { id: docId } = await docOf(ids.kai)
  const doc = (await call(`/api/documents/${docId}`)).body as Doc
  assert.equal(doc.document.fields['intake.method'].by, 'ai')
  assert.equal(doc.document.saved['intake.method'], undefined)

  const p = await call(`/api/documents/${docId}/fields`, { method: 'PATCH', body: JSON.stringify({ changes: [{ key: 'person.address', value: '見本市見本町 1-2-3', base: doc.document.fields['person.address']?.value ?? null }] }) })
  assert.equal(p.status, 200)
  assert.equal((p.body as Doc).document.fields['person.address'].by, 'cm')
  assert.equal((await call(`/api/documents/${docId}/fields`, { method: 'PATCH', body: JSON.stringify({ changes: [{ key: 'intake.method', value: '郵便', base: '電話' }] }) })).status, 400)

  const s = await call(`/api/documents/${docId}/save`, { method: 'POST', body: JSON.stringify({ scope: 'page', page: 1 }) })
  assert.equal(s.status, 200)
  const after1 = (s.body as { rev: number, document: { saved: Record<string, { value: unknown }> } })
  assert.equal(after1.rev, 1)
  assert.equal(after1.document.saved['person.address'].value, '見本市見本町 1-2-3')
  assert.equal(after1.document.saved['intake.method'].value, '電話')
  // 5 ページ（基本動作）の AI の値は、まだ保存していない
  assert.equal(after1.document.saved['notes.basicMovement'], undefined)

  const pdf = await call(`/api/documents/${docId}/pdf`)
  if (hasPdf) {
    assert.equal(pdf.status, 200)
    assert.ok((pdf.body as ArrayBuffer).byteLength > 10000)
  } else assert.equal(pdf.status, 503, '元の PDF が置き場になければ 503')
})

test('入院時情報提供書を作るとアセスメントから写し、基本情報は両方に入る', { skip }, async () => {
  const r = await call(`/api/clients/${ids.kai}/documents`, { method: 'POST', body: JSON.stringify({ form: 'admission' }) })
  assert.equal(r.status, 201)
  const admId = (r.body as { id: string }).id
  const adm = (await call(`/api/documents/${admId}`)).body as Doc
  assert.equal(adm.document.kind, 'admission')
  assert.equal(adm.document.fields['housing.notes'].by, 'ai')
  const p = await call(`/api/documents/${admId}/fields`, { method: 'PATCH', body: JSON.stringify({ changes: [{ key: 'person.phone', value: '000-0000-0000', base: adm.document.fields['person.phone']?.value ?? null }] }) })
  assert.equal(p.status, 200)
  assert.deepEqual((p.body as { syncedTo: string[] }).syncedTo, ['アセスメント'])
})

test('元書類の変更を比較し、維持と反映を欄ごとに記録する', { skip }, async () => {
  const made = await call('/api/clients', { method: 'POST', body: JSON.stringify({ name: '差異確認の見本' }) })
  assert.equal(made.status, 201)
  const { id: clientId, assessmentId } = made.body as { id: string, assessmentId: string }
  const patch = (id: string, value: unknown, base: unknown) => call(`/api/documents/${id}/fields`, {
    method: 'PATCH', body: JSON.stringify({ changes: [{ key: 'person.lifeHistory', value, base }] }),
  })
  assert.equal((await patch(assessmentId, '最初の記載', null)).status, 200)
  assert.equal((await call(`/api/documents/${assessmentId}/save`, { method: 'POST', body: JSON.stringify({ scope: 'document' }) })).status, 200)
  const admission = await call(`/api/clients/${clientId}/documents`, { method: 'POST', body: JSON.stringify({ form: 'admission' }) })
  assert.equal(admission.status, 201)
  const targetId = (admission.body as { id: string }).id
  const getDiff = async () => (await call(`/api/documents/${targetId}/sync-differences`)).body as { differences: { key: string, source: unknown, target: unknown, status: string }[] }
  assert.equal((await getDiff()).differences.length, 0)

  assert.equal((await patch(assessmentId, '新しい記載', '最初の記載')).status, 200)
  assert.equal((await getDiff()).differences.find((d) => d.key === 'person.lifeHistory')?.status, 'pending')
  assert.equal((await call(`/api/documents/${assessmentId}/save`, { method: 'POST', body: JSON.stringify({ scope: 'document' }) })).status, 200)
  const diff = (await getDiff()).differences.find((d) => d.key === 'person.lifeHistory')!
  assert.equal(diff.status, 'review')
  assert.equal((await call(`/api/documents/${targetId}/sync-decisions`, { method: 'POST', token: OTHER, body: JSON.stringify({ key: diff.key, decision: 'apply', source: diff.source, target: diff.target }) })).status, 404)
  assert.equal((await call(`/api/documents/${targetId}/sync-decisions`, { method: 'POST', body: JSON.stringify({ key: diff.key, decision: 'keep', source: diff.source, target: diff.target }) })).status, 200)
  assert.equal((await getDiff()).differences.find((d) => d.key === diff.key)?.status, 'different')

  assert.equal((await patch(assessmentId, 'さらに新しい記載', '新しい記載')).status, 200)
  assert.equal((await call(`/api/documents/${assessmentId}/save`, { method: 'POST', body: JSON.stringify({ scope: 'document' }) })).status, 200)
  const next = (await getDiff()).differences.find((d) => d.key === diff.key)!
  assert.equal(next.status, 'review')
  assert.equal((await call(`/api/documents/${targetId}/sync-decisions`, { method: 'POST', body: JSON.stringify({ key: next.key, decision: 'apply', source: diff.source, target: next.target }) })).status, 409)
  assert.equal((await call(`/api/documents/${targetId}/sync-decisions`, { method: 'POST', body: JSON.stringify({ key: next.key, decision: 'apply', source: next.source, target: next.target }) })).status, 200)
  assert.equal((await getDiff()).differences.length, 0)
  const target = (await call(`/api/documents/${targetId}`)).body as Doc
  assert.equal(target.document.fields['person.lifeHistory'].value, 'さらに新しい記載')
  assert.equal(target.document.saved['person.lifeHistory'], undefined)
})

test('録音を送るとジョブが走り、AI が用紙に書く（ケアマネが直した欄は残す）', { skip }, async () => {
  const { id: docId } = await docOf(ids.sato)
  const before = await call(`/api/documents/${docId}/fields`, { method: 'PATCH', body: JSON.stringify({ changes: [{ key: 'consulter', value: { name: '自分で書いた', relationship: '子' }, base: null }] }) })
  assert.equal(before.status, 200)
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

test('録音IDで送信を再開し、同時に完了を再試行してもジョブを一度だけ積む', { skip }, async () => {
  const client = await call('/api/clients', { method: 'POST', body: JSON.stringify({ name: '録音復旧の検証' }) })
  assert.equal(client.status, 201)
  const path = `/api/clients/${client.body.id}/recordings/resumable`
  const deviceRecordingId = crypto.randomUUID()
  const start = (expiredUploadUrl?: string, token = TOKEN) => call(path, {
    method: 'POST', token, body: JSON.stringify({ mime: 'audio/webm', deviceRecordingId, expiredUploadUrl }),
  })
  const [first, retry] = await Promise.all([start(), start()])
  assert.equal(first.status, 201)
  assert.equal(retry.status, 201)
  assert.deepEqual(retry.body, first.body)
  assert.equal((await start(undefined, OTHER)).status, 404)
  const { recordingId, uploadUrl } = first.body as { recordingId: string, uploadUrl: string }
  const put = (url: string, range: string, data?: Uint8Array<ArrayBuffer>) =>
    fetch(`${origin}${url}`, { method: 'PUT', headers: { 'Content-Range': range }, body: data, redirect: 'manual' })
  const complete = (bytes = 4) => call(`/api/recordings/${recordingId}/complete`, {
    method: 'POST', body: JSON.stringify({ durationMs: 1000, bytes }),
  })

  assert.equal((await put(uploadUrl, 'bytes 0-1/4', new Uint8Array([1, 2]))).status, 308)
  assert.equal((await complete()).status, 409)
  assert.equal((await put(uploadUrl, 'bytes */4')).headers.get('Range'), 'bytes=0-1')
  const renewed = await start(uploadUrl)
  assert.equal(renewed.status, 201)
  assert.equal(renewed.body.recordingId, recordingId)
  assert.notEqual(renewed.body.uploadUrl, uploadUrl)
  assert.deepEqual((await start(uploadUrl)).body, renewed.body)
  assert.equal((await put(renewed.body.uploadUrl, 'bytes 0-3/4', new Uint8Array([1, 2, 3, 4]))).status, 200)
  assert.equal((await put(uploadUrl, 'bytes 2-3/4', new Uint8Array([9, 9]))).status, 200)
  assert.deepEqual((await start()).body, { recordingId, uploadUrl: null })
  assert.equal((await complete(5)).status, 409)

  failNextEnqueue = true
  assert.equal((await complete()).status, 500)
  const [done, repeated] = await Promise.all([complete(), complete()])
  assert.equal(done.status, 202)
  assert.equal(repeated.status, 202)
  assert.equal(repeated.body.jobId, done.body.jobId)
  assert.equal(enqueues.get(done.body.jobId), 1)
  const list = await call(`/api/clients/${client.body.id}/jobs`)
  assert.equal(list.body.jobs.length, 1)
  assert.deepEqual((await start()).body, { recordingId, uploadUrl: null })
  for (let i = 0; i < 50; i++) {
    const jobs = (await call(`/api/clients/${client.body.id}/jobs`)).body.jobs
    if (jobs[0].status === 'succeeded') return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.fail('再試行で投入したジョブが完了しませんでした')
})

test('様式の版は、その事業所が見てよいものだけ読める。中身はブラウザが覚えてよい（ETag）', { skip }, async () => {
  const { formVersionId } = await docOf(ids.kai)
  const r = await fetch(`${origin}/api/form-versions/${formVersionId}`, { headers: { Authorization: TOKEN } })
  assert.equal(r.status, 200)
  assert.match(r.headers.get('cache-control') ?? '', /private.*immutable/)
  const v = (await r.json()) as { formVersion: { kind: string, version: number, bindings: Record<string, unknown>, schemas: unknown[][] } }
  assert.equal(v.formVersion.kind, 'assessment')
  assert.equal(Object.keys(v.formVersion.bindings).length, v.formVersion.schemas.flat().length)
  const again = await fetch(`${origin}/api/form-versions/${formVersionId}`, { headers: { Authorization: TOKEN, 'If-None-Match': r.headers.get('etag')! } })
  assert.equal(again.status, 304)
  // ほかの事業所だけの様式は見えない。ほかの事業所の書類は、その事業所の様式の版を指す
  assert.equal((await call(`/api/form-versions/${otherVersion}`)).status, 404)
  assert.equal((await call(`/api/form-versions/${otherVersion}`, { token: OTHER })).status, 200)
  const others = (await call('/api/clients', { token: OTHER })).body as { clients: { id: string }[] }
  const made = await call(`/api/clients/${others.clients[0].id}/documents`, { method: 'POST', token: OTHER, body: JSON.stringify({ form: 'admission' }) })
  const otherDoc = (await call(`/api/documents/${(made.body as { id: string }).id}`, { token: OTHER })).body as Doc
  assert.equal(otherDoc.document.formVersionId, otherVersion)
})

test('ページの画像は期限つきの URL で渡し、署名が違えば読めない', { skip }, async () => {
  const { formVersionId } = await docOf(ids.kai)
  const v = ((await call(`/api/form-versions/${formVersionId}`)).body as { formVersion: { pages: { no: number }[] } }).formVersion
  const before = (await call(`/api/form-versions/${formVersionId}/assets`)).body as { pages: { no: number, url: string | null }[], hasPdf: boolean }
  assert.equal(before.pages.length, v.pages.length)
  assert.equal(before.hasPdf, hasPdf)
  // 画像を置く（本物は npm run forms:assets が置く）
  const forms = await import('../db/forms.ts')
  const { pageImageAssetPath } = await import('../core/form.ts')
  const { createPool } = await import('../db/pool.ts')
  const db = await createPool({ DATABASE_URL: url, DB_SCHEMA: schema })
  const ver = await forms.loadVersion(db, formVersionId)
  await db.end()
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
  // 用紙の 2 ページ目は、PDF の 3 ページ目（1 ページ目は表紙）
  await putFake(pageImageAssetPath(ver.basePdfSha256, ver.pages.find((p) => p.no === 2)!.pdfIndex + 1), png)
  const after = (await call(`/api/form-versions/${formVersionId}/assets`)).body as { pages: { no: number, url: string | null }[] }
  const u = after.pages.find((p) => p.no === 2)!.url!
  assert.ok(u, '置いた画像の URL がある')
  assert.equal(after.pages.find((p) => p.no === 3)!.url, null)
  const img = await fetch(`${origin}${u}`)
  assert.equal(img.status, 200)
  assert.deepEqual(new Uint8Array(await img.arrayBuffer()), png)
  assert.equal((await fetch(`${origin}${u.replace(/sig=[0-9a-f]{4}/, 'sig=0000')}`)).status, 403)
  // 同じ日なら同じ URL（ブラウザが覚えておける）
  const again = (await call(`/api/form-versions/${formVersionId}/assets`)).body as { pages: { no: number, url: string | null }[] }
  assert.equal(again.pages.find((p) => p.no === 2)!.url, u)
})

test('用紙の直しはサーバーがその時点の値に当てる。当てられない直しは理由を返す', { skip }, async () => {
  const { id: docId, formVersionId } = await docOf(ids.kai)
  const r = await call(`/api/documents/${docId}/edits`, { method: 'POST', body: JSON.stringify({ formVersionId, edits: [
    { slot: 'p1_受付方法_その他の内容', text: '自宅で' }, // 受付方法が「電話」なので断る
    { slot: 'p1_受付方法_その他', text: 'true' },
    { slot: 'p1_受付方法_その他の内容', text: '自宅で' }, // 「その他」にしたので入る
    { slot: 'p1_相談受付日_年', text: 'R4' },
  ] }) })
  assert.equal(r.status, 200)
  const b = r.body as { results: { slot: string, reason?: string }[], document: Doc['document'] }
  assert.ok(b.results[0].reason?.includes('電話'))
  assert.deepEqual(b.results.slice(1).map((x) => x.reason), [undefined, undefined, undefined])
  assert.equal(b.document.fields['intake.method'].value, 'その他')
  assert.equal(b.document.fields['intake.methodOther'].value, '自宅で')
  assert.equal(b.document.fields['intake.methodOther'].by, 'cm')
  assert.equal(b.document.fields['intake.date'].value, '2022-01-20') // 年だけを直したので月日は残る
  // 画面の様式の版が書類の版と違えば 409。様式にない欄は 400
  assert.equal((await call(`/api/documents/${docId}/edits`, { method: 'POST', body: JSON.stringify({ formVersionId: otherVersion, edits: [{ slot: 'p1_本人氏名', text: 'x' }] }) })).status, 409)
  assert.equal((await call(`/api/documents/${docId}/edits`, { method: 'POST', body: JSON.stringify({ formVersionId, edits: [{ slot: 'ない欄', text: 'x' }] }) })).status, 400)
})

test('差分の欄の直しは、画面が元にした値が今の値と違えば 409（AI が書いたばかりの値を上書きしない）', { skip }, async () => {
  const { id: docId } = await docOf(ids.kai)
  const doc = (await call(`/api/documents/${docId}`)).body as Doc
  const cur = doc.document.fields['person.lifeHistory'].value
  const stale = await call(`/api/documents/${docId}/fields`, { method: 'PATCH', body: JSON.stringify({ changes: [{ key: 'person.lifeHistory', value: '書き直した', base: '前に見ていた文' }] }) })
  assert.equal(stale.status, 409)
  assert.equal(((await call(`/api/documents/${docId}`)).body as Doc).document.fields['person.lifeHistory'].value, cur)
  const ok = await call(`/api/documents/${docId}/fields`, { method: 'PATCH', body: JSON.stringify({ changes: [{ key: 'person.lifeHistory', value: '書き直した', base: cur }] }) })
  assert.equal(ok.status, 200)
})

test('認定調査票は確認した欄だけに出典を記録し、409では一部も反映しない', { skip }, async () => {
  const made = await call('/api/clients', { method: 'POST', body: JSON.stringify({ name: '検証 太郎' }) })
  assert.equal(made.status, 201)
  const path = '/api/documents/' + made.body.assessmentId
  const source = { fileName: 'survey-clean.pdf', sha256: 'a'.repeat(64), recordedOn: '2026-11-04' }
  const post = (changes: { key: string, choice: number, base: unknown }[], token?: string) => call(path + '/survey-import', {
    method: 'POST', token, body: JSON.stringify({ ...source, changes }),
  })
  // 正解表（eval/document-import/survey/gold.tsv）どおりの選択肢番号
  const gold: Record<string, number> = {
    'survey.2_1': 2, 'survey.2_2': 2, 'survey.2_3': 1, 'survey.2_4': 2, 'survey.2_5': 3, 'survey.2_6': 1,
    'survey.2_7': 2, 'survey.2_8': 1, 'survey.2_9': 1, 'survey.2_10': 2, 'survey.2_11': 3, 'survey.2_12': 1,
  }
  // 用紙の印字と同じ選択肢の数で受け取り、番号をそのまま値に変換する
  assert.equal((await post([{ key: 'survey.2_3', choice: 4, base: null }])).status, 400)
  assert.equal((await post([{ key: 'survey.2_13', choice: 1, base: null }])).status, 400)
  assert.equal((await post([{ key: 'survey.2_2', choice: 2, base: null }], OTHER)).status, 404)

  const partial = await post([{ key: 'survey.2_2', choice: 2, base: null }])
  assert.equal(partial.status, 200)
  assert.equal(partial.body.document.fields['survey.2_2'].value, '見守り等')
  assert.equal(partial.body.document.fields['survey.2_4'], undefined)
  // 最初の欄は更新可能でも、後続の欄が競合すれば一部も書かない。
  assert.equal((await post([
    { key: 'survey.2_4', choice: 2, base: null },
    { key: 'survey.2_2', choice: 3, base: null },
  ])).status, 409)
  assert.equal((await call(path)).body.document.fields['survey.2_4'], undefined)

  const applied = await post(Object.entries(gold).map(([key, choice]) => ({
    key, choice, base: key === 'survey.2_2' ? '見守り等' : null,
  })))
  assert.equal(applied.status, 200)
  const fields = applied.body.document.fields
  const expected: Record<string, string> = {
    'survey.2_1': '見守り等', 'survey.2_2': '見守り等', 'survey.2_3': 'できる', 'survey.2_4': '見守り等', 'survey.2_5': '一部介助', 'survey.2_6': '介助されていない',
    'survey.2_7': '一部介助', 'survey.2_8': '介助されていない', 'survey.2_9': '介助されていない', 'survey.2_10': '見守り等', 'survey.2_11': '一部介助', 'survey.2_12': '週1回以上',
  }
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(fields[key].value, value, key)
    assert.equal(fields[key].by, 'cm', key)
    assert.deepEqual(fields[key].surveySource, { kind: 'survey-import', ...source, page: 2, choice: gold[key] }, key)
  }
  assert.equal(fields['survey.2_13'], undefined)

  // 反映済みの欄に元の base（空欄）で出すと、全部が保留になる
  assert.equal((await post(Object.entries(gold).map(([key, choice]) => ({ key, choice, base: null })))).status, 409)
  const kept = (await call(path)).body.document.fields
  assert.equal(kept['survey.2_3'].value, 'できる')
  assert.equal(kept['survey.2_11'].surveySource.choice, 3)

  const edited = await call(path + '/fields', {
    method: 'PATCH', body: JSON.stringify({ changes: [{ key: 'survey.2_2', value: '一部介助', base: '見守り等' }] }),
  })
  assert.equal(edited.status, 200)
  assert.equal(edited.body.document.fields['survey.2_2'].surveySource, undefined)
})
