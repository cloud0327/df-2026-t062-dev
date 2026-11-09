// AI の書き込み（録音のあとなど）を、今の用紙にどう入れるかを決める。DB には触らない（DB は api/worker の applyBatch）。
// 書き換えの決まり（AI基盤の設計 6 章）:
//   - 空の欄 → 書く（add）
//   - AI が書いた欄 → 新しい値なら書き換える（update）。保存のあとでも書き換える
//   - ケアマネが書いた・直した欄 → 書き換えない（kept）
//   - 同じ値なら書き込みに入れない。AI は欄を空にしない
//   - ケアマネの判断・事業所の設定・その場で聞く欄は、AI は書かない
import { aiMayWrite } from './fields.ts'
import type { Who } from './slots.ts'

export interface CurrentField {
  value: unknown
  by: Who
}

export interface BatchChange {
  key: string
  op: 'add' | 'update'
  before: unknown
  after: unknown
  cite?: string[]
}

export interface BatchPlan {
  changes: BatchChange[]
  kept: { key: string, reason: 'cm' }[]
  skipped: { key: string, reason: 'not-ai-field' | 'same' | 'empty' }[]
}

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0)

/** 値どうしが同じか（object のキーの順は問わない） */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (isEmpty(a) && isEmpty(b)) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => sameValue(x, (b as unknown[])[i]))
  const ka = Object.keys(a).filter((k) => !isEmpty((a as Record<string, unknown>)[k]))
  const kb = Object.keys(b as object).filter((k) => !isEmpty((b as Record<string, unknown>)[k]))
  return ka.length === kb.length && ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/**
 * proposed（AI が作った欄の値）を、current（反映する瞬間の用紙）に入れる計画を立てる。
 * before は必ず current から取る（AI に前の値を作らせない）。
 */
export function planBatch(
  current: Record<string, CurrentField | undefined>,
  proposed: Record<string, { value: unknown, cite?: string[] }>,
  /** プログラムが決める欄（アセスメント実施日など）。AI の欄でなくても書く（ケアマネの値は守る） */
  systemKeys: ReadonlySet<string> = new Set(),
): BatchPlan {
  const plan: BatchPlan = { changes: [], kept: [], skipped: [] }
  for (const [key, p] of Object.entries(proposed)) {
    if (!aiMayWrite(key) && !systemKeys.has(key)) { plan.skipped.push({ key, reason: 'not-ai-field' }); continue }
    if (isEmpty(p.value)) { plan.skipped.push({ key, reason: 'empty' }); continue }
    const cur = current[key]
    if (cur && !isEmpty(cur.value) && cur.by === 'cm') { plan.kept.push({ key, reason: 'cm' }); continue }
    if (cur && sameValue(cur.value, p.value)) { plan.skipped.push({ key, reason: 'same' }); continue }
    const before = cur && !isEmpty(cur.value) ? cur.value : null
    plan.changes.push({ key, op: before === null ? 'add' : 'update', before, after: p.value, ...(p.cite ? { cite: p.cite } : {}) })
  }
  return plan
}
