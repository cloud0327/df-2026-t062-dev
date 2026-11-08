// DB の読み書き。api と worker が共通に使う。どの関数も office_id で絞る。
import { FORMS, slotPages, type FormId } from '../forms/index.ts'
import { planBatch, sameValue, type BatchPlan, type CurrentField } from '../core/apply-batch.ts'
import { saveOneHunk } from '../core/diff.ts'
import { isShared } from '../core/fields.ts'
import { countRequired } from '../core/required.ts'
import { isSlotKey, type Who } from '../core/slots.ts'
import { tx, type Db, type Tx } from './pool.ts'

type Q = Db | Tx

export interface Staff { id: string, officeId: string, name: string, email: string | null, role: string, officeName: string }

export interface FieldRow { value: unknown, aiValue: unknown, by: Who, batchId: string | null, updatedAt: string }
export interface SavedRow { value: unknown, by: Who }

export interface DocumentView {
  id: string
  clientId: string
  form: FormId
  fields: Record<string, FieldRow>
  saved: Record<string, SavedRow>
  rev: number
  batches: { id: string, kind: string, label: string, createdAt: string, changes: number, kept: number }[]
}

export class NotFound extends Error {}
export class BadRequest extends Error {}

// ---------- ケアマネ ----------

export async function staffByAuth(db: Q, authUid: string, email?: string, allowEmailMatch = false): Promise<Staff | null> {
  const sql = `SELECT s.id, s.office_id, s.name, s.email, s.role, o.name AS office_name
               FROM staff s JOIN offices o ON o.id = s.office_id
               WHERE s.auth_uid = $1 ${allowEmailMatch ? 'OR (s.email IS NOT NULL AND s.email = $2)' : ''} LIMIT 1`
  const r = await db.query(sql, allowEmailMatch ? [authUid, email ?? ''] : [authUid])
  const s = r.rows[0]
  return s ? { id: s.id, officeId: s.office_id, name: s.name, email: s.email, role: s.role, officeName: s.office_name } : null
}

async function audit(db: Q, staff: Staff | null, officeId: string, action: string, ids: { clientId?: string, documentId?: string }, detail: Record<string, unknown> = {}) {
  await db.query(
    'INSERT INTO audit_events (office_id, staff_id, client_id, document_id, action, detail) VALUES ($1,$2,$3,$4,$5,$6)',
    [officeId, staff?.id ?? null, ids.clientId ?? null, ids.documentId ?? null, action, JSON.stringify(detail)],
  )
}

// ---------- 利用者 ----------

export interface ClientSummary {
  id: string
  name: string
  sex: string | null
  status: string
  careLevel: string | null
  required: { filled: number, total: number }
  nextVisitAt: string | null
  isNew: boolean
  updatedAt: string
  assessmentId: string | null
}

async function valuesOf(db: Q, officeId: string, clientIds: string[], form: FormId = 'assessment') {
  const r = await db.query(
    `SELECT f.client_id, f.key, f.value FROM field_values f
     LEFT JOIN documents d ON d.id = f.document_id
     WHERE f.office_id = $1 AND f.client_id = ANY($2::uuid[]) AND (f.document_id IS NULL OR d.form = $3)`,
    [officeId, clientIds, form],
  )
  const out = new Map<string, Record<string, unknown>>()
  for (const row of r.rows) {
    const m = out.get(row.client_id) ?? {}
    m[row.key] = row.value
    out.set(row.client_id, m)
  }
  return out
}

export async function listClients(db: Q, officeId: string, opts: { q?: string, sort?: 'updated' | 'name' } = {}): Promise<ClientSummary[]> {
  const q = opts.q?.trim()
  const r = await db.query(
    `SELECT c.id, c.name, c.status, c.next_visit_at, c.updated_at, d.id AS assessment_id,
            EXISTS (SELECT 1 FROM revisions v WHERE v.document_id = d.id) AS has_rev
     FROM clients c LEFT JOIN documents d ON d.client_id = c.id AND d.form = 'assessment'
     WHERE c.office_id = $1 AND c.archived_at IS NULL ${q ? 'AND c.name ILIKE $2' : ''}
     ORDER BY ${opts.sort === 'name' ? 'c.name ASC' : 'c.updated_at DESC'}`,
    q ? [officeId, `%${q}%`] : [officeId],
  )
  const values = await valuesOf(db, officeId, r.rows.map((x) => x.id))
  return r.rows.map((c) => {
    const v = values.get(c.id) ?? {}
    return {
      id: c.id,
      name: c.name,
      sex: (v['person.sex'] as string) ?? null,
      status: c.status,
      careLevel: (v['cert.careLevel'] as string) ?? null,
      required: countRequired(v),
      nextVisitAt: c.next_visit_at ? new Date(c.next_visit_at).toISOString() : null,
      isNew: !c.has_rev && Object.keys(v).filter((k) => k !== 'person.name' && k !== 'person.sex').length === 0,
      updatedAt: new Date(c.updated_at).toISOString(),
      assessmentId: c.assessment_id,
    }
  })
}

