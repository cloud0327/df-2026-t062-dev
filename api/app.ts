// api の道（Hono）。/api/health.json のほかは、毎回 ID トークンを確かめ、事業所で絞る。
// worker の道（/tasks/*）はここには置かない（worker/app.ts）。
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { validValue } from '../core/schema.ts'
import type { Db } from '../db/pool.ts'
import * as repo from '../db/repo.ts'
import type { Verifier } from './auth.ts'
import { makePdf } from './pdf.ts'
import type { Queue } from './queue.ts'
import { LocalStorage, type Storage } from './storage.ts'

export interface ApiDeps {
  db: () => Promise<Db>
  verifier: () => Verifier
  storage: () => Storage
  queue: () => Queue
  /** AUTH_MODE=dev のとき、メールでケアマネを引く */
  devAuth?: boolean
}

const ClientInput = z.object({ name: z.string().trim().min(1).max(60), sex: z.enum(['男', '女']).nullish(), status: z.enum(['在宅', '入院中', '入所中']).optional() })
const PatchInput = z.object({ changes: z.array(z.object({ key: z.string().min(1).max(200), value: z.unknown(), mode: z.enum(['edit', 'revert']).optional() })).min(1).max(200) })
const SaveInput = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('document') }),
  z.object({ scope: z.literal('page'), page: z.number().int().min(1).max(20) }),
  z.object({ scope: z.literal('hunk'), key: z.string().min(1), hunkIndex: z.number().int().min(0) }),
])
const RecordingInput = z.object({ mime: z.string().min(1).max(100) })
const CompleteInput = z.object({ durationMs: z.number().int().min(0).nullish() })

const json = (c: Context, body: unknown, status = 200) => c.json(body as object, status as 200)

