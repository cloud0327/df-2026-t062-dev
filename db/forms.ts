// 様式と様式の版の読み書き。版の中身は書き換えない（DB のトリガーでも止める）ので、読んだ版はプロセスの中で覚えておく。
import { createHash } from 'node:crypto'
import { checkBindings, formKeys, type Bindings } from '../core/binding.ts'
import { contentOf, formAssetPath, toFormDef, type FormDef, type FormKind, type FormPage, type FormVersionView, type TemplateSlot } from '../core/form.ts'
import { tx, type Db, type Tx } from './pool.ts'

type Q = Db | Tx

export class FormNotFound extends Error {}

export interface FormVersion {
  id: string
  templateId: string
  officeId: string | null
  kind: FormKind
  name: string
  title: string
  version: number
  status: 'draft' | 'published' | 'retired'
  schemas: TemplateSlot[][]
  bindings: Bindings
  pages: FormPage[]
  contentSha: string
  basePdfSha256: string
}

const cache = new Map<string, FormVersion>()
const defs = new Map<string, FormDef>()

function rowToVersion(r: Record<string, unknown>): FormVersion {
  return {
    id: r.id as string,
    templateId: r.template_id as string,
    officeId: (r.office_id as string | null) ?? null,
    kind: r.kind as FormKind,
    name: r.name as string,
    title: r.title as string,
    version: Number(r.version),
    status: r.status as FormVersion['status'],
    schemas: r.schemas as TemplateSlot[][],
    bindings: r.bindings as Bindings,
    pages: r.pages as FormPage[],
    contentSha: r.content_sha as string,
    basePdfSha256: r.base_pdf_sha256 as string,
  }
}

const SELECT = `SELECT v.id, v.template_id, v.version, v.status, v.schemas, v.bindings, v.pages, v.content_sha, v.base_pdf_sha256,
                       t.kind, t.name, t.title, t.office_id
                FROM form_template_versions v JOIN form_templates t ON t.id = v.template_id`

/** 版を読む（中身は変わらないので覚えておく。状態だけは読むたびに変わりうるので、状態を使うときは読み直す） */
export async function loadVersion(db: Q, id: string): Promise<FormVersion> {
  const hit = cache.get(id)
  if (hit) return hit
  const r = (await db.query(`${SELECT} WHERE v.id = $1`, [id])).rows[0]
  if (!r) throw new FormNotFound(id)
  const v = rowToVersion(r)
  cache.set(id, v)
  return v
}

/** 共通の仕組みで使う形（読む key つき） */
export async function loadFormDef(db: Q, id: string): Promise<FormDef> {
  const hit = defs.get(id)
  if (hit) return hit
  const def = toFormDef(viewOf(await loadVersion(db, id)))
  defs.set(id, def)
  return def
}

export function viewOf(v: FormVersion): FormVersionView {
  return { id: v.id, kind: v.kind, name: v.name, version: v.version, schemas: v.schemas, bindings: v.bindings, pages: v.pages, contentSha: v.contentSha }
}

/** その事業所が見てよい版か（全事業所の様式か、その事業所の様式）。だめなら FormNotFound */
export async function versionForOffice(db: Q, officeId: string, id: string): Promise<FormVersion> {
  const v = await loadVersion(db, id).catch(() => null)
  if (!v || (v.officeId !== null && v.officeId !== officeId)) throw new FormNotFound(id)
  return v
}

/** 新しい書類に使う版。事業所の様式があればそれ、なければ全事業所の様式の、使う版（published） */
export async function publishedVersionId(db: Q, officeId: string, kind: FormKind): Promise<string> {
  const r = (await db.query(
    `SELECT v.id FROM form_template_versions v JOIN form_templates t ON t.id = v.template_id
     WHERE t.kind = $1 AND (t.office_id = $2 OR t.office_id IS NULL) AND v.status = 'published'
     ORDER BY (t.office_id IS NULL) ASC LIMIT 1`,
    [kind, officeId],
  )).rows[0]
  if (!r) throw new FormNotFound(`${kind} の様式が登録されていません（npm run forms:seed）`)
  return r.id as string
}

/** 元の PDF とページの画像の、置き場（forms）の中の場所 */
export const basePdfPath = (v: Pick<FormVersion, 'templateId' | 'version'>) => formAssetPath(v.templateId, v.version, 'base.pdf')

// ---------- 登録 ----------

export interface VersionInput {
  kind: FormKind
  name: string
  title: string
  publisher?: string | null
  sourceUrl?: string | null
  /** 事業所の様式なら事業所の id。全事業所なら null */
  officeId?: string | null
  schemas: TemplateSlot[][]
  bindings: Bindings
  pages: FormPage[]
  basePdfSha256: string
}

/** 出す前の確かめ。印字欄と対応が 1 対 1、対応の中身が正しい、ページが schemas を指す */
export function checkVersion(input: Pick<VersionInput, 'schemas' | 'bindings' | 'pages'>): string[] {
  const errors: string[] = []
  const names = input.schemas.flat().map((s) => s.name)
  const dup = names.filter((n, i) => names.indexOf(n) !== i)
  if (dup.length) errors.push(`印字欄の名前が重なっている: ${[...new Set(dup)].join(', ')}`)
  for (const n of names) if (!input.bindings[n]) errors.push(`対応のない印字欄: ${n}`)
  for (const n of Object.keys(input.bindings)) if (!names.includes(n)) errors.push(`印字欄のない対応: ${n}`)
  errors.push(...checkBindings(input.bindings))
  for (const p of input.pages) if (!input.schemas[p.pdfIndex]) errors.push(`ページ ${p.no} の pdfIndex ${p.pdfIndex} に欄がない`)
  return errors
}