export async function createClient(db: Db, staff: Staff, input: { name: string, sex?: '男' | '女' | null, status?: string }) {
  return tx(db, async (c) => {
    const client = (await c.query(
      'INSERT INTO clients (office_id, name, status, created_by) VALUES ($1,$2,$3,$4) RETURNING id',
      [staff.officeId, input.name, input.status ?? '在宅', staff.id],
    )).rows[0]
    const doc = (await c.query(
      "INSERT INTO documents (office_id, client_id, form, created_by) VALUES ($1,$2,'assessment',$3) RETURNING id",
      [staff.officeId, client.id, staff.id],
    )).rows[0]
    const initial: [string, unknown][] = [['person.name', input.name]]
    if (input.sex) initial.push(['person.sex', input.sex])
    for (const [key, value] of initial) {
      await c.query(
        "INSERT INTO field_values (office_id, client_id, document_id, key, value, by, updated_by) VALUES ($1,$2,NULL,$3,$4,'cm',$5)",
        [staff.officeId, client.id, key, JSON.stringify(value), staff.id],
      )
      await c.query("INSERT INTO document_saved (document_id, key, value, by) VALUES ($1,$2,$3,'cm')", [doc.id, key, JSON.stringify(value)])
    }
    await audit(c, staff, staff.officeId, 'client.create', { clientId: client.id })
    return { id: client.id as string, assessmentId: doc.id as string }
  })
}

export async function getClient(db: Q, officeId: string, clientId: string) {
  const c = (await db.query('SELECT id, name, status, next_visit_at FROM clients WHERE id = $1 AND office_id = $2 AND archived_at IS NULL', [clientId, officeId])).rows[0]
  if (!c) throw new NotFound()
  const docs = (await db.query('SELECT id, form FROM documents WHERE client_id = $1 AND office_id = $2 ORDER BY created_at', [clientId, officeId])).rows
  const values = (await valuesOf(db, officeId, [clientId])).get(clientId) ?? {}
  return {
    id: c.id as string,
    name: c.name as string,
    status: c.status as string,
    nextVisitAt: c.next_visit_at ? new Date(c.next_visit_at).toISOString() : null,
    documents: docs.map((d) => ({ id: d.id as string, form: d.form as FormId })),
    required: countRequired(values),
  }
}

// ---------- 書類 ----------

async function lockDocument(c: Tx, officeId: string, documentId: string) {
  const d = (await c.query('SELECT id, client_id, form FROM documents WHERE id = $1 AND office_id = $2 FOR UPDATE', [documentId, officeId])).rows[0]
  if (!d) throw new NotFound()
  // 基本情報の欄はほかの書類と同じ値なので、利用者の行も止める
  await c.query('SELECT id FROM clients WHERE id = $1 FOR UPDATE', [d.client_id])
  return { id: d.id as string, clientId: d.client_id as string, form: d.form as FormId }
}

async function readFields(db: Q, documentId: string, clientId: string): Promise<Record<string, FieldRow>> {
  const r = await db.query(
    `SELECT key, value, ai_value, by, batch_id, updated_at FROM field_values
     WHERE client_id = $2 AND (document_id = $1 OR document_id IS NULL)`,
    [documentId, clientId],
  )
  const out: Record<string, FieldRow> = {}
  for (const row of r.rows) {
    out[row.key] = { value: row.value, aiValue: row.ai_value, by: row.by, batchId: row.batch_id, updatedAt: new Date(row.updated_at).toISOString() }
  }
  return out
}

async function readSaved(db: Q, documentId: string): Promise<Record<string, SavedRow>> {
  const r = await db.query('SELECT key, value, by FROM document_saved WHERE document_id = $1', [documentId])
  return Object.fromEntries(r.rows.map((x) => [x.key, { value: x.value, by: x.by }]))
}

