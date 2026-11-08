// 用紙の上の印字欄と、欄の値（fields.json の key）をつなぐ。
//   renderSlots … 欄の値 → 印字欄の文字（pdfme の toInputs ＋ 印字欄ごとの値）
//   editSlot    … 印字欄を直した → どの key をどう変えるか
//   slotMarks   … 保存した値と今の値の違い → 印字欄ごとの印（橙＝AI、黄＝ケアマネ）
// 対応表（forms/templates/<様式>/slotmap.json）できれいに戻せない印字欄は、`slot:<名前>` の値として持つ。
import type { FormDef, PathStep, SlotEntry } from '../forms/index.ts'

export type Values = Record<string, unknown>
export interface Change { key: string, value: unknown }
export type Who = 'ai' | 'cm'

export const SLOT_PREFIX = 'slot:'
export const isSlotKey = (key: string) => key.startsWith(SLOT_PREFIX)

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0)

/** 欄の値から、印字欄の文字を作る（印字欄ごとの値が優先） */
export function renderSlots(form: FormDef, values: Values): Record<string, string> {
  const data: Values = {}
  const overrides: Record<string, string> = {}
  for (const [k, v] of Object.entries(values)) {
    if (isSlotKey(k)) {
      if (typeof v === 'string') overrides[k.slice(SLOT_PREFIX.length)] = v
    } else if (!isEmpty(v)) data[k] = v
  }
  return { ...form.toInputs(data), ...overrides }
}

// ---------- 値の中の場所（path）を読む・書く ----------

const matches = (row: unknown, m: Record<string, string>) =>
  !!row && typeof row === 'object' && Object.entries(m).every(([k, v]) => (row as Record<string, unknown>)[k] === v)

export function getPath(value: unknown, path: PathStep[]): unknown {
  let cur = value
  for (const step of path) {
    if (cur === undefined || cur === null) return undefined
    if (typeof step === 'object') cur = Array.isArray(cur) ? cur.find((r) => matches(r, step)) : undefined
    else cur = (cur as Record<string | number, unknown>)[step]
  }
  return cur
}

function clean(v: unknown): unknown {
  if (Array.isArray(v)) {
    const rows = [...v]
    while (rows.length && isEmpty(rows[rows.length - 1])) rows.pop()
    return rows.length ? rows : null
  }
  if (v && typeof v === 'object') {
    const o = Object.fromEntries(Object.entries(v).filter(([, x]) => !isEmpty(x)))
    return Object.keys(o).length ? o : null
  }
  return isEmpty(v) ? null : v
}

export function setPath(value: unknown, path: PathStep[], leaf: unknown): unknown {
  if (path.length === 0) return clean(leaf)
  const [step, ...rest] = path
  if (typeof step === 'number') {
    const rows = Array.isArray(value) ? [...value] : []
    while (rows.length <= step) rows.push({})
    rows[step] = setPath(rows[step], rest, leaf) ?? {}
    return clean(rows)
  }
  if (typeof step === 'object') {
    const rows = Array.isArray(value) ? [...value] : []
    let i = rows.findIndex((r) => matches(r, step))
    if (i < 0) {
      if (isEmpty(leaf)) return clean(rows)
      rows.push({ ...step })
      i = rows.length - 1
    }
    rows[i] = setPath(rows[i], rest, leaf) ?? { ...step }
    return clean(rows)
  }
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}
  obj[step] = setPath(obj[step], rest, leaf)
  return clean(obj)
}

// ---------- 日付（和暦の年・月・日の 3 つの欄） ----------

const ERAS = [
  { short: 'R', start: 2019 }, { short: 'H', start: 1989 }, { short: 'S', start: 1926 },
  { short: 'T', start: 1912 }, { short: 'M', start: 1868 },
]

const toHalf = (t: string) => t.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).trim()

/** 「R3」→ 2021。元号の略号がなければ era（丸を付けた元号）を使う */
export function parseYear(text: string, era?: string): number | null {
  const t = toHalf(text).toUpperCase()
  const m = /^([MTSHR])?\s*(\d{1,4})$/.exec(t)
  if (!m) return null
  const n = Number(m[2])
  if (!m[1] && !era && n >= 1868) return n
  const e = ERAS.find((x) => x.short === (m[1] ?? era))
  return e ? e.start + n - 1 : null
}