export function createApp(deps: ApiDeps) {
  const app = new Hono()

  app.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
  })

  app.all('/api/health.json', (c) => {
    if (c.req.method !== 'GET') {
      c.header('Allow', 'GET')
      return json(c, { error: 'method_not_allowed' }, 405)
    }
    return json(c, { status: 'ok', source: 'api' })
  })

  /** ログインしているケアマネを確かめてから handler を呼ぶ */
  const authed = (handler: (c: Context, staff: repo.Staff, db: Db) => Promise<Response>) => async (c: Context) => {
    const header = c.req.header('Authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) return json(c, { error: 'unauthorized' }, 401)
    const user = await deps.verifier().verify(token)
    if (!user) return json(c, { error: 'unauthorized' }, 401)
    const db = await deps.db()
    const staff = await repo.staffByAuth(db, user.uid, user.email, deps.devAuth)
    if (!staff) return json(c, { error: 'forbidden' }, 403)
    return handler(c, staff, db)
  }

  const body = async <T>(c: Context, schema: z.ZodType<T>): Promise<T> => {
    const parsed = schema.safeParse(await c.req.json().catch(() => undefined))
    if (!parsed.success) throw new repo.BadRequest('入力の形が違います')
    return parsed.data
  }

  app.get('/api/me', authed(async (c, staff) => json(c, { staff })))

  app.get('/api/clients', authed(async (c, staff, db) => {
    const sort = c.req.query('sort') === 'name' ? 'name' : 'updated'
    return json(c, { clients: await repo.listClients(db, staff.officeId, { q: c.req.query('q'), sort }) })
  }))

  app.post('/api/clients', authed(async (c, staff, db) => json(c, await repo.createClient(db, staff, await body(c, ClientInput)), 201)))

  app.get('/api/clients/:id', authed(async (c, staff, db) => json(c, {
    client: await repo.getClient(db, staff.officeId, c.req.param('id')!),
    jobs: await repo.activeJobs(db, staff.officeId, c.req.param('id')!),
  })))

  app.post('/api/clients/:id/documents', authed(async (c, staff, db) => {
    const { form } = await body(c, z.object({ form: z.literal('admission') }))
    const r = await repo.createAdmission(db, staff, c.req.param('id')!)
    return json(c, { id: r.id, form, created: r.created }, r.created ? 201 : 200)
  }))

  app.get('/api/documents/:id', authed(async (c, staff, db) => json(c, { document: await repo.getDocument(db, staff.officeId, c.req.param('id')!) })))

  app.patch('/api/documents/:id/fields', authed(async (c, staff, db) => {
    const { changes } = await body(c, PatchInput)
    for (const ch of changes) if (!validValue(ch.key, ch.value)) throw new repo.BadRequest(`値の形が違います: ${ch.key}`)
    const r = await repo.patchFields(db, staff, c.req.param('id')!, changes.map((ch) => ({ key: ch.key, value: ch.value ?? null, mode: ch.mode })))
    return json(c, { ...r, document: await repo.getDocument(db, staff.officeId, c.req.param('id')!) })
  }))

  app.post('/api/documents/:id/save', authed(async (c, staff, db) => {
    const r = await repo.saveDocument(db, staff, c.req.param('id')!, await body(c, SaveInput))
    return json(c, { ...r, document: await repo.getDocument(db, staff.officeId, c.req.param('id')!) })
  }))

  app.get('/api/documents/:id/pdf', authed(async (c, staff, db) => {
    const doc = await repo.getDocument(db, staff.officeId, c.req.param('id')!)
    const rev = await repo.latestRevision(db, staff.officeId, doc.id)
    const pdf = await makePdf(doc.form, rev.values)
    const path = `exports/${staff.officeId}/${doc.id}/rev${rev.rev}-${Date.now()}.pdf`
    let stored: string | null = path
    try {
      await deps.storage().write('output', path, pdf, 'application/pdf')
    } catch {
      stored = null // 出力の置き場に書けなくても、PDF は返す
    }
    await repo.recordExport(db, staff, doc.id, rev.rev, stored)
    return new Response(new Blob([pdf], { type: 'application/pdf' }), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${doc.form === 'admission' ? '入院時情報提供書' : 'アセスメント'}_v${rev.rev}.pdf`)}`,
        'Cache-Control': 'no-store',
      },
    })
  }))

  app.post('/api/clients/:id/recordings', authed(async (c, staff, db) => {
    const { mime } = await body(c, RecordingInput)
    const rec = await repo.createRecording(db, staff, c.req.param('id')!, mime)
    const uploadUrl = await deps.storage().createUploadSession('source', rec.objectPath, mime, c.req.header('Origin') ?? undefined)
    return json(c, { recordingId: rec.id, uploadUrl }, 201)
  }))

  app.post('/api/recordings/:id/complete', authed(async (c, staff, db) => {
    const { durationMs } = await body(c, CompleteInput)
    const rec = await repo.getRecording(db, staff.officeId, c.req.param('id')!)
    const size = await deps.storage().size('source', rec.objectPath)
    if (!size) return json(c, { error: 'not_uploaded' }, 409)
    const job = await repo.completeRecording(db, staff, rec.id, size, durationMs ?? null)
    if (job.status === 'queued') await deps.queue().enqueue(job.jobId)
    return json(c, job, 202)
  }))

  app.get('/api/clients/:id/jobs', authed(async (c, staff, db) => json(c, { jobs: await repo.activeJobs(db, staff.officeId, c.req.param('id')!) })))

  // ローカルの置き場だけ: ブラウザからの送信を受ける（Cloud Storage の再開できる送信と同じ約束）
  app.put('/api/dev-upload/:token', async (c) => {
    const storage = deps.storage()
    if (!(storage instanceof LocalStorage)) return json(c, { error: 'not_found' }, 404)
    const r = await storage.receive(c.req.param('token')!, c.req.header('Content-Range'), new Uint8Array(await c.req.arrayBuffer()))
    if (r.range) c.header('Range', r.range)
    return r.status === 308 ? new Response(null, { status: 308, headers: r.range ? { Range: r.range } : {} }) : json(c, {}, r.status)
  })

  app.notFound((c) => json(c, { error: 'not_found' }, 404))

  app.onError((err, c) => {
    if (err instanceof repo.NotFound) return json(c, { error: 'not_found' }, 404)
    if (err instanceof repo.BadRequest) return json(c, { error: 'bad_request', message: err.message }, 400)
    // ログには中身を出さない（種類と道だけ）
    console.error(JSON.stringify({ severity: 'ERROR', msg: 'api error', path: c.req.routePath, error: err.name }))
    return json(c, { error: 'internal' }, 500)
  })

  return app
}