export async function getDocument(db: Q, officeId: string, documentId: string): Promise<DocumentView> {
  const d = (await db.query('SELECT id, client_id, form FROM documents WHERE id = $1 AND office_id = $2', [documentId, officeId])).rows[0]
  if (!d) throw new NotFound()
  const [fields, saved, rev, batches] = await Promise.all([
    readFields(db, d.id, d.client_id),
    readSaved(db, d.id),
    db.query('SELECT coalesce(max(rev), 0) AS rev FROM revisions WHERE document_id = $1', [d.id]),
    db.query('SELECT id, kind, label, created_at, jsonb_array_length(changes) AS n, jsonb_array_length(kept) AS k FROM batches WHERE document_id = $1 ORDER BY created_at DESC LIMIT 10', [d.id]),
  ])
  return {
    id: d.id,
    clientId: d.client_id,
    form: d.form,
    fields,
    saved,
    rev: Number(rev.rows[0].rev),
    batches: batches.rows.map((b) => ({ id: b.id, kind: b.kind, label: b.label, createdAt: new Date(b.created_at).toISOString(), changes: Number(b.n), kept: Number(b.k) })),
  }
}

/** 書類の欄として持てる key か（その様式の key と、その様式の印字欄の値） */
function allowedKey(form: FormId, key: string): boolean {
  const f = FORMS[form]
  if (isSlotKey(key)) return key.slice(5) in f.slotmap || slotPages(f).has(key.slice(5))
  return f.usesKeys.includes(key)
}

