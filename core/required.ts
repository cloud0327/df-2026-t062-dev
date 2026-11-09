// アセスメントの必須の欄のうち、いくつ入っているか（利用者一覧のバー、作業画面の上の数）。
import { REQUIRED_ASSESS } from './fields.ts'

const filled = (v: unknown) =>
  !(v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) ||
    (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0))

export const REQUIRED_TOTAL = REQUIRED_ASSESS.length

export function countRequired(values: Record<string, unknown>): { filled: number, total: number } {
  let n = 0
  for (const item of REQUIRED_ASSESS) {
    const keys = Array.isArray(item) ? item : [item]
    if (keys.some((k) => filled(values[k]))) n++
  }
  return { filled: n, total: REQUIRED_TOTAL }
}