export interface RegisterResult { versionId: string, version: number, created: boolean, published: boolean }

/**
 * 様式の版を登録する（管理用。npm run forms:seed）。中身が今の最新の版と同じなら何もしない。
 * 違えば新しい版を作り、publish なら今の版を retired にして、新しい版を使う版にする（書類の向き先は forms:rebase で移す）。
 */
export async function registerVersion(db: Db, input: VersionInput, opts: { publish?: boolean } = {}): Promise<RegisterResult> {
  const errors = checkVersion(input)
  if (errors.length) throw new Error(`様式の版を登録できません:\n  ${errors.join('\n  ')}`)
  const contentSha = createHash('sha256').update(contentOf(input)).digest('hex')
  return tx(db, async (c) => {
    const t = (await c.query(
      `INSERT INTO form_templates (kind, name, title, publisher, source_url, office_id) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT ON CONSTRAINT form_templates_scope DO UPDATE SET name = EXCLUDED.name, title = EXCLUDED.title, publisher = EXCLUDED.publisher, source_url = EXCLUDED.source_url
       RETURNING id`,
      [input.kind, input.name, input.title, input.publisher ?? null, input.sourceUrl ?? null, input.officeId ?? null],
    )).rows[0]
    await c.query('SELECT id FROM form_templates WHERE id = $1 FOR UPDATE', [t.id])
    const latest = (await c.query('SELECT id, version, status, content_sha, base_pdf_sha256 FROM form_template_versions WHERE template_id = $1 ORDER BY version DESC LIMIT 1', [t.id])).rows[0]
    if (latest && latest.content_sha === contentSha && latest.base_pdf_sha256 === input.basePdfSha256) {
      let published = latest.status === 'published'
      if (opts.publish && latest.status === 'draft') { await publish(c, t.id, latest.id); published = true }
      return { versionId: latest.id, version: Number(latest.version), created: false, published }
    }
    const version = (latest ? Number(latest.version) : 0) + 1
    const v = (await c.query(
      `INSERT INTO form_template_versions (template_id, version, schemas, bindings, pages, content_sha, base_pdf_sha256)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [t.id, version, JSON.stringify(input.schemas), JSON.stringify(input.bindings), JSON.stringify(input.pages), contentSha, input.basePdfSha256],
    )).rows[0]
    if (opts.publish) await publish(c, t.id, v.id)
    return { versionId: v.id, version, created: true, published: !!opts.publish }
  })
}

async function publish(c: Tx, templateId: string, versionId: string) {
  await c.query("UPDATE form_template_versions SET status = 'retired', retired_at = now() WHERE template_id = $1 AND status = 'published'", [templateId])
  await c.query("UPDATE form_template_versions SET status = 'published', published_at = now() WHERE id = $1", [versionId])
}

// ---------- 書類の向き先を移す ----------

export interface RebaseResult { from: { id: string, version: number }[], to: { id: string, version: number }, documents: number, missingKeys: Record<string, string[]> }

/**
 * 古い版を指す書類を、その様式の使う版に移す（管理用。npm run forms:rebase）。
 * 古い版が読んでいた key を新しい版が全部読むときだけ移す（読まない key があると、その値が用紙から消えるため）。
 */
export async function rebaseDocuments(db: Db, templateId: string, opts: { dryRun?: boolean } = {}): Promise<RebaseResult> {
  return tx(db, async (c) => {
    const to = (await c.query("SELECT id FROM form_template_versions WHERE template_id = $1 AND status = 'published'", [templateId])).rows[0]
    if (!to) throw new FormNotFound(`様式 ${templateId} に使う版がありません`)
    const target = await loadVersion(c, to.id)
    const newKeys = new Set(formKeys(target.bindings))
    const olds = (await c.query(
      `SELECT DISTINCT d.template_version_id AS id FROM documents d JOIN form_template_versions v ON v.id = d.template_version_id
       WHERE v.template_id = $1 AND d.template_version_id <> $2`,
      [templateId, to.id],
    )).rows.map((r) => r.id as string)
    const from: RebaseResult['from'] = []
    const missingKeys: Record<string, string[]> = {}
    for (const id of olds) {
      const v = await loadVersion(c, id)
      from.push({ id, version: v.version })
      const missing = formKeys(v.bindings).filter((k) => !newKeys.has(k))
      if (missing.length) missingKeys[`v${v.version}`] = missing
    }
    const result = { from, to: { id: target.id, version: target.version }, documents: 0, missingKeys }
    if (Object.keys(missingKeys).length || opts.dryRun || !olds.length) {
      if (!opts.dryRun) {
        const n = (await c.query('SELECT count(*) AS n FROM documents WHERE template_version_id = ANY($1::uuid[])', [olds])).rows[0].n
        result.documents = Number(n)
      }
      return result
    }
    const moved = await c.query(
      'UPDATE documents SET template_version_id = $1, updated_at = now() WHERE template_version_id = ANY($2::uuid[]) RETURNING office_id',
      [target.id, olds],
    )
    result.documents = moved.rowCount ?? 0
    // 移行の記録（事業所ごと）。どの版のどの中身からどこへ移したか
    const offices = new Map<string, number>()
    for (const r of moved.rows) offices.set(r.office_id, (offices.get(r.office_id) ?? 0) + 1)
    for (const [officeId, n] of offices) {
      await c.query(
        "INSERT INTO audit_events (office_id, action, detail) VALUES ($1, 'form.rebase', $2)",
        [officeId, JSON.stringify({ kind: target.kind, from: await Promise.all(olds.map(async (id) => { const v = await loadVersion(c, id); return { version: v.version, contentSha: v.contentSha } })), to: { version: target.version, contentSha: target.contentSha }, documents: n })],
      )
    }
    return result
  })
}
