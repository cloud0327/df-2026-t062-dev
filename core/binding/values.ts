
import type { Values, Change, Scalar, Step, Ref } from './types.ts'

// ---------- 値 ----------

export const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0)

export const str = (v: unknown) => (v === undefined || v === null ? '' : String(v))
export const toHalf = (t: string) => t.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).trim()
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function clean(v: unknown): unknown {
  if (Array.isArray(v)) {
    // 末尾の空の行だけを落とす（途中の行を詰めると、用紙の行の位置が変わる）
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

const isRowStep = (s: Step): s is { match: Record<string, Scalar>, nth?: number } | { flag: string } => typeof s === 'object'
const rowMatches = (row: unknown, s: { match: Record<string, Scalar> } | { flag: string }) =>
  !!row && typeof row === 'object' &&
  ('flag' in s ? (row as Record<string, unknown>)[s.flag] === true : Object.entries(s.match).every(([k, v]) => (row as Record<string, unknown>)[k] === v))

function rowIndex(rows: unknown[], s: { match: Record<string, Scalar>, nth?: number } | { flag: string }): number {
  let n = 'nth' in s ? s.nth ?? 0 : 0
  for (let i = 0; i < rows.length; i++) if (rowMatches(rows[i], s) && n-- === 0) return i
  return -1
}

function getIn(value: unknown, path: Step[]): unknown {
  let cur = value
  for (const step of path) {
    if (cur === undefined || cur === null) return undefined
    if (isRowStep(step)) {
      if (!Array.isArray(cur)) return undefined
      const i = rowIndex(cur, step)
      cur = i < 0 ? undefined : cur[i]
    } else cur = (cur as Record<string | number, unknown>)[step]
  }
  return cur
}

function setIn(value: unknown, path: Step[], leaf: unknown): unknown {
  if (path.length === 0) return clean(leaf)
  const [step, ...rest] = path
  if (typeof step === 'number') {
    const rows = Array.isArray(value) ? [...value] : []
    if (rows.length <= step && isEmpty(clean(setIn(undefined, rest, leaf)))) return clean(rows)
    // 用紙の n 行目に書いたら、n 行目に入れる（間の行は空の行）
    while (rows.length <= step) rows.push({})
    rows[step] = setIn(rows[step], rest, leaf) ?? {}
    return clean(rows)
  }
  if (isRowStep(step)) {
    const rows = Array.isArray(value) ? [...value] : []
    const i = rowIndex(rows, step)
    const seed = 'flag' in step ? { [step.flag]: true } : { ...step.match }
    if (i < 0) {
      const row = setIn(seed, rest, leaf)
      if (rest.length && isEmpty(clean(setIn({}, rest, leaf)))) return clean(rows)
      if (row) rows.push(row)
      return clean(rows)
    }
    const row = setIn(rows[i], rest, leaf)
    // 行を見分ける項目だけが残った行は、その行ごと消す
    if (row && !same(row, seed)) rows[i] = row
    else rows.splice(i, 1)
    return clean(rows)
  }
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}
  obj[step] = setIn(obj[step], rest, leaf)
  return clean(obj)
}

export const getRef = (values: Values, ref: Ref): unknown => getIn(values[ref.key], ref.path ?? [])

/** 書いた場所に値が入らなかった（「その他」の 2 行目を、1 行目より先に書いた、など） */
export class Misplaced extends Error {}

/** 直しの下書き。key ごとに丸ごと置き換え、最後に元と違う key だけを変更にする */
export class Draft {
  readonly base: Values
  readonly next: Values
  constructor(base: Values) { this.base = base; this.next = { ...base } }
  get(ref: Ref) { return getRef(this.next, ref) }
  set(ref: Ref, leaf: unknown) {
    this.next[ref.key] = setIn(this.next[ref.key], ref.path ?? [], leaf)
    if (!isEmpty(clean(leaf)) && !same(getRef(this.next, ref), clean(leaf))) throw new Misplaced()
  }
  changes(): Change[] {
    const keys = new Set([...Object.keys(this.base), ...Object.keys(this.next)])
    return [...keys].filter((k) => !same(this.base[k] ?? null, this.next[k] ?? null)).map((k) => ({ key: k, value: this.next[k] ?? null }))
  }
}
