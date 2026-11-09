// 印字欄の対応（forms/seed/<様式>/bindings.json）と共通の変換（core/binding.ts）の確かめ。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { readSeed } from '../forms/admin/files.ts'
import type { FormKind } from '../core/form.ts'
import { checkBindings, editSlot, keysOf, renderAll, renderSlot, specOf, type Binding, type Values } from '../core/binding.ts'
import { choicesOf } from '../core/fields.ts'

const IDS: FormKind[] = ['assessment', 'admission']
const FORMS = { assessment: readSeed('assessment'), admission: readSeed('admission') }
const json = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'))
const gold = (v: string): Values => { const raw = json(`../eval/scenario/gold/用紙/アセスメント_${v}.json`); delete raw._comment; return raw }
const apply = (values: Values, r: ReturnType<typeof editSlot>): Values => {
  assert.ok('changes' in r, `直せなかった: ${'reason' in r ? r.reason : ''}`)
  const out = { ...values }
  for (const c of r.changes) if (c.value === null) delete out[c.key]; else out[c.key] = c.value
  return out
}

/** 前の手書きの変換と、わざと違えたところ（データの組 → 印字欄 → 理由） */
const INTENDED: Record<FormKind, Record<string, Record<string, string>>> = {
  assessment: {},
  admission: Object.fromEntries(['extra:status=新規申請中', 'extra:status=未申請'].map((c) => [c, {
    '1_要支援': '要介護度は、認定済・区分変更申請中・更新申請中のときだけ出す（fields.json の requires）',
    '1_要支援の数': '同上',
  }])),
}

for (const id of IDS) {
  const form = FORMS[id]

  test(`${id}: 全部の印字欄に対応があり、対応の中身が正しい`, () => {
    const names = form.schemas.flat().map((s) => s.name)
    assert.deepEqual(names.filter((n) => !form.bindings[n]), [], '対応のない印字欄')
    assert.deepEqual(Object.keys(form.bindings).filter((n) => !names.includes(n)), [], '印字欄のない対応')
    assert.deepEqual(checkBindings(form.bindings), [])
  })

  test(`${id}: 前の変換と同じ表示になる（固定のデータの全部の組・全部の印字欄）`, () => {
    const fx = json(`./fixtures/render/${id}.json`) as { empty: Record<string, string>, cases: { id: string, data: Values, diff: Record<string, string> }[] }
    const bad: string[] = []
    for (const c of fx.cases) {
      const want = { ...fx.empty, ...c.diff }
      const got = renderAll(form.bindings, c.data)
      for (const slot of Object.keys(want)) {
        if ((got[slot] ?? '') === (want[slot] ?? '') || INTENDED[id][c.id]?.[slot]) continue
        bad.push(`${c.id} ${slot}: 前 ${JSON.stringify(want[slot])} 今 ${JSON.stringify(got[slot])}`)
      }
    }
    assert.deepEqual(bad.slice(0, 20), [])
  })

  test(`${id}: 甲斐さんの v1 で、全部の印字欄を同じ文字で打ち直しても表示が変わらない`, () => {
    const values = gold('v1')
    const before = renderAll(form.bindings, values)
    for (const slot of Object.keys(before)) {
      const r = editSlot(form.bindings, values, slot, before[slot])
      assert.ok('changes' in r && r.changes.length === 0, `${slot} を打ち直すと値が変わった`)
    }
  })

  test(`${id}: 空から打つと、その文字になるか、断る理由が出る。直すのはその欄が読む key だけ`, () => {
    for (const [slot, b] of Object.entries(form.bindings)) {
      const sample = sampleText(b)
      if (sample === null) continue
      const [text, want] = Array.isArray(sample) ? sample : [sample, sample]
      const r = editSlot(form.bindings, {}, slot, text)
      if ('reason' in r) { assert.ok(r.reason.length > 0); continue }
      const after = apply({}, r)
      assert.equal(renderSlot(b, after), want, `${slot} に ${text} を打ったら ${renderSlot(b, after)} になった`)
      const keys = keysOf(b)
      for (const c of r.changes) assert.ok(keys.includes(c.key), `${slot} の直しが、読まない key ${c.key} を変えた`)
    }
  })
}

/** 印字欄に打つ見本の文字（その欄で持てる値になるもの）。表示が打った文字と違う欄は [打つ文字, 表示] */
function sampleText(b: Binding): string | [string, string] | null {
  switch (b.op) {
    case 'option@1': return b.ui === 'circle' ? 'true' : '✓'
    case 'era@1': return 'true'
    case 'symbol@1': return b.options[0].text
    case 'date@1': return b.part !== 'y' ? '5' : b.year === 'number' ? ['S5', '5'] : b.year === 'nameUnlessMTS' ? ['R3', '令和3'] : 'R3'
    case 'rhythm@1': return '□ 起床'
    case 'ageAt@1': return '80'
    case 'join@1': return null
    case 'text@1': {
      const s = specOf(b.ref)
      if (s?.type === 'number') return '12'
      if (s?.type === 'enum' && !s.detail) return choicesOf(s)[0]
      return b.prefix ? `${b.prefix.text}ZQ7` : 'ZQ7'
    }
  }
}

// ---------- 決めた動き ----------
const A = FORMS.assessment.bindings
const M = FORMS.admission.bindings

test('丸を付けると選択肢の値になり、外すと消える', () => {
  const on = apply({}, editSlot(A, {}, 'p1_受付方法_訪問', 'true'))
  assert.equal(on['intake.method'], '訪問')
  const off = apply(on, editSlot(A, on, 'p1_受付方法_訪問', 'false'))
  assert.equal(off['intake.method'], undefined)
})

