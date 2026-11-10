export { keysOf, formKeys, checkBindings } from './binding/validation.ts'
// 印字欄の対応（bindings）と、共通の変換。様式ごとの手書きのコードを使わず、対応のデータだけで動く。
//   renderAll … 欄の値 → 印字欄の文字（PDF・画面の表示）
//   editSlot  … 印字欄を直した文字 → 欄の値の変更、または断る理由
//   keysOf    … その印字欄が読む key（印・保存の範囲）
//
// 対応は「印字欄の名前 → Binding」の JSON（forms/seed/<様式>/bindings.json）。op は名前に版を付け、一度出した動きは変えない。
// 前提（fields.json の requires）と詳しい欄（detail）は fields.json から読むので、対応には書かない。


import { canToggle } from './binding/edit.ts'
export { editSlot } from './binding/edit.ts'


import { RHYTHM_MARK, labelOf, joinToken, renderSlot } from './binding/render.ts'
export { renderSlot, renderAll } from './binding/render.ts'


import { specsAlong, specOf, test, holdsCond, conflicts, prepare } from './binding/conditions.ts'

export { specOf, test, holdsCond } from './binding/conditions.ts'


import { ERAS, parseIso, toIso, eraOf, eraYear, parseYear, onCalendar, yearText, ageAt } from './binding/dates.ts'

import type { Ymd } from './binding/dates.ts'
export { parseYear } from './binding/dates.ts'


import { BY_KEY, choicesOf, subFieldsOf, type FieldSpec } from './fields.ts'
import { validValue } from './schema.ts'
import type { Values, Change, Scalar, Step, Ref, Test, Cond, Action, EraShort, Binding, Bindings, EditResult } from './binding/types.ts'
export type { Values, Change, Scalar, Step, Ref, Test, Cond, Action, EraShort, Binding, Bindings, EditResult } from './binding/types.ts'

import { isEmpty, str, toHalf, same, getRef, Misplaced, Draft } from './binding/values.ts'
export { isEmpty, getRef } from './binding/values.ts'

