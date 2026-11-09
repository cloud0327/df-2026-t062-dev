// 用紙の上の印字欄と、欄の値（fields.json の key）をつなぐ。様式の対応（bindings）を core/binding.ts の共通の仕組みで動かす。
//   renderSlots … 欄の値 → 印字欄の文字（PDF・画面の表示）
//   editSlot    … 印字欄を直した → どの key をどう変えるか、または断る理由
//   slotMarks   … 保存した値と今の値の違い → 印字欄ごとの印（橙＝AI、黄＝ケアマネ）
import type { FormDef } from '../forms/index.ts'
import { editSlot as editBinding, keysOf, renderAll, type Change, type EditResult, type Values } from './binding.ts'

export type { Change, EditResult, Values }
export type Who = 'ai' | 'cm'

/** 欄の値から、印字欄の文字を作る */
export function renderSlots(form: FormDef, values: Values): Record<string, string> {
  return renderAll(form.bindings, values)
}

/**
 * 印字欄 slot を text にしたときの、欄の値の変更（または断る理由）。
 * text は、丸なら 'true'/'false'、✓ の欄なら '✓'/''、文字の欄なら打った文字。
 */
export function editSlot(form: FormDef, values: Values, slot: string, text: string): EditResult {
  return editBinding(form.bindings, values, slot, text)
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

/** 印字欄の表示が読む key */
export function slotKeys(form: FormDef, slot: string): string[] {
  const b = form.bindings[slot]
  return b ? keysOf(b) : []
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * 保存した値（saved）と今の値（current）で、印字欄の文字が違う欄に印を付ける。
 * 誰が書いたかは、その欄が読む key のうち変わったものの by で決める（1 つでもケアマネなら黄）。
 */
export function slotMarks(form: FormDef, current: Values, saved: Values, byOf: (key: string) => Who | undefined): Map<string, Who> {
  const a = renderSlots(form, current)
  const b = renderSlots(form, saved)
  const out = new Map<string, Who>()
  for (const slot of Object.keys(a)) {
    if ((a[slot] ?? '') === (b[slot] ?? '')) continue
    const changed = slotKeys(form, slot).filter((k) => !same(current[k], saved[k]))
    out.set(slot, changed.some((k) => byOf(k) === 'cm') ? 'cm' : 'ai')
  }
  return out
}
