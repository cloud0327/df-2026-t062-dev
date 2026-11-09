// api の道（Hono）。/api/health.json のほかは、毎回 ID トークンを確かめ、事業所で絞る。
// worker の道（/tasks/*）はここには置かない（worker/app.ts）。
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { pageImageAssetPath, type FormAssetsView } from '../core/form.ts'
import { validValue } from '../core/schema.ts'
import * as forms from '../db/forms.ts'
import { tx, type Db } from '../db/pool.ts'
import * as repo from '../db/repo.ts'
import type { Verifier } from './auth.ts'
import { FormUnavailable, makePdf } from './pdf.ts'
import type { Queue } from './queue.ts'
import { dailyWindow, LocalStorage, type Storage } from './storage.ts'

export interface ApiDeps {
  db: () => Promise<Db>
  verifier: () => Verifier
  storage: () => Storage
  queue: () => Queue
  /** AUTH_MODE=dev のとき、メールでケアマネを引く */
  devAuth?: boolean
}

const ClientInput = z.object({ name: z.string().trim().min(1).max(60), sex: z.enum(['男', '女']).nullish(), status: z.enum(['在宅', '入院中', '入所中']).optional() })
// base: 画面がこの直しの元にした値（null は空）。サーバーの今の値と違えば 409
const PatchInput = z.object({ changes: z.array(z.object({ key: z.string().min(1).max(200), value: z.unknown(), base: z.unknown(), mode: z.enum(['edit', 'revert']).optional() })).min(1).max(200) })
const EditsInput = z.object({ formVersionId: z.string().uuid(), edits: z.array(z.object({ slot: z.string().min(1).max(200), text: z.string().max(20000) })).min(1).max(200) })
const SaveInput = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('document') }),
  z.object({ scope: z.literal('page'), page: z.number().int().min(1).max(20) }),
  z.object({ scope: z.literal('hunk'), key: z.string().min(1), hunkIndex: z.number().int().min(0) }),
])
const RecordingInput = z.object({
  mime: z.string().min(1).max(100),
  deviceRecordingId: z.string().uuid().optional(),
  expiredUploadUrl: z.string().max(4096).optional(),
})
const CompleteInput = z.object({ durationMs: z.number().int().min(0).nullish(), bytes: z.number().int().positive().optional() })

const json = (c: Context, body: unknown, status = 200) => c.json(body as object, status as 200)

/** 置き場にあるかの覚え（様式の置き場は上書きも削除もしないので、あったものはずっとある。ないものは毎回見る） */
const present = new Set<string>()
async function exists(storage: Storage, path: string): Promise<boolean> {
  if (present.has(path)) return true
  const ok = (await storage.size('forms', path).catch(() => null)) !== null
  if (ok) present.add(path)
  return ok
}

