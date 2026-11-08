import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { FORMS } from '../forms/index.ts'
import { applyChanges, editSlot, renderSlots, slotMarks, type Values } from '../core/slots.ts'

const gold = (v: string): Values => {
  const raw = JSON.parse(readFileSync(new URL(`../eval/scenario/gold/用紙/アセスメント_${v}.json`, import.meta.url), 'utf8'))
  delete raw._comment
  return raw
}

for (const id of ['assessment', 'admission'] as const) {
  test(`${id}: 甲斐さんの v1 で、全部の印字欄を同じ文字で打ち直しても表示が変わらない`, () => {
    const form = FORMS[id]
    const values = gold('v1')
    const before = renderSlots(form, values)
    for (const slot of Object.keys(before)) {
      const next = applyChanges(values, editSlot(form, values, slot, before[slot]))
      assert.deepEqual(renderSlots(form, next), before, `${slot} を打ち直すと表示が変わった`)
    }
  })
}

test('丸を付けると選択肢の値になり、外すと消える', () => {
  const form = FORMS.assessment
  const on = applyChanges({}, editSlot(form, {}, 'p1_受付方法_訪問', 'true'))
  assert.equal(on['intake.method'], '訪問')
  const off = applyChanges(on, editSlot(form, on, 'p1_受付方法_訪問', 'false'))
  assert.equal(off['intake.method'], undefined)
})

test('日付は年・月・日がそろったら西暦の値になり、それまでは打った文字を残す', () => {
  const form = FORMS.assessment
  let v: Values = {}
  v = applyChanges(v, editSlot(form, v, 'p1_相談受付日_年', 'R3'))
  assert.equal(v['intake.date'], undefined)
  assert.equal(renderSlots(form, v)['p1_相談受付日_年'], 'R3')
  v = applyChanges(v, editSlot(form, v, 'p1_相談受付日_月', '1'))
  v = applyChanges(v, editSlot(form, v, 'p1_相談受付日_日', '20'))
  assert.equal(v['intake.date'], '2021-01-20')
  assert.ok(!Object.keys(v).some((k) => k.startsWith('slot:')))
})

test('援助の表のマスは、○ と △ をそれぞれの選択肢に戻す', () => {
  const form = FORMS.assessment
  const slot = Object.entries(form.slotmap).find(([, e]) => e.kind === 'choiceText' && e.options.length === 2 && e.options[0].text === '○')?.[0]
  assert.ok(slot)
  const v = applyChanges({}, editSlot(form, {}, slot, '△'))
  assert.equal(renderSlots(form, v)[slot], '△')
})

test('対応のない欄は印字欄ごとの値で持ち、保存した値と違えば黄になる', () => {
  const form = FORMS.assessment
  const v = applyChanges({}, editSlot(form, {}, 'p1_受付方法_その他の内容', '自宅で'))
  assert.equal(v['slot:p1_受付方法_その他の内容'], '自宅で')
  const marks = slotMarks(form, v, {}, () => undefined)
  assert.equal(marks.get('p1_受付方法_その他の内容'), 'cm')
})
