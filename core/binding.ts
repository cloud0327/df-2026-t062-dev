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

// ---------- 読む key ----------

function condKeys(c: Cond | undefined, own: Ref, out: Set<string>) {
  if (!c) return
  if ('all' in c) c.all.forEach((x) => condKeys(x, own, out))
  else if ('any' in c) c.any.forEach((x) => condKeys(x, own, out))
  else out.add((c.ref ?? own).key)
}

/** その印字欄の表示が読む key（前提の欄も含む） */
export function keysOf(b: Binding): string[] {
  const out = new Set<string>([b.ref.key])
  if ('when' in b) condKeys(b.when, b.ref, out)
  if (b.op === 'option@1') {
    condKeys(b.if, b.ref, out)
    for (const a of [b.edit?.on, b.edit?.off]) if (a && 'set' in a) for (const s of a.set) out.add((s.ref ?? b.ref).key)
  }
  if (b.op === 'text@1') for (const alt of b.or ?? []) for (const r of 'concat' in alt ? alt.concat : [alt]) out.add(r.key)
  if (b.op === 'date@1') for (const r of b.yearFrom ?? []) out.add(r.key)
  if (b.op === 'ageAt@1') { out.add(b.birth.key); b.at.forEach((r) => out.add(r.key)) }
  for (const k of Object.keys(BY_KEY.get(b.ref.key)?.requires ?? {})) out.add(k)
  return [...out]
}

/** 様式が読む key の全部 */
export function formKeys(bindings: Bindings): string[] {
  const out = new Set<string>()
  for (const b of Object.values(bindings)) for (const k of keysOf(b)) out.add(k)
  return [...out].sort()
}

/** 対応の確かめ（読み込むときと CI）。key・項目が fields.json にあるか、丸・✓ の直しが決まっているか */
export function checkBindings(bindings: Bindings): string[] {
  const errors: string[] = []
  const refOk = (slot: string, r: Ref) => {
    if (!BY_KEY.has(r.key)) errors.push(`${slot}: fields.json にない key ${r.key}`)
    else {
      const names = (r.path ?? []).filter((s): s is string => typeof s === 'string')
      if (specsAlong(r).length !== names.length + 1) errors.push(`${slot}: ${r.key} に項目 ${names.join('.')} がない`)
    }
  }
  for (const [slot, b] of Object.entries(bindings)) {
    refOk(slot, b.ref)
    if (b.op === 'option@1' && !b.edit && !canToggle(b.is)) errors.push(`${slot}: 丸・✓ を付け外ししたときの動き（edit）が決まっていない`)
    if (b.op === 'option@1' && !b.is && !b.if) errors.push(`${slot}: 丸・✓ を付ける条件がない`)
    if (b.op === 'text@1') for (const alt of b.or ?? []) for (const r of 'concat' in alt ? alt.concat : [alt]) refOk(slot, r)
    if (b.op === 'ageAt@1') { refOk(slot, b.birth); b.at.forEach((r) => refOk(slot, r)) }
  }
  return errors
}
