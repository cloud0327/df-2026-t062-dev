import assert from 'node:assert/strict'
import { test } from 'node:test'
import { missingRequiredKeys } from '../core/required.ts'
import { toFormDef } from '../core/form.ts'
import { readSeed } from '../forms/admin/files.ts'
import { availableTopics, fieldTargets, mergeSurveyDrafts, reviewItems, stageSurvey, surveyOverlays } from '../src/components/petAssessment.ts'
import { pagesOf } from '../src/form/layout.ts'
import type { DocumentView } from '../src/lib/api.ts'
import type { SurveyPreview } from '../src/survey/readSurvey.ts'

const targets = fieldTargets(pagesOf(toFormDef({ ...readSeed('assessment'), id: 'test-assessment', version: 1, contentSha: 'test' })))
const preview: SurveyPreview = {
  fileName: 'survey.pdf', sha256: 'a'.repeat(64), identity: 'source p.1', recordedOn: '2026-11-04', readAt: '2026-11-05T00:00:00Z',
  candidates: [
    { key: 'survey.2_2', choice: 2, reason: null, preview: 'source p.2' },
    { key: 'survey.2_4', choice: null, reason: '複数の印があります', preview: 'source p.2' },
    { key: 'survey.2_5', choice: 3, reason: null, preview: 'source p.2' },
  ],
}

test('面談の話題は、実際の用紙にあり必須の空欄をフィールドIDで案内する', () => {
  const values = { 'complaint.person': '入力済み', 'cert.careLevel': '要介護2', 'survey.2_2': '見守り等' }
  const missing = missingRequiredKeys(values)
  assert.equal(missing.has('cert.expectedCareLevel'), false)
  assert.equal(missing.has('complaint.family'), false)
  const hints = availableTopics(values, targets)
  assert.ok(hints.every((topic) => topic.hints.every(({ key }) => missing.has(key) && targets.has(key))))
  assert.ok(!hints.some(({ title }) => title === 'ご本人の感じ方'))
  assert.equal(targets.get('complaint.person')?.pageIndex, 0)
  assert.equal(targets.get('survey.2_5')?.pageIndex, 5)
  assert.deepEqual(availableTopics({}, fieldTargets([])), [])
})

test('明確な認定調査票の候補だけを空欄に仮入力し、保存までは確認済みにならない', () => {
  const saved = { 'survey.2_5': '全介助' }
  const drafts = stageSurvey(preview, {}, saved)
  assert.deepEqual([...surveyOverlays(drafts, {}, saved, targets).keys()], ['p6_2-2_2'])
  assert.equal(surveyOverlays(drafts, {}, {}, targets).has('p6_2-5_3'), false)
  assert.equal(surveyOverlays(drafts, {}, saved, fieldTargets([])).size, 0)
  assert.equal(drafts[0].source.recordedOn, '2026-11-04')
  assert.equal(drafts[1].candidate.preview, 'source p.2')
  assert.deepEqual(reviewItems(null, {}, saved, drafts, targets).map((item) => item.confirmed), [false, false, false])
  const selected = { 'survey.2_2': '見守り等' }
  assert.equal(reviewItems(null, selected, saved, drafts, targets)[0].confirmed, false)
  assert.equal(reviewItems(null, selected, { ...saved, ...selected }, drafts, targets)[0].confirmed, true)
  assert.equal(surveyOverlays(drafts, selected, saved, targets).size, 0)
})

test('別の資料の値や用紙の値と矛盾した候補を上書きせず、根拠を保持する', () => {
  const first = stageSurvey(preview, {}, {})
  const other = { ...preview, sha256: 'b'.repeat(64), candidates: [{ ...preview.candidates[0], choice: 3 }] }
  const merged = mergeSurveyDrafts(first, stageSurvey(other, {}, {}))
  assert.equal(merged[0].conflicts?.[0].candidate.choice, 2)
  assert.equal(merged[0].conflicts?.[0].candidate.preview, 'source p.2')
  assert.equal(surveyOverlays(merged, {}, {}, targets).has('p6_2-2_3'), false)
  assert.equal(reviewItems(null, {}, {}, merged, targets)[0].reason, '読み取った書類同士で値が異なります')
  const entered = { 'survey.2_2': '一部介助' }
  const existing = stageSurvey(preview, entered, entered)
  assert.equal(reviewItems(null, entered, entered, existing, targets)[0].reason, '用紙の現在値：一部介助')
  assert.equal(reviewItems(null, entered, entered, existing, targets)[0].confirmed, false)
})

test('同じ欄に新しい要確認候補が届いても、保存済みの入力値は確認済みに残る', () => {
  const key = 'survey.2_2'
  const current = { [key]: '見守り等' }
  const ambiguous = { ...preview, candidates: [{ ...preview.candidates[0], choice: null, reason: '印を確認できません' }] }
  const doc: Pick<DocumentView, 'fields'> = { fields: { [key]: {
    value: current[key], by: 'cm', aiValue: null, batchId: null, updatedAt: preview.readAt,
    surveySource: { kind: 'survey-import', fileName: preview.fileName, sha256: preview.sha256, recordedOn: preview.recordedOn, page: 2, choice: 2 },
  } } }
  const result = reviewItems(doc, current, current, stageSurvey(ambiguous, current, current), targets)
  assert.deepEqual(result.map(({ confirmed, reason }) => [confirmed, reason]), [[true, undefined], [false, '印を確認できません']])
})