test('前提の欄が空なら一緒に入れ、別の値なら断る（受付方法の「その他」の中身）', () => {
  const v = apply({}, editSlot(A, {}, 'p1_受付方法_その他の内容', '自宅で'))
  assert.deepEqual([v['intake.method'], v['intake.methodOther']], ['その他', '自宅で'])
  const r = editSlot(A, { 'intake.method': '訪問' }, 'p1_受付方法_その他の内容', '自宅で')
  assert.ok('reason' in r && r.reason.includes('訪問'))
})

test('日付は年だけ・年月だけでも持てる。暦にない日は断る', () => {
  let v: Values = {}
  v = apply(v, editSlot(A, v, 'p1_相談受付日_年', 'R3'))
  assert.equal(v['intake.date'], '2021')
  assert.equal(renderAll(A, v)['p1_相談受付日_年'], 'R3')
  v = apply(v, editSlot(A, v, 'p1_相談受付日_月', '2'))
  assert.equal(v['intake.date'], '2021-02')
  assert.ok('reason' in editSlot(A, v, 'p1_相談受付日_日', '30'))
  v = apply(v, editSlot(A, v, 'p1_相談受付日_日', '20'))
  assert.equal(v['intake.date'], '2021-02-20')
  assert.ok(!Object.keys(v).some((k) => k.startsWith('slot:')))
})

test('生年月日の元号の丸を付け替えると、和暦の年はそのままで元号が変わる', () => {
  const v = apply({ 'person.birthDate': '1931-02-03' }, editSlot(A, { 'person.birthDate': '1931-02-03' }, 'p1_生年月日_T', 'true'))
  assert.equal(v['person.birthDate'], '1917-02-03') // 昭和 6 年 → 大正 6 年
  assert.ok('reason' in editSlot(A, {}, 'p1_生年月日_年', '5'), '元号がないと年が決まらない')
  assert.equal(apply({}, editSlot(A, {}, 'p1_生年月日_年', 'S5'))['person.birthDate'], '1930')
})

test('援助の表のマスは、○ と △ をそれぞれの選択肢に戻す', () => {
  const v = apply({}, editSlot(A, {}, 'p5_体位変換介助_家族実施', '△'))
  assert.equal(renderAll(A, v)['p5_体位変換介助_家族実施'], '△')
  assert.ok('reason' in editSlot(A, {}, 'p5_体位変換介助_家族実施', '×'))
})

test('続柄は、選択肢になければ詳しい欄に入る', () => {
  const v = apply({}, editSlot(A, {}, 'p1_緊急連絡先_続柄', '長男の嫁'))
  assert.deepEqual(v['emergencyContact'], { relationshipDetail: '長男の嫁' })
  const w = apply(v, editSlot(A, v, 'p1_緊急連絡先_続柄', '子'))
  assert.deepEqual(w['emergencyContact'], { relationship: '子' })
})

test('家族の名前の頭の ※ は、主たる介護者の印になる', () => {
  const v = apply({}, editSlot(A, {}, 'p2_家族1_氏名', '※一郎'))
  assert.deepEqual(v['family.members'], [{ name: '一郎', isMainCaregiver: true }])
  const w = apply(v, editSlot(A, v, 'p2_家族1_氏名', '一郎'))
  assert.deepEqual(w['family.members'], [{ name: '一郎' }])
})

test('入院時の主介護者の名前を直すと、同じ名前の家族に印を移すか、新しい家族を足す', () => {
  const base = { 'family.members': [{ name: '一郎', isMainCaregiver: true }, { name: '花子' }] }
  const moved = apply(base, editSlot(M, base, '2_主介護者_氏名', '花子'))
  assert.deepEqual(moved['family.members'], [{ name: '一郎' }, { name: '花子', isMainCaregiver: true }])
  const added = apply(base, editSlot(M, base, '2_主介護者_氏名', '次郎'))
  assert.deepEqual(added['family.members'], [{ name: '一郎' }, { name: '花子' }, { name: '次郎', isMainCaregiver: true }])
})

test('年金の内容は「、」で区切って、種類の名前で始まる言い方を行にする', () => {
  const v = apply({}, editSlot(A, {}, 'p3_年金_老齢関係_内容', '国民年金 月6万、厚生年金'))
  assert.deepEqual(v['pensions'], [{ kind: '国民年金（老齢基礎）', detail: '国民年金 月6万' }, { kind: '厚生年金（老齢）' }])
  assert.equal(renderAll(A, v)['p3_年金_老齢関係'], '✓')
  assert.ok('reason' in editSlot(A, {}, 'p3_年金_老齢関係_内容', '月6万'))
})

test('住宅改修は、行があって量が 0 なら「なし」', () => {
  const v = apply({}, editSlot(A, {}, 'p2_住宅改修_なし', 'true'))
  assert.deepEqual(v['services.used'], [{ kind: '住宅改修', amount: 0 }])
  const r = renderAll(A, v)
  assert.deepEqual([r['p2_住宅改修_あり'], r['p2_住宅改修_なし']], ['false', 'true'])
})

test('1 日のスケジュールの生活リズムは、頭の記号を印にする', () => {
  const v = apply({}, editSlot(A, {}, 'p11_7時_生活リズム', '□○ 起床'))
  assert.deepEqual(v['dailySchedule'], [{ time: '7', rhythmMark: ['□起床', '○排尿'], rhythm: '起床' }])
})