export function createApp(deps: ApiDeps) {
  const app = new Hono()

  app.use('*', async (c, next) => {
    await next()
    // 様式の版のように、ブラウザが覚えてよいものは道の中で決める。それ以外は覚えさせない
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store')
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

  // 様式の版（欄の位置・対応・ページ）。中身は変わらないので、ブラウザが覚えてよい
  app.get('/api/form-versions/:id', authed(async (c, staff, db) => {
    const v = await forms.versionForOffice(db, staff.officeId, c.req.param('id')!)
    const etag = `"${v.contentSha}"`
    c.header('ETag', etag)
    c.header('Cache-Control', 'private, max-age=31536000, immutable')
    if (c.req.header('If-None-Match') === etag) return c.body(null, 304)
    return json(c, { formVersion: forms.viewOf(v) })
  }))

  // ページの画像の期限つきの URL（1 日の区切りでそろえるので、同じ日は同じ URL）と、元の PDF があるか
  app.get('/api/form-versions/:id/assets', authed(async (c, staff, db) => {
    const v = await forms.versionForOffice(db, staff.officeId, c.req.param('id')!)
    const storage = deps.storage()
    const window = dailyWindow()
    const pages = await Promise.all(v.pages.map(async (p) => {
      const path = pageImageAssetPath(v.basePdfSha256, p.pdfIndex + 1)
      return { no: p.no, url: await exists(storage, path) ? await storage.signedReadUrl('forms', path, window) : null }
    }))
    const body: FormAssetsView = { pages, hasPdf: await exists(storage, forms.basePdfPath(v)), expiresAt: window.until.toISOString() }
    return json(c, body)
  }))

  app.get('/api/documents/:id', authed(async (c, staff, db) => json(c, { document: await repo.getDocument(db, staff.officeId, c.req.param('id')!) })))

  // 欄の値をそのまま変える直し（差分の欄の文章）。画面が元にした値（base）が今の値と違えば 409
  app.patch('/api/documents/:id/fields', authed(async (c, staff, db) => {
    const { changes } = await body(c, PatchInput)
    for (const ch of changes) if (!validValue(ch.key, ch.value)) throw new repo.BadRequest(`値の形が違います: ${ch.key}`)
    const r = await repo.patchFields(db, staff, c.req.param('id')!, changes.map((ch) => ({ key: ch.key, value: ch.value ?? null, base: ch.base ?? null, mode: ch.mode })))
    return json(c, { ...r, document: await repo.getDocument(db, staff.officeId, c.req.param('id')!) })
  }))

  // 用紙の印字欄の直し。サーバーがその時点の値に当てる（当てられない直しは理由を返す）
  app.post('/api/documents/:id/edits', authed(async (c, staff, db) => {
    const { formVersionId, edits } = await body(c, EditsInput)
    const r = await repo.applySlotEdits(db, staff, c.req.param('id')!, formVersionId, edits)
    return json(c, { ...r, document: await repo.getDocument(db, staff.officeId, c.req.param('id')!) })
  }))

  app.post('/api/documents/:id/save', authed(async (c, staff, db) => {
    const r = await repo.saveDocument(db, staff, c.req.param('id')!, await body(c, SaveInput))
    return json(c, { ...r, document: await repo.getDocument(db, staff.officeId, c.req.param('id')!) })
  }))

  app.get('/api/documents/:id/pdf', authed(async (c, staff, db) => {
    const doc = await repo.getDocument(db, staff.officeId, c.req.param('id')!)
    const rev = await repo.latestRevision(db, staff.officeId, doc.id)
    const version = await forms.loadVersion(db, rev.formVersionId)
    const pdf = await makePdf(deps.storage(), version, rev.values)
    const path = `exports/${staff.officeId}/${doc.id}/rev${rev.rev}-${Date.now()}.pdf`
    let stored: string | null = path
    try {
      await deps.storage().write('output', path, pdf, 'application/pdf')
    } catch {
      stored = null // 出力の置き場に書けなくても、PDF は返す
    }
    await repo.recordExport(db, staff, doc.id, rev.rev, version.id, stored)
    return new Response(new Blob([pdf], { type: 'application/pdf' }), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${version.name}_v${rev.rev}.pdf`)}`,
        'Cache-Control': 'no-store',
      },
    })
  }))

  const startRecording = authed(async (c, staff, db) => {
    const { mime, deviceRecordingId, expiredUploadUrl } = await body(c, RecordingInput)
    const result = await tx(db, async (conn) => {
      const rec = await repo.createRecording(conn, staff, c.req.param('id')!, mime, deviceRecordingId)
      const storage = deps.storage()
      let uploadUrl = rec.uploadUrl
      if (rec.status === 'uploaded' || (uploadUrl && await storage.size('source', rec.objectPath))) {
        uploadUrl = null
      } else if (!uploadUrl || uploadUrl === expiredUploadUrl) {
        uploadUrl = await storage.createUploadSession('source', rec.objectPath, rec.mime, c.req.header('Origin') ?? undefined)
        await repo.setRecordingUploadUrl(conn, rec.id, uploadUrl)
      }
      return { recordingId: rec.id, uploadUrl }
    })
    return json(c, result, 201)
  })
  app.post('/api/clients/:id/recordings', startRecording)
  // 新しい画面が古い API に当たっても、再送のたびに別の録音を作らないよう別の道を使う。
  app.post('/api/clients/:id/recordings/resumable', startRecording)

  app.post('/api/recordings/:id/complete', authed(async (c, staff, db) => {
    const { durationMs, bytes } = await body(c, CompleteInput)
    const jobId = await repo.completeRecording(db, staff, c.req.param('id')!, durationMs ?? null, bytes,
      (path) => deps.storage().size('source', path))
    if (!jobId) return json(c, { error: 'not_uploaded' }, 409)
    const job = await repo.dispatchRecordingJob(db, jobId, () => deps.queue().enqueue(jobId, { initial: true }))
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

  // ローカルの置き場だけ: 期限つきの URL で様式のファイルを渡す（Cloud Storage の署名つき URL と同じ約束）
  app.get('/api/dev-files/forms/*', async (c) => {
    const storage = deps.storage()
    if (!(storage instanceof LocalStorage)) return json(c, { error: 'not_found' }, 404)
    const path = decodeURIComponent(c.req.path.slice('/api/dev-files/forms/'.length))
    const q = { from: c.req.query('from'), until: c.req.query('until'), sig: c.req.query('sig') }
    const data = await storage.readSigned('forms', path, q)
    if (!data) return json(c, { error: 'forbidden' }, 403)
    const left = Math.max(0, Number(q.until) - Math.floor(Date.now() / 1000))
    return new Response(new Blob([new Uint8Array(data)]), {
      headers: { 'Content-Type': path.endsWith('.png') ? 'image/png' : path.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream', 'Cache-Control': `private, max-age=${left}` },
    })
  })

  app.notFound((c) => json(c, { error: 'not_found' }, 404))

  app.onError((err, c) => {
    if (err instanceof repo.NotFound || err instanceof forms.FormNotFound) return json(c, { error: 'not_found' }, 404)
    if (err instanceof repo.Conflict) return json(c, { error: 'conflict', message: err.message === 'form_version' ? '様式の版が変わりました。読み直してください' : 'ほかの直し・AI の書き込みと重なりました。読み直してください' }, 409)
    if (err instanceof repo.BadRequest) return json(c, { error: 'bad_request', message: err.message }, 400)
    if (err instanceof FormUnavailable) return json(c, { error: 'form_unavailable', message: 'この様式の元の PDF がまだ用意されていません' }, 503)
    // ログには中身を出さない（種類と道だけ）
    console.error(JSON.stringify({ severity: 'ERROR', msg: 'api error', path: c.req.routePath, error: err.name }))
    return json(c, { error: 'internal' }, 500)
  })

  return app
}