async function writeField(c: Tx, officeId: string, clientId: string, documentId: string, key: string, value: unknown, by: Who, staffId: string | null, extra: { aiValue?: unknown, batchId?: string, cite?: unknown } = {}) {
  const docId = isShared(key) ? null : documentId
  const prev = (await c.query(
    'SELECT value, by, batch_id FROM field_values WHERE client_id = $1 AND document_id IS NOT DISTINCT FROM $2 AND key = $3',
    [clientId, docId, key],
  )).rows[0]
  if (prev) {
    await c.query(
      'INSERT INTO field_history (office_id, client_id, document_id, key, value, by, batch_id, changed_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [officeId, clientId, docId, key, JSON.stringify(prev.value), prev.by, prev.batch_id, staffId],
    )
  }
  if (value === null || value === undefined) {
    await c.query('DELETE FROM field_values WHERE client_id = $1 AND document_id IS NOT DISTINCT FROM $2 AND key = $3', [clientId, docId, key])
    return
  }
  await c.query(
    `INSERT INTO field_values (office_id, client_id, document_id, key, value, ai_value, by, batch_id, cite, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
     ON CONFLICT ON CONSTRAINT field_values_unique DO UPDATE SET
       value = EXCLUDED.value,
       ai_value = coalesce(EXCLUDED.ai_value, field_values.ai_value),
       by = EXCLUDED.by,
       batch_id = coalesce(EXCLUDED.batch_id, field_values.batch_id),
       cite = coalesce(EXCLUDED.cite, field_values.cite),
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [officeId, clientId, docId, key, JSON.stringify(value), extra.aiValue === undefined ? null : JSON.stringify(extra.aiValue), by, extra.batchId ?? null, extra.cite === undefined ? null : JSON.stringify(extra.cite), staffId],
  )
}

export interface FieldChange { key: string, value: unknown, mode?: 'edit' | 'revert' }

/**
 * ケアマネの直し。by=cm にする。「前の文に戻す」（mode=revert）で保存した値と同じに戻ったときは、保存したときの by に戻す。
 * AI の書き込み（applyBatch）と同時に来ても、書類の行を止めて順に入れる。
 */
export async function patchFields(db: Db, staff: Staff, documentId: string, changes: FieldChange[]) {
  return tx(db, async (c) => {
    const d = await lockDocument(c, staff.officeId, documentId)
    const saved = await readSaved(c, d.id)
    let sharedChanged = false
    for (const ch of changes) {
      if (!allowedKey(d.form, ch.key)) throw new BadRequest(`この書類にない欄です: ${ch.key}`)
      const back = ch.mode === 'revert' && saved[ch.key] && sameValue(saved[ch.key].value, ch.value)
      const cur = (await readFields(c, d.id, d.clientId))[ch.key]
      const by: Who = back ? saved[ch.key].by : ch.mode === 'revert' && cur ? cur.by : 'cm'
      await writeField(c, staff.officeId, d.clientId, d.id, ch.key, ch.value, by, staff.id)
      if (isShared(ch.key)) sharedChanged = true
      if (ch.key === 'person.name' && typeof ch.value === 'string' && ch.value.trim()) {
        await c.query('UPDATE clients SET name = $1 WHERE id = $2', [ch.value.trim(), d.clientId])
      }
    }
    await c.query('UPDATE clients SET updated_at = now() WHERE id = $1', [d.clientId])
    await c.query('UPDATE documents SET updated_at = now() WHERE id = $1', [d.id])
    await audit(c, staff, staff.officeId, 'document.edit', { clientId: d.clientId, documentId: d.id }, { fields: changes.length })
    const others = sharedChanged
      ? (await c.query('SELECT form FROM documents WHERE client_id = $1 AND id <> $2', [d.clientId, d.id])).rows.map((r) => FORMS[r.form as FormId].label)
      : []
    return { syncedTo: others }
  })
}

export type SaveRequest =
  | { scope: 'document' }
  | { scope: 'page', page: number }
  | { scope: 'hunk', key: string, hunkIndex: number }

/** 保存の 3 段。保存した値（document_saved）を更新し、保存した値の全部を版として残す */
export async function saveDocument(db: Db, staff: Staff, documentId: string, req: SaveRequest) {
  return tx(db, async (c) => {
    const d = await lockDocument(c, staff.officeId, documentId)
    const fields = await readFields(c, d.id, d.clientId)
    const saved = await readSaved(c, d.id)
    const form = FORMS[d.form]
    const next = new Map<string, SavedRow | null>()

    if (req.scope === 'hunk') {
      const cur = fields[req.key]
      if (!cur || typeof cur.value !== 'string') throw new BadRequest('文章の欄ではありません')
      const before = typeof saved[req.key]?.value === 'string' ? (saved[req.key].value as string) : ''
      next.set(req.key, { value: saveOneHunk(before, cur.value, req.hunkIndex), by: cur.by })
    } else {
      let keys: Set<string>
      if (req.scope === 'document') keys = new Set([...Object.keys(fields), ...Object.keys(saved)])
      else {
        // そのページに印字欄がある key と、そのページの印字欄の値
        const pages = slotPages(form)
        keys = new Set<string>()
        for (const [slot, p] of pages) {
          if (p !== req.page) continue
          keys.add(`slot:${slot}`)
          const e = form.slotmap[slot]
          if (e && e.kind !== 'derived') keys.add(e.key)
          else if (e) for (const k of e.keys) keys.add(k)
        }
      }
      for (const k of keys) {
        if (!fields[k] && !saved[k]) continue
        next.set(k, fields[k] ? { value: fields[k].value, by: fields[k].by } : null)
      }
    }

    for (const [k, v] of next) {
      if (v === null) await c.query('DELETE FROM document_saved WHERE document_id = $1 AND key = $2', [d.id, k])
      else {
        await c.query(
          `INSERT INTO document_saved (document_id, key, value, by, saved_at) VALUES ($1,$2,$3,$4,now())
           ON CONFLICT (document_id, key) DO UPDATE SET value = EXCLUDED.value, by = EXCLUDED.by, saved_at = now()`,
          [d.id, k, JSON.stringify(v.value), v.by],
        )
      }
    }
    const all = await readSaved(c, d.id)
    const rev = Number((await c.query('SELECT coalesce(max(rev), 0) + 1 AS rev FROM revisions WHERE document_id = $1', [d.id])).rows[0].rev)
    await c.query(
      'INSERT INTO revisions (office_id, document_id, rev, scope, "values", saved_by) VALUES ($1,$2,$3,$4,$5,$6)',
      [staff.officeId, d.id, rev, req.scope, JSON.stringify(Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.value]))), staff.id],
    )
    await audit(c, staff, staff.officeId, 'document.save', { clientId: d.clientId, documentId: d.id }, { scope: req.scope, rev, fields: next.size })
    return { rev, savedKeys: next.size }
  })
}

/** 最新の版（PDF を作る元）。版がなければ空 */
export async function latestRevision(db: Q, officeId: string, documentId: string) {
  const r = (await db.query(
    'SELECT v.rev, v."values" FROM revisions v JOIN documents d ON d.id = v.document_id WHERE v.document_id = $1 AND d.office_id = $2 ORDER BY v.rev DESC LIMIT 1',
    [documentId, officeId],
  )).rows[0]
  return r ? { rev: Number(r.rev), values: r.values as Record<string, unknown> } : { rev: 0, values: {} as Record<string, unknown> }
}

export async function recordExport(db: Q, staff: Staff, documentId: string, rev: number, objectPath: string | null) {
  await db.query('INSERT INTO exports (office_id, document_id, revision_rev, object_path, created_by) VALUES ($1,$2,$3,$4,$5)', [staff.officeId, documentId, rev, objectPath, staff.id])
  await audit(db, staff, staff.officeId, 'document.pdf', { documentId }, { rev })
}

// ---------- AI の書き込み（applyBatch） ----------

export interface ApplyInput {
  officeId: string
  documentId: string
  kind: 'recording' | 'copy' | 'seed'
  label: string
  jobId?: string
  proposed: Record<string, { value: unknown, cite?: string[] }>
}

/**
 * 用紙を変える AI の入口はここだけ。書類の行を止め、今の用紙を読み直し、書き換えの決まりで書く（1 回のトランザクション）。
 * before は反映の瞬間の用紙から取る。
 */
export async function applyBatch(db: Db, input: ApplyInput, run: <T>(fn: (c: Tx) => Promise<T>) => Promise<T> = (fn) => tx(db, fn)): Promise<{ batchId: string | null, plan: BatchPlan }> {
  return run(async (c) => {
    const d = await lockDocument(c, input.officeId, input.documentId)
    const fields = await readFields(c, d.id, d.clientId)
    const current: Record<string, CurrentField> = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { value: v.value, by: v.by }]))
    const proposed = Object.fromEntries(Object.entries(input.proposed).filter(([k]) => allowedKey(d.form, k)))
    const plan = planBatch(current, proposed)
    if (!plan.changes.length && !plan.kept.length) return { batchId: null, plan }
    const batch = (await c.query(
      'INSERT INTO batches (office_id, client_id, document_id, kind, label, job_id, changes, kept) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [input.officeId, d.clientId, d.id, input.kind, input.label, input.jobId ?? null, JSON.stringify(plan.changes), JSON.stringify(plan.kept)],
    )).rows[0]
    for (const ch of plan.changes) {
      await writeField(c, input.officeId, d.clientId, d.id, ch.key, ch.after, 'ai', null, { aiValue: ch.after, batchId: batch.id, cite: ch.cite })
    }
    await c.query('UPDATE clients SET updated_at = now() WHERE id = $1', [d.clientId])
    await c.query('UPDATE documents SET updated_at = now() WHERE id = $1', [d.id])
    return { batchId: batch.id as string, plan }
  })
}

/** 入院時情報提供書を作る。アセスメントに値がある欄を写す（写したあとは別の値。基本情報だけはつながったまま） */
export async function createAdmission(db: Db, staff: Staff, clientId: string) {
  const existing = (await db.query("SELECT id FROM documents WHERE client_id = $1 AND office_id = $2 AND form = 'admission'", [clientId, staff.officeId])).rows[0]
  if (existing) return { id: existing.id as string, created: false }
  const assess = (await db.query("SELECT id FROM documents WHERE client_id = $1 AND office_id = $2 AND form = 'assessment'", [clientId, staff.officeId])).rows[0]
  if (!assess) throw new NotFound()
  const office = (await db.query('SELECT name, phone, fax FROM offices WHERE id = $1', [staff.officeId])).rows[0]
  return tx(db, async (c) => {
    const doc = (await c.query(
      "INSERT INTO documents (office_id, client_id, form, created_by) VALUES ($1,$2,'admission',$3) ON CONFLICT (client_id, form) DO UPDATE SET updated_at = now() RETURNING id",
      [staff.officeId, clientId, staff.id],
    )).rows[0]
    const src = await readFields(c, assess.id, clientId)
    const proposed: Record<string, { value: unknown }> = {}
    for (const key of FORMS.admission.usesKeys) {
      if (isShared(key) || !src[key]) continue
      proposed[key] = { value: src[key].value }
    }
    const settings: Record<string, unknown> = { 'office.name': office?.name, 'office.careManagerName': staff.name, 'office.phone': office?.phone, 'office.fax': office?.fax }
    const changes = Object.entries({ ...Object.fromEntries(Object.entries(proposed).map(([k, v]) => [k, v.value])), ...settings })
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
    const batch = (await c.query(
      "INSERT INTO batches (office_id, client_id, document_id, kind, label, changes) VALUES ($1,$2,$3,'copy',$4,$5) RETURNING id",
      [staff.officeId, clientId, doc.id, 'AI 書き込み・アセスメントから写した', JSON.stringify(changes.map(([key, after]) => ({ key, op: 'add', before: null, after })))],
    )).rows[0]
    for (const [key, value] of changes) await writeField(c, staff.officeId, clientId, doc.id, key, value, 'ai', staff.id, { aiValue: value, batchId: batch.id })
    await audit(c, staff, staff.officeId, 'document.create', { clientId, documentId: doc.id }, { form: 'admission', copied: changes.length })
    return { id: doc.id as string, created: true }
  })
}

// ---------- 録音とジョブ ----------

export async function createRecording(db: Q, staff: Staff, clientId: string, mime: string) {
  const doc = (await db.query("SELECT id FROM documents WHERE client_id = $1 AND office_id = $2 AND form = 'assessment'", [clientId, staff.officeId])).rows[0]
  if (!doc) throw new NotFound()
  const ext = mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac') ? 'm4a' : mime.includes('webm') ? 'webm' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'bin'
  const r = (await db.query(
    "INSERT INTO recordings (office_id, client_id, document_id, object_path, mime, created_by) VALUES ($1,$2,$3,'',$4,$5) RETURNING id",
    [staff.officeId, clientId, doc.id, mime, staff.id],
  )).rows[0]
  const objectPath = `recordings/${staff.officeId}/${clientId}/${r.id}.${ext}`
  await db.query('UPDATE recordings SET object_path = $1 WHERE id = $2', [objectPath, r.id])
  await audit(db, staff, staff.officeId, 'recording.start', { clientId, documentId: doc.id })
  return { id: r.id as string, objectPath, documentId: doc.id as string }
}

export async function getRecording(db: Q, officeId: string, recordingId: string) {
  const r = (await db.query('SELECT id, client_id, document_id, object_path, mime, status, duration_ms FROM recordings WHERE id = $1 AND office_id = $2', [recordingId, officeId])).rows[0]
  if (!r) throw new NotFound()
  return { id: r.id as string, clientId: r.client_id as string, documentId: r.document_id as string, objectPath: r.object_path as string, mime: r.mime as string, status: r.status as string, durationMs: r.duration_ms as number | null }
}

/** 送り終わりを受けて、ジョブを作る（同じ録音に 2 つは作らない） */
export async function completeRecording(db: Q, staff: Staff, recordingId: string, bytes: number, durationMs: number | null) {
  const rec = await getRecording(db, staff.officeId, recordingId)
  await db.query("UPDATE recordings SET status = 'uploaded', bytes = $1, duration_ms = $2 WHERE id = $3", [bytes, durationMs, rec.id])
  const eta = durationMs ? Math.max(60, Math.round(durationMs / 1000 / 6) + 90) : 300
  const job = (await db.query(
    `INSERT INTO jobs (office_id, client_id, document_id, recording_id, eta_seconds) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (recording_id) DO UPDATE SET updated_at = now() RETURNING id, status`,
    [staff.officeId, rec.clientId, rec.documentId, rec.id, eta],
  )).rows[0]
  await audit(db, staff, staff.officeId, 'recording.complete', { clientId: rec.clientId, documentId: rec.documentId }, { bytes, durationMs })
  return { jobId: job.id as string, status: job.status as string }
}

export interface JobView {
  id: string
  status: string
  step: string | null
  etaSeconds: number | null
  createdAt: string
  updatedAt: string
  batch: { changes: number, kept: number } | null
}

/** 処理中のジョブと、終わって 15 分以内のジョブ */
export async function activeJobs(db: Q, officeId: string, clientId: string): Promise<JobView[]> {
  const r = await db.query(
    `SELECT j.id, j.status, j.step, j.eta_seconds, j.created_at, j.updated_at,
            jsonb_array_length(b.changes) AS n, jsonb_array_length(b.kept) AS k
     FROM jobs j LEFT JOIN batches b ON b.id = j.batch_id
     WHERE j.office_id = $1 AND j.client_id = $2
       AND (j.status IN ('queued', 'processing') OR j.updated_at > now() - interval '15 minutes')
     ORDER BY j.created_at DESC LIMIT 5`,
    [officeId, clientId],
  )
  return r.rows.map((j) => ({
    id: j.id,
    status: j.status,
    step: j.step,
    etaSeconds: j.eta_seconds,
    createdAt: new Date(j.created_at).toISOString(),
    updatedAt: new Date(j.updated_at).toISOString(),
    batch: j.n === null ? null : { changes: Number(j.n), kept: Number(j.k) },
  }))
}
