// 画面の「書き方を相談する」の決めごと（src/components/petChat.ts）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cardAction, historyFor, MAX_HISTORY, sentenceChanges, type ChatEntry, type ProposalCard } from '../src/components/petChat.ts'

const card = (over: Partial<ProposalCard> = {}): ProposalCard => ({ key: 'complaint.person', label: '相談内容（本人）', before: '前の文。', after: '新しい文。', state: 'ready', ...over })

test('「用紙に入れる」: 欄が案を出したときのままなら、新しい文を入れる', () => {
  assert.deepEqual(cardAction(card(), '前の文。'), { kind: 'set', value: '新しい文。', next: 'applied' })
})

test('「用紙に入れる」: 空の欄への案は、欄が空のままなら入れる（undefined も空とみなす）', () => {
  assert.deepEqual(cardAction(card({ before: null }), undefined), { kind: 'set', value: '新しい文。', next: 'applied' })
})

test('「用紙に入れる」: 案を出したあとに欄が変わっていたら、入れずに知らせる', () => {
  assert.deepEqual(cardAction(card(), 'ケアマネが直した文。'), { kind: 'stale' })
})

test('「戻す」: 入れた文のままなら、前の文に戻す。前が空なら空にする', () => {
  assert.deepEqual(cardAction(card({ state: 'applied' }), '新しい文。'), { kind: 'set', value: '前の文。', next: 'ready' })
  assert.deepEqual(cardAction(card({ state: 'applied', before: null }), '新しい文。'), { kind: 'set', value: null, next: 'ready' })
})

test('「戻す」: 入れたあとに欄が直されていたら、戻さずに知らせる', () => {
  assert.deepEqual(cardAction(card({ state: 'applied' }), '新しい文。さらに足した。'), { kind: 'stale' })
})

test('送るやり取りは、文だけを古い順に、最後の分だけにする', () => {
  const entries: ChatEntry[] = Array.from({ length: MAX_HISTORY + 5 }, (_, i) => ({
    id: i, role: i % 2 ? 'pet' : 'user', text: `文${i}`, proposals: i % 2 ? [card()] : undefined,
  }))
  entries.push({ id: 999, role: 'user', text: '今の相談' })
  const h = historyFor(entries)
  assert.equal(h.length, MAX_HISTORY)
  assert.deepEqual(h.at(-1), { role: 'user', text: '今の相談' })
  assert.ok(h.every((m) => Object.keys(m).sort().join() === 'role,text'))
})

test('案のカードの差分は、文の途中で切らずに、消える文と足す文を出す', () => {
  assert.deepEqual(sentenceChanges('病院ではシャワー浴。自宅の浴室は狭い。', '病院ではシャワーチェアで介助浴（NS）。自宅の浴室は狭い。'), {
    del: ['病院ではシャワー浴。'], ins: ['病院ではシャワーチェアで介助浴（NS）。'],
  })
  assert.deepEqual(sentenceChanges(null, '農業を営んできた。'), { del: [], ins: ['農業を営んできた。'] })
  assert.deepEqual(sentenceChanges('同じ。', '同じ。足した。'), { del: [], ins: ['足した。'] })
})
