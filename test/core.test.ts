import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planBatch } from '../core/apply-batch.ts'
import { revertHunk, saveOneHunk, sentenceDiff } from '../core/diff.ts'
import { syncStatus } from '../core/document-sync.ts'

test('書類間の差異: 元の変更と未保存・確認済みの違いを判定する', () => {
  assert.equal(syncStatus('新', '新', '旧', '新'), null)
  assert.equal(syncStatus('旧', '別の記載', '旧', '旧'), 'different')
  assert.equal(syncStatus('新', '旧', '旧', '旧'), 'pending')
  assert.equal(syncStatus('新', '旧', '旧', '新'), 'review')
  assert.equal(syncStatus(null, '旧', '旧', null), 'review')
  assert.equal(syncStatus({ a: 1, b: 2 }, { b: 2, a: 1 }, null, { a: 1, b: 2 }), null)
})

test('書き換えの決まり: ケアマネの欄は書かず、AI の欄は書き換え、空の欄は足す', () => {
  const plan = planBatch(
    {
      'person.lifeHistory': { value: '前の文。', by: 'ai' },
      'housing.notes': { value: 'ケアマネが書いた。', by: 'cm' },
    },
    {
      'person.lifeHistory': { value: '前の文。新しい文。' },
      'housing.notes': { value: 'AI の文。' },
      'intake.method': { value: '電話' },
    },
  )
  assert.deepEqual(plan.changes.map((c) => [c.key, c.op, c.before]), [
    ['person.lifeHistory', 'update', '前の文。'],
    ['intake.method', 'add', null],
  ])
  assert.deepEqual(plan.kept, [{ key: 'housing.notes', reason: 'cm' }])
})

test('書き換えの決まり: 同じ値・空の値・AI が書かない欄は書き込みに入れない', () => {
  const plan = planBatch(
    { 'intake.method': { value: '電話', by: 'ai' } },
    { 'intake.method': { value: '電話' }, 'person.interests': { value: '' }, 'assessment.initialDate': { value: '2021-01-21' } },
  )
  assert.equal(plan.changes.length, 0)
  assert.deepEqual(plan.skipped.map((s) => s.reason).sort(), ['empty', 'not-ai-field', 'same'])
})

test('文ごとの差分: 足した文、1 か所だけ保存、1 か所だけ戻す', () => {
  const before = '病院では介助浴をしている。自宅の浴室は手狭。'
  const after = '病院では介助浴をしている。自宅の浴室は手狭。シャワーチェアを置けば入れる。'
  const h = sentenceDiff(before, after)
  assert.equal(h.length, 1)
  assert.equal(h[0].kind, '文を足した')
  assert.equal(h[0].ins, 'シャワーチェアを置けば入れる。')
  assert.equal(revertHunk(after, h[0]), before)

  const two = '病院ではシャワーチェアで介助浴をしている。自宅の浴室は手狭。シャワーチェアを置けば入れる。'
  const hs = sentenceDiff(before, two)
  assert.equal(hs.length, 2)
  // 2 か所目（足した文）だけを保存すると、1 か所目（書き換え）は前の文のまま
  assert.equal(saveOneHunk(before, two, 1), after)
})
