// 「書き方を相談する」のチャット（api/chat.ts）。Gemini は差し替えて、指示文と答えの受け取り方を確かめる。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { answerChat, chatPrompt, acceptProposals, fakeChat, type ChatDocument, type ChatRecording } from '../api/chat.ts'

const doc: ChatDocument = {
  kind: 'assessment',
  fields: {
    'complaint.person': { value: '家に帰りたい。', by: 'ai' },
    'intake.method': { value: '訪問', by: 'cm' },
    'person.lifeHistory': { value: null, by: 'ai' },
  },
}

const recordings: ChatRecording[] = [
  { recordedAt: '2026-01-21T01:00:00.000Z', utterances: [{ id: 'r1-0001', speaker: 'A', person: '本人', text: '早く家に帰って畑をしたい' }] },
  { recordedAt: '2026-01-25T01:00:00.000Z', utterances: [{ id: 'r2-0001', speaker: 'B', person: null, text: '浴室は狭いです' }] },
]

test('指示文に、用紙の今の値・録音の発言・やり取りが入る', () => {
  const p = chatPrompt({ document: doc, recordings, messages: [{ role: 'user', text: '相談内容の書き方を教えて' }] })
  assert.match(p, /complaint\.person（相談内容（本人））: 家に帰りたい。/)
  assert.match(p, /intake\.method（相談受付の方法）: 訪問/)
  assert.match(p, /\[r1-0001\] 本人: 早く家に帰って畑をしたい/)
  // 人が決まっていない発言は、話者の記号で出す
  assert.match(p, /\[r2-0001\] B: 浴室は狭いです/)
  assert.match(p, /ケアマネ: 相談内容の書き方を教えて/)
})

test('録音がないときは、ないことを指示文に書く', () => {
  const p = chatPrompt({ document: doc, recordings: [], messages: [{ role: 'user', text: 'こんにちは' }] })
  assert.match(p, /録音はまだありません/)
})

test('書き換えの案は、この書類の文章の欄で、値の形が合い、今と違うものだけを受け取る', () => {
  const got = acceptProposals([
    { key: 'complaint.person', value: '自宅に帰って畑仕事をしたい（本人）。' },
    { key: 'person.lifeHistory', value: '農業を営んできた。' },
    { key: 'no.such.key', value: 'x' }, // ない欄
    { key: 'intake.method', value: '電話' }, // 文章でない欄
    { key: 'complaint.family', value: '' }, // 空の文
    { key: 'complaint.person', value: '家に帰りたい。' }, // 今と同じ（重なりは先のものを使う）
  ], doc)
  assert.deepEqual(got, [
    { key: 'complaint.person', label: '相談内容（本人）', before: '家に帰りたい。', after: '自宅に帰って畑仕事をしたい（本人）。' },
    { key: 'person.lifeHistory', label: 'これまでの生活の経緯（生活歴）', before: null, after: '農業を営んできた。' },
  ])
})

test('入院時情報提供書では、その様式にない欄の案は受け取らない', () => {
  const got = acceptProposals([{ key: 'complaint.person', value: '別の文' }], { kind: 'admission', fields: {} })
  assert.deepEqual(got, [])
})

test('Gemini の答えから、返事と書き換えの案を返す。書類の値は変えない', async () => {
  const before = structuredClone(doc)
  const asked: string[] = []
  const r = await answerChat({
    ask: async (prompt) => {
      asked.push(prompt)
      return { reply: '本人の言葉に近い形にしました。', proposals: [{ key: 'complaint.person', value: '自宅に帰って畑仕事をしたい。' }, { key: 'x', value: 'y' }] }
    },
    document: doc,
    recordings,
    messages: [{ role: 'user', text: '相談内容を直して' }],
  })
  assert.equal(asked.length, 1)
  assert.equal(r.reply, '本人の言葉に近い形にしました。')
  assert.deepEqual(r.proposals.map((x) => x.key), ['complaint.person'])
  assert.deepEqual(doc, before)
})

test('Gemini の答えの形が崩れていても、落ちずに返事だけを返す', async () => {
  const r = await answerChat({ ask: async () => ({ reply: 3, proposals: 'x' }), document: doc, recordings, messages: [{ role: 'user', text: 'a' }] })
  assert.equal(typeof r.reply, 'string')
  assert.ok(r.reply.length > 0)
  assert.deepEqual(r.proposals, [])
})

test('試しの中身（fake）は、「直して」と頼まれたら値のある文章の欄に案を出す', async () => {
  const r = await answerChat({ ask: fakeChat, document: doc, recordings, messages: [{ role: 'user', text: '相談内容を直して' }] })
  assert.equal(r.proposals.length, 1)
  assert.equal(r.proposals[0].key, 'complaint.person')
  const plain = await answerChat({ ask: fakeChat, document: doc, recordings, messages: [{ role: 'user', text: 'こんにちは' }] })
  assert.deepEqual(plain.proposals, [])
})
