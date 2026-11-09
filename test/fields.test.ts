// fields.json の属性（shared・requires・detail・rowKey）の指す先が実在するか。見本と正解のデータが型どおりか。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { BY_KEY, FIELD_LIST, SHARED_KEYS, choicesOf, subFieldsOf, type FieldSpec } from '../core/fields.ts'
import { validValue } from '../core/schema.ts'

/** 前提の値が、前提の欄の値として持てるか */
function okRequiredValue(target: FieldSpec, v: unknown): boolean {
  switch (target.type) {
    case 'enum': case 'multi': return typeof v === 'string' && choicesOf(target).includes(v)
    case 'bool': return typeof v === 'boolean'
    case 'number': return typeof v === 'number'
    default: return false
  }
}

/** 欄とその中の項目を、まとまりごとにたどる */
function* groups(): Generator<{ where: string, siblings: FieldSpec[] }> {
  function* walk(where: string, fs: FieldSpec[]): Generator<{ where: string, siblings: FieldSpec[] }> {
    yield { where, siblings: fs }
    for (const s of fs) if (s.type === 'object' || s.type === 'list') yield* walk(`${where}.${s.key}`, subFieldsOf(s))
  }
  for (const f of FIELD_LIST) if (f.type === 'object' || f.type === 'list') yield* walk(f.key, subFieldsOf(f))
}

test('欄の requires は、実在する欄の、持てる値を指す', () => {
  for (const f of FIELD_LIST) {
    for (const [k, vs] of Object.entries(f.requires ?? {})) {
      const target = BY_KEY.get(k)
      assert.ok(target, `${f.key}: 前提の欄 ${k} がない`)
      assert.notEqual(k, f.key, `${f.key}: 自分を前提にしている`)
      assert.ok(vs.length > 0, `${f.key}: 前提の値がない`)
      for (const v of vs) assert.ok(okRequiredValue(target, v), `${f.key}: ${k} は ${JSON.stringify(v)} を持てない`)
    }
  }
})

test('中の項目の requires と detail は、同じまとまりの中の項目を指す', () => {
  for (const { where, siblings } of groups()) {
    const byKey = new Map(siblings.map((s) => [s.key, s]))
    for (const s of siblings) {
      for (const [k, vs] of Object.entries(s.requires ?? {})) {
        const target = byKey.get(k)
        assert.ok(target, `${where}.${s.key}: 前提の項目 ${k} が同じまとまりにない`)
        for (const v of vs) assert.ok(okRequiredValue(target, v), `${where}.${s.key}: ${k} は ${JSON.stringify(v)} を持てない`)
      }
      if (s.detail) {
        const d = byKey.get(s.detail)
        assert.ok(d, `${where}.${s.key}: 詳しい欄 ${s.detail} が同じまとまりにない`)
        assert.ok(d.type === 'text' || d.type === 'longtext', `${where}.${s.key}: 詳しい欄 ${s.detail} が文字の項目でない`)
      }
    }
  }
})

test('list にはどれも rowKey があり、"order" か中の項目を指す', () => {
  const lists: { where: string, f: FieldSpec }[] = FIELD_LIST.filter((f) => f.type === 'list').map((f) => ({ where: f.key, f }))
  for (const { where, siblings } of groups()) for (const s of siblings) if (s.type === 'list') lists.push({ where: `${where}.${s.key}`, f: s })
  assert.ok(lists.length > 0)
  for (const { where, f } of lists) {
    assert.ok(f.rowKey, `${where}: rowKey がない`)
    if (f.rowKey === 'order') continue
    const k = subFieldsOf(f).find((s) => s.key === f.rowKey)
    assert.ok(k, `${where}: rowKey ${f.rowKey} が中の項目にない`)
    assert.ok(['enum', 'text', 'date', 'number'].includes(k.type), `${where}: rowKey ${f.rowKey} が 1 つの値の項目でない`)
  }
})

test('shared の欄は 1 つの値の欄で、アセスメントと入院時情報提供書の両方にある', () => {
  assert.ok(SHARED_KEYS.size > 0)
  for (const k of SHARED_KEYS) {
    const f = BY_KEY.get(k)!
    assert.ok(!['object', 'list', 'image'].includes(f.type), `${k}: shared は 1 つの値の欄だけ`)
    assert.ok(f.forms?.assess && f.forms?.adm, `${k}: アセスメントと入院時情報提供書の両方に使われていない`)
  }
})

const load = (rel: string) => {
  const raw = JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as Record<string, unknown>
  delete raw._comment
  return raw
}

for (const [name, rel, strictDates] of [
  ['見本の花子さん', '../forms/samples/見本_花子.json', false],
  ['正解 v1', '../eval/scenario/gold/用紙/アセスメント_v1.json', true],
  ['正解 v2', '../eval/scenario/gold/用紙/アセスメント_v2.json', true],
] as const) {
  test(`${name} の値は fields.json の型どおり`, () => {
    const bad = Object.entries(load(rel)).filter(([k, v]) => !validValue(k, v, { strictDates })).map(([k]) => k)
    assert.deepEqual(bad, [])
  })
}