function composeDate(y: number | null, m: string, d: string): string | null {
  const mm = Number(toHalf(m)), dd = Number(toHalf(d))
  if (!y || !Number.isInteger(mm) || !Number.isInteger(dd) || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  const iso = `${String(y).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  const dt = new Date(`${iso}T00:00:00Z`)
  return dt.getUTCMonth() + 1 === mm ? iso : null
}

const samePlace = (a: { key: string, path: PathStep[] }, b: { key: string, path: PathStep[] }) =>
  a.key === b.key && JSON.stringify(a.path) === JSON.stringify(b.path)

function dateEdit(form: FormDef, values: Values, slot: string, entry: Extract<SlotEntry, { kind: 'date' | 'era' }>, newText: string): Change[] {
  const rendered = renderSlots(form, values)
  const group = Object.entries(form.slotmap).filter(
    (x): x is [string, Extract<SlotEntry, { kind: 'date' | 'era' }>] => (x[1].kind === 'date' || x[1].kind === 'era') && samePlace(x[1], entry),
  )
  const text: Record<string, string> = Object.fromEntries(group.map(([n]) => [n, rendered[n] ?? '']))
  if (entry.kind === 'era') {
    for (const [n, e] of group) if (e.kind === 'era') text[n] = 'false'
    text[slot] = newText === 'true' ? 'true' : 'false'
  } else text[slot] = newText
  const part = (p: 'y' | 'm' | 'd') => group.find(([, e]) => e.kind === 'date' && e.part === p)?.[0]
  const era = group.find(([n, e]) => e.kind === 'era' && text[n] === 'true')?.[1] as { value?: string } | undefined
  const [yn, mn, dn] = [part('y'), part('m'), part('d')]
  const iso = yn && mn && dn ? composeDate(parseYear(text[yn], era?.value), text[mn], text[dn]) : null
  const top = values[entry.key]
  const changes: Change[] = []
  if (iso) {
    changes.push({ key: entry.key, value: setPath(top, entry.path, iso) })
    for (const [n] of group) if ((SLOT_PREFIX + n) in values) changes.push({ key: SLOT_PREFIX + n, value: null })
  } else {
    // まだ日付にならない（年だけ打った、など）。打った文字を印字欄ごとの値として残す
    const anyText = group.some(([n, e]) => e.kind === 'date' && toHalf(text[n]) !== '')
    changes.push({ key: entry.key, value: setPath(top, entry.path, null) })
    for (const [n, e] of group) {
      const keep = anyText && (e.kind === 'date' ? text[n] !== '' : text[n] === 'true')
      changes.push({ key: SLOT_PREFIX + n, value: keep ? text[n] : null })
    }
  }
  return changes
}

// ---------- 印字欄を直したとき ----------

/**
 * 印字欄 slot を newText にしたときの、欄の値の変更を返す。
 * newText は、丸なら 'true'/'false'、✓ の欄なら '✓'/''、文字の欄なら打った文字。
 */
export function editSlot(form: FormDef, values: Values, slot: string, newText: string): Change[] {
  const entry = form.slotmap[slot]
  const overrideKey = SLOT_PREFIX + slot
  const clearOverride: Change[] = overrideKey in values ? [{ key: overrideKey, value: null }] : []
  const asOverride = (): Change[] => {
    const base = renderSlots(form, { ...values, [overrideKey]: null })[slot] ?? ''
    return [{ key: overrideKey, value: newText === base ? null : newText }]
  }
  if (!entry || entry.kind === 'derived') return asOverride()

  const on = newText === 'true' || newText === '✓'
  const top = values[entry.key]
  const cur = getPath(top, entry.path)
  const set = (leaf: unknown): Change[] => [{ key: entry.key, value: setPath(top, entry.path, leaf) }, ...clearOverride]

  switch (entry.kind) {
    case 'enum':
      return on ? set(entry.value) : cur === entry.value ? set(null) : clearOverride
    case 'bool':
      return on ? set(entry.value) : cur === entry.value ? set(null) : clearOverride
    case 'multi': {
      const arr = Array.isArray(cur) ? cur.filter((x) => x !== entry.value) : []
      return set(on ? [...arr, entry.value] : arr)
    }
    case 'row': {
      const rows = Array.isArray(top) ? top : []
      const match = { [entry.keySub]: entry.value }
      const has = rows.some((r) => matches(r, match))
      if (on === has) return clearOverride
      const next = on ? [...rows, match] : rows.filter((r) => !matches(r, match))
      return [{ key: entry.key, value: next.length ? next : null }, ...clearOverride]
    }
    case 'text':
      return set(newText === '' ? null : newText)
    case 'number': {
      const t = toHalf(newText)
      if (t === '') return set(null)
      return /^-?\d+(\.\d+)?$/.test(t) ? set(Number(t)) : asOverride()
    }
    case 'choiceText': {
      const t = toHalf(newText)
      // 消したときは、今の値がこの欄の選択肢のときだけ消す（✓ の欄を外しても、ほかの選択肢は残す）
      if (t === '') return entry.options.some((o) => o.value === cur) ? set(null) : clearOverride
      const opt = entry.options.find((o) => o.text === t) ?? (entry.options.length === 1 && on ? entry.options[0] : undefined)
      return opt ? set(opt.value) : asOverride()
    }
    case 'date':
    case 'era':
      return dateEdit(form, values, slot, entry, newText)
  }
}

/** 変更を値に入れる（null は消す） */
export function applyChanges(values: Values, changes: Change[]): Values {
  const out = { ...values }
  for (const c of changes) {
    if (c.value === null || c.value === undefined) delete out[c.key]
    else out[c.key] = c.value
  }
  return out
}

// ---------- 印（保存したときからの違い） ----------

/** 印字欄の key（対応がない・derived のときは、印字欄ごとの値の key） */
export function slotKeys(form: FormDef, slot: string): string[] {
  const e = form.slotmap[slot]
  if (!e) return [SLOT_PREFIX + slot]
  if (e.kind === 'derived') return [...e.keys, SLOT_PREFIX + slot]
  return [e.key, SLOT_PREFIX + slot]
}

/**
 * 保存した値（saved）と今の値（current）で、印字欄の文字が違う欄に印を付ける。
 * 誰が書いたかは、その欄の key の by で決める（1 つでもケアマネなら黄）。
 */
export function slotMarks(form: FormDef, current: Values, saved: Values, byOf: (key: string) => Who | undefined): Map<string, Who> {
  const a = renderSlots(form, current)
  const b = renderSlots(form, saved)
  const out = new Map<string, Who>()
  for (const slot of Object.keys(a)) {
    if ((a[slot] ?? '') === (b[slot] ?? '')) continue
    const keys = slotKeys(form, slot)
    const overridden = (SLOT_PREFIX + slot) in current || (SLOT_PREFIX + slot) in saved
    const who = overridden || keys.some((k) => byOf(k) === 'cm') ? 'cm' : 'ai'
    out.set(slot, who)
  }
  return out
}
