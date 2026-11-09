// アセスメントの必須の欄のうち、いくつ入っているか（利用者一覧のバー、作業画面の上の数）。
import { REQUIRED_ASSESS } from './fields.ts'

import { isEmpty } from './binding.ts'

export const REQUIRED_TOTAL = REQUIRED_ASSESS.length

const requiredGroups = REQUIRED_ASSESS.map((item) => Array.isArray(item) ? item : [item])
const hasValue = (keys: string[], values: Record<string, unknown>) => keys.some((key) => !isEmpty(values[key]))

export function countRequired(values: Record<string, unknown>): { filled: number, total: number } {
  return { filled: requiredGroups.filter((keys) => hasValue(keys, values)).length, total: REQUIRED_TOTAL }
}

export function missingRequiredKeys(values: Record<string, unknown>): Set<string> {
  return new Set(requiredGroups.filter((keys) => !hasValue(keys, values)).flat())
}
