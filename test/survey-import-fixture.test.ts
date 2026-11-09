import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { choicesOf, FIELD_LIST } from '../core/fields.ts'
import { SURVEY_IMPORT_KEYS, surveyChoice, surveyPage, type SurveyImportKey } from '../core/survey-import.ts'
import { HIROSHIMA_BOXES } from '../src/survey/hiroshima.ts'

test('認定調査票の正解表は55項目を網羅し、選択肢番号と転記先がアプリの定義と一致する', () => {
  const path = new URL('../eval/document-import/survey/gold.tsv', import.meta.url)
  const [, ...rows] = readFileSync(path, 'utf8').trimEnd().split('\n')
  const fields = FIELD_LIST.filter((f) => /^survey\.[1-5]_/.test(f.key) && f.source?.includes('doc:認定調査票'))
  assert.equal(fields.length, 55)
  assert.deepEqual([...SURVEY_IMPORT_KEYS].sort(), fields.map((field) => field.key).sort())
  assert.deepEqual(Object.keys(HIROSHIMA_BOXES).sort(), [...SURVEY_IMPORT_KEYS].sort())
  const remaining = new Map(fields.map((field) => [field.key, field]))

  for (const row of rows) {
    const [item, label, sourcePage, selected, assessmentPage, key, expected] = row.split('\t')
    const field = remaining.get(key)
    assert.ok(field, `未対応または重複: ${key}`)
    remaining.delete(key)
    assert.equal(field.label, `${item} ${label}`)
    const importKey = key as SurveyImportKey
    assert.equal(surveyPage(importKey), Number(sourcePage))
    assert.equal(field.forms?.assess, `p.${assessmentPage} ${item}`)
    const choices = choicesOf(field)
    assert.equal(HIROSHIMA_BOXES[importKey].length, choices.length, item)
    const indices = selected.split(',').map(Number)
    assert.ok(indices.every((n) => Number.isInteger(n) && n >= 1 && n <= choices.length), item)
    if (field.type !== 'multi') assert.equal(indices.length, 1, item)
    const values = indices.map((n) => choices[n - 1])
    const selection = field.type === 'multi' ? indices : indices[0]
    assert.deepEqual(JSON.parse(expected), field.type === 'multi' ? values : values[0], item)
    assert.deepEqual(surveyChoice(importKey, selection), JSON.parse(expected), item)
  }
  assert.deepEqual([...remaining.keys()], [])
})
