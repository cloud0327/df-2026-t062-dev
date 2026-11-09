// 2 層改の、AI を使わない部分。design/runner/common.py の写し（欄の候補・値の形・値の確かめ・読み直しの単位・2 回目の受け入れ）。
import { isDeepStrictEqual } from 'node:util'
import { FIELDS, FIELD_LIST, choicesOf, subFieldsOf, type FieldSpec } from '../../core/fields.ts'

// AI が書く欄の出どころ（AI基盤の設計 ⑥）
const WRITABLE_SOURCES = new Set(['talk', 'doc', 'draft'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface SubSpec { key: string, label: string, type: string, choices: string[] | null }

export interface Spec {
  key: string
  label: string
  type: string
  item23: number | null
  choices: string[] | null
  subs: SubSpec[] | null
  note: string | null
  where: string
  source: string[]
}

/** 全角・半角の違いと空白を無視して比べるための形 */
export const norm = (s: unknown) => String(s).normalize('NFKC').replace(/\s+/g, '')

// ================================================================ 欄の候補

const sub = (s: FieldSpec): SubSpec => ({ key: s.key, label: s.label ?? s.key, type: s.type, choices: s.choices ? choicesOf(s) : null })

/** AI が書く欄（その様式にあり、出どころに会話・書類・案がある欄。図は除く） */
export function candidateFields(form = 'assess', list: FieldSpec[] = FIELD_LIST): Spec[] {
  const out: Spec[] = []
  for (const f of list) {
    if (!f.forms || !(form in f.forms) || f.type === 'image') continue
    const sources = f.source ?? []
    if (!sources.some((s) => WRITABLE_SOURCES.has(s.split(':')[0]))) continue
    out.push({
      key: f.key, label: f.label, type: f.type, item23: f.item23 ?? null,
      choices: f.choices ? choicesOf(f) : null,
      subs: f.type === 'object' || f.type === 'list' ? subFieldsOf(f).map(sub) : null,
      note: f.note ?? null, where: f.forms[form], source: sources,
    })
  }
  return out
}

/** 23 項目の番号ごと。番号のない欄（全体のまとめなど）は 0 */
export function groupByItem23(specs: Spec[]): Map<number, Spec[]> {
  const groups = new Map<number, Spec[]>()
  for (const s of specs) {
    const n = s.item23 || 0
    groups.set(n, [...(groups.get(n) ?? []), s])
  }
  return new Map([...groups].sort((a, b) => a[0] - b[0]))
}

/** 23 項目の番号 → 名前（0 は全体のまとめ） */
export function item23Names(): Record<number, string> {
  const out: Record<number, string> = { 0: '全体（まとめ）' }
  for (const x of FIELDS.item23 as { no: number, name: string }[]) out[x.no] = x.name
  return out
}

// ================================================================ 値の形（JSON Schema）

function scalarSchema(t: string, choices: string[] | null): Record<string, unknown> {
  if (t === 'enum') return { type: 'string', enum: choices }
  if (t === 'multi') return { type: 'array', items: { type: 'string', enum: choices } }
  if (t === 'bool') return { type: 'boolean' }
  if (t === 'number') return { type: 'number' }
  if (t === 'date') return { type: 'string', description: 'YYYY-MM-DD' }
  return { type: 'string' }
}

/** 欄の値の JSON Schema。どの欄も null（空）を許す */
export function valueSchema(spec: Spec): Record<string, unknown> {
  let main: Record<string, unknown>
  if (spec.type === 'object' || spec.type === 'list') {
    const props = Object.fromEntries((spec.subs ?? []).map((s) => [s.key, { anyOf: [scalarSchema(s.type, s.choices), { type: 'null' }] }]))
    const inner = { type: 'object', properties: props }
    main = spec.type === 'object' ? inner : { type: 'array', items: inner }
  } else main = scalarSchema(spec.type, spec.choices)
  return { anyOf: [main, { type: 'null' }] }
}

// ================================================================ 値の確かめ（⑦）

type Checked = [unknown, string | null]

function checkScalar(t: string, choices: string[] | null, v: unknown): Checked {
  if (v === null || v === undefined) return [null, null]
  const cs = choices ?? []
  if (t === 'enum') {
    if (typeof v === 'string') {
      const hit = cs.find((c) => norm(c) === norm(v))
      if (hit !== undefined) return [hit, null]
    }
    return [null, `選択肢にない: ${JSON.stringify(v)}`]
  }
  if (t === 'multi') {
    if (!Array.isArray(v)) return [null, `配列でない: ${JSON.stringify(v)}`]
    const kept: string[] = []
    const bad: unknown[] = []
    for (const x of v) {
      const hit = typeof x === 'string' ? cs.find((c) => norm(c) === norm(x)) : undefined
      if (hit !== undefined) kept.push(hit)
      else bad.push(x)
    }
    const uniq = [...new Set(kept)]
    return [uniq.length ? uniq : null, bad.length ? `選択肢にない: ${JSON.stringify(bad)}` : null]
  }
  if (t === 'bool') return typeof v === 'boolean' ? [v, null] : [null, `真偽でない: ${JSON.stringify(v)}`]
  if (t === 'number') return typeof v === 'number' && Number.isFinite(v) ? [v, null] : [null, `数でない: ${JSON.stringify(v)}`]
  if (t === 'date') return typeof v === 'string' && DATE_RE.test(v.trim()) ? [v.trim(), null] : [null, `日付の形でない: ${JSON.stringify(v)}`]
  if (typeof v === 'string') return [v.trim() || null, null]
  return [null, `文字でない: ${JSON.stringify(v)}`]
}

function checkRow(subs: SubSpec[], row: unknown): [Record<string, unknown> | null, string[]] {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return [null, [`まとまりでない: ${JSON.stringify(row)}`]]
  const out: Record<string, unknown> = {}
  const problems: string[] = []
  for (const s of subs) {
    const [v, p] = checkScalar(s.type, s.choices, (row as Record<string, unknown>)[s.key])
    if (p) problems.push(`${s.key}: ${p}`)
    if (v !== null) out[s.key] = v
  }
  return [Object.keys(out).length ? out : null, problems]
}

/** 値を欄の型で確かめる。→ [きれいにした値 or null, 問題のリスト]。通らない部分は落とす */
export function validateValue(spec: Spec, value: unknown): [unknown, string[]] {
  if (value === null || value === undefined) return [null, []]
  if (spec.type === 'object') return checkRow(spec.subs ?? [], value)
  if (spec.type === 'list') {
    if (!Array.isArray(value)) return [null, [`配列でない: ${JSON.stringify(value)}`]]
    const rows: Record<string, unknown>[] = []
    const problems: string[] = []
    for (const r of value) {
      const [v, ps] = checkRow(spec.subs ?? [], r)
      problems.push(...ps)
      if (v !== null) rows.push(v)
    }
    return [rows.length ? rows : null, problems]
  }
  const [v, p] = checkScalar(spec.type, spec.choices, value)
  return [v, p ? [p] : []]
}

// ================================================================ 合わせ方

export interface Rec { value: unknown, cite: string[] }

/** 新しい値で書き換える。AI は欄を空にしない（新しい値が空なら前の値を残す） */
export function mergeFields<T extends { value: unknown }>(prev: Record<string, T>, next: Record<string, T>): Record<string, T> {
  const out = { ...prev }
  for (const [k, v] of Object.entries(next)) {
    if (v.value === null || v.value === undefined) continue
    out[k] = v
  }
  return out
}

// ================================================================ 読み直し・2 回目の直し（2層改）

const OPEN = '「『（('
const CLOSE = '」』）)'
// 表の行を見分ける項目。これを落とした行は、何の行か分からなくなるので行ごと落とす（ないときは最初の項目）
const ROW_ID: Record<string, string> = { 'family.members': 'relationship', 'services.informal': 'content' }

/** 文章を「。」で文に分ける。かっこの中の「。」では分けない */
export function sentences(text: unknown): string[] {
  const out: string[] = []
  let cur = ''
  let depth = 0
  for (const ch of String(text)) {
    cur += ch
    if (OPEN.includes(ch)) depth++
    else if (CLOSE.includes(ch) && depth) depth--
    else if (ch === '。' && depth === 0) { out.push(cur); cur = '' }
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

const show = (v: unknown): string => typeof v === 'boolean' ? (v ? 'はい' : 'いいえ') : Array.isArray(v) ? v.map(String).join('、') : String(v)
const rowId = (spec: Spec) => ROW_ID[spec.key] ?? spec.subs![0].key

export interface Atom { path: string, label: string, text: string }

/**
 * 欄の値を、読み直しで確かめる単位に分ける。
 * path: "" は値の全体、"#n" は文章の n 番目の文、"@選択肢" は選んだもの、"/項目" は中の項目、"[i]/項目" は表の i 行目の項目。
 */
export function atoms(spec: Spec, value: unknown): Atom[] {
  if (value === null || value === undefined) return []
  const t = spec.type
  if (t === 'longtext') return sentences(value).map((s, i) => ({ path: `#${i}`, label: spec.label, text: s }))
  if (t === 'multi') return (value as string[]).map((c) => ({ path: `@${c}`, label: spec.label, text: c }))
  const labels = Object.fromEntries((spec.subs ?? []).map((s) => [s.key, s.label]))
  if (t === 'object') {
    return Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => ({ path: `/${k}`, label: labels[k] ?? k, text: show(v) }))
  }
  if (t === 'list') {
    const out: Atom[] = []
    ;(value as Record<string, unknown>[]).forEach((row, i) => {
      const name = row[rowId(spec)]
      const head = name !== null && name !== undefined ? `${i + 1} 行目（${show(name)}）の` : `${i + 1} 行目の`
      for (const [k, v] of Object.entries(row)) if (v !== null && v !== undefined) out.push({ path: `[${i}]/${k}`, label: head + (labels[k] ?? k), text: show(v) })
    })
    return out
  }
  return [{ path: '', label: spec.label, text: show(value) }]
}

/** atoms の path のうち drop にあるものを除いて、値を組み直す。何も残らなければ null */
export function dropAtoms(spec: Spec, value: unknown, drop: Set<string>): unknown {
  if (value === null || value === undefined || !drop.size) return value ?? null
  const t = spec.type
  if (t === 'longtext') return sentences(value).filter((_, i) => !drop.has(`#${i}`)).join('') || null
  if (t === 'multi') {
    const kept = (value as string[]).filter((c) => !drop.has(`@${c}`))
    return kept.length ? kept : null
  }
  if (t === 'object') {
    const kept = Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k, v]) => v !== null && v !== undefined && !drop.has(`/${k}`)))
    return Object.keys(kept).length ? kept : null
  }
  if (t === 'list') {
    const rows: Record<string, unknown>[] = []
    const rid = rowId(spec)
    ;(value as Record<string, unknown>[]).forEach((row, i) => {
      if (row[rid] !== null && row[rid] !== undefined && drop.has(`[${i}]/${rid}`)) return
      const kept = Object.fromEntries(Object.entries(row).filter(([k, v]) => v !== null && v !== undefined && !drop.has(`[${i}]/${k}`)))
      if (Object.keys(kept).length) rows.push(kept)
    })
    return rows.length ? rows : null
  }
  return drop.has('') ? null : value
}

/** 原本の場面の種類のうち、書類を写したもの */
export const DOC_SCENE_KINDS = new Set(['書類'])

/** 出どころが書類だけの欄（主治医意見書・被保険者証から写す欄など）。会話からは書かない */
export const needsDocument = (spec: Spec) => spec.source.length > 0 && spec.source.every((x) => x.startsWith('doc'))

/**
 * 2 回目の直しを受け入れるか。→ [値, 根拠, 入れなかった理由]。直しがなければ [null, [], null]。
 * 直した欄は、新しい記録を根拠に挙げていなければ入れない（前の記録だけで書き直すと、1 回目に書かなかったことを推測で足しやすい）。
 */
export function acceptUpdate(spec: Spec, rec: { changed?: boolean, value?: unknown, from?: unknown }, current: unknown, newIds: Set<string>, known: Set<string>): [unknown, string[], string | null] {
  if (!rec.changed || rec.value === null || rec.value === undefined) return [null, [], null]
  const [v, problems] = validateValue(spec, rec.value)
  if (v === null) return [null, [], `値の問題: ${problems.join(' / ')}`]
  if (isDeepStrictEqual(v, current ?? null)) return [null, [], null]
  const cite = (Array.isArray(rec.from) ? rec.from : []).filter((i): i is string => typeof i === 'string' && known.has(i))
  if (!cite.some((i) => newIds.has(i))) return [null, [], '新しい記録を根拠に挙げていない']
  return [v, cite, null]
}
