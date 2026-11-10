// 「書き方を相談する」のエージェント（api/chat.ts）。Gemini は台本どおりに道具を呼ぶ偽物に差し替える。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkProposal, fakeModel, MAX_CALLS, runChat, type ChatDocument, type ChatModel, type ChatRecording, type Content, type Part, chatSystem } from '../api/chat.ts'

const doc: ChatDocument = {
  kind: 'assessment',
  fields: {
    'complaint.person': { value: '家に帰りたい。', by: 'ai' },
    'intake.method': { value: '訪問', by: 'cm' },
    'person.lifeHistory': { value: null, by: 'ai' },
    consulter: { value: { sex: '女', name: '春子', relationship: '子の配偶者' }, by: 'ai' },
    'family.members': { value: [{ name: '雅史', relationship: '子', isMainCaregiver: false }, { name: '春子', relationship: '子の配偶者', isMainCaregiver: true }], by: 'ai' },
  },
}

const recordings: ChatRecording[] = [
  { recordedAt: '2026-01-21T01:00:00.000Z', utterances: [{ id: 'r1-0001', speaker: 'A', person: '本人', text: '早く家に帰って畑をしたい' }] },
  { recordedAt: '2026-01-25T01:00:00.000Z', utterances: [{ id: 'r2-0001', speaker: 'B', person: null, text: '浴室は狭いです' }] },
]

const call = (name: string, args: Record<string, unknown> = {}): Part => ({ functionCall: { name, args }, thoughtSignature: `sig-${name}` })

/** 台本どおりに答える偽の Gemini。受け取った会話を覚える */
function scripted(turns: Part[][]) {
  const seen: { system: string, contents: Content[] }[] = []
  const model: ChatModel = async ({ system, contents }) => {
    seen.push({ system, contents: structuredClone(contents) })
    return turns[seen.length - 1] ?? [{ text: '（台本の終わり）' }]
  }
  return { model, seen }
}

/** n 回目の呼び出しで、道具 name に返した答え */
const responseOf = (seen: { contents: Content[] }[], n: number, name: string) =>
  seen[n].contents.at(-1)!.parts.find((p) => p.functionResponse?.name === name)!.functionResponse!.response as Record<string, any>

test('道具を呼ばずに答えたら、その文を返事にする。やり取りは会話として渡す', async () => {
  const { model, seen } = scripted([[{ text: '本人の言葉で書きます。', thought: false }]])
  const r = await runChat({ model, document: doc, recordings, messages: [{ role: 'user', text: 'こんにちは' }, { role: 'pet', text: 'はい' }, { role: 'user', text: '相談内容の書き方は？' }] })
  assert.deepEqual(r, { reply: '本人の言葉で書きます。', steps: [], proposals: [] })
  assert.deepEqual(seen[0].contents.map((c) => [c.role, c.parts[0].text]), [['user', 'こんにちは'], ['model', 'はい'], ['user', '相談内容の書き方は？']])
  assert.match(seen[0].system, /propose_edit/)
})

test('read_form: 値のある欄と、空の文章の欄を返す。語で絞れる', async () => {
  const { model, seen } = scripted([[call('read_form')], [call('read_form', { query: '相談' })], [{ text: '読みました' }]])
  const r = await runChat({ model, document: doc, recordings, messages: [{ role: 'user', text: '用紙を見て' }] })
  const all = responseOf(seen, 1, 'read_form')
  assert.deepEqual(all.filled.find((f: any) => f.key === 'complaint.person'), { key: 'complaint.person', label: '相談内容（本人）', type: 'longtext', value: '家に帰りたい。' })
  assert.ok(all.emptyText.some((f: any) => f.key === 'person.lifeHistory'))
  const some = responseOf(seen, 2, 'read_form')
  assert.ok(some.filled.every((f: any) => /相談/.test(f.label)))
  assert.ok(some.filled.length >= 2)
  assert.deepEqual(r.steps, ['用紙を読みました', '用紙を読みました（「相談」）'])
  // 全部読むときは値だけ。語で絞ったときは、まとまりの欄の形（中の項目と選択肢）も返す
  assert.equal(all.filled.find((f: any) => f.key === 'consulter').shape, undefined)
  const consulter = some.filled.find((f: any) => f.key === 'consulter')
  assert.ok(consulter.shape.fields.some((x: any) => x.key === 'relationship' && x.choices.includes('子の配偶者')))
  // 道具を呼んだモデルの部品（thoughtSignature つき）は、そのまま次の呼び出しに返す
  assert.deepEqual(seen[1].contents.at(-2), { role: 'model', parts: [call('read_form')] })
})

test('search_records: 発言を語で探し、日付と話した人つきで返す', async () => {
  const { model, seen } = scripted([[call('search_records', { query: '畑 浴室' })], [{ text: 'ありました' }]])
  const r = await runChat({ model, document: doc, recordings, messages: [{ role: 'user', text: '畑の話はあった？' }] })
  assert.deepEqual(responseOf(seen, 1, 'search_records').hits, [
    { id: 'r1-0001', date: '2026-01-21', speaker: '本人', text: '早く家に帰って畑をしたい' },
    { id: 'r2-0001', date: '2026-01-25', speaker: 'B', text: '浴室は狭いです' },
  ])
  assert.deepEqual(r.steps, ['録音を探しました「畑 浴室」（2 件）'])
})

test('search_records: 録音がなければ、ないと返す', async () => {
  const { model, seen } = scripted([[call('search_records', { query: '畑' })], [{ text: 'ありません' }]])
  await runChat({ model, document: doc, recordings: [], messages: [{ role: 'user', text: '畑の話は？' }] })
  assert.deepEqual(responseOf(seen, 1, 'search_records'), { recordings: 0, hits: [] })
})

test('missing_fields: この書類の必須の空欄を、どう埋めるかつきで返す', async () => {
  const { model, seen } = scripted([[call('missing_fields')], [{ text: '足りません' }]])
  const r = await runChat({ model, document: doc, recordings, messages: [{ role: 'user', text: '足りないところは？' }] })
  const missing = responseOf(seen, 1, 'missing_fields').missing as { key: string, label: string, how: string }[]
  assert.ok(missing.length > 10)
  assert.ok(!missing.some((m) => m.key === 'complaint.person'), '値のある欄は出さない')
  assert.ok(missing.every((m) => m.how === '面談で聞く' || m.how === '書類から'))
  assert.equal(r.steps[0], `足りない欄を調べました（${missing.length} 欄）`)
})

test('propose_edit: 通る案だけを集め、通らない案は理由を AI に返す。用紙は変えない', async () => {
  const before = structuredClone(doc)
  const { model, seen } = scripted([
    [call('propose_edit', { key: 'intake.method', value: 'メール' }), call('propose_edit', { key: 'complaint.person', value: '自宅で畑をしたい（本人）。' })],
    [call('propose_edit', { key: 'complaint.person', value: '自宅に帰って畑仕事をしたい（本人）。' })],
    [{ text: '本人の言葉に近づけました。' }],
  ])
  const r = await runChat({ model, document: doc, recordings, messages: [{ role: 'user', text: '相談内容を直して' }] })
  const responses = seen[1].contents.at(-1)!.parts.map((p) => p.functionResponse!.response)
  assert.equal(responses[0].ok, false)
  assert.match(String(responses[0].reason), /入れられない値/)
  assert.deepEqual(responses[0].shape, { type: 'enum', choices: ['訪問', '電話', '来所', 'その他'] }, '通らなければ、欄の形を返して直させる')
  assert.equal(responses[1].ok, true)
  // 同じ欄の案は、あとのものにする
  assert.deepEqual(r.proposals, [{ key: 'complaint.person', label: '相談内容（本人）', before: '家に帰りたい。', after: '自宅に帰って畑仕事をしたい（本人）。' }])
  assert.deepEqual(r.steps, ['案を作れませんでした：相談受付の方法（入れられない値です）', '書き換えの案を作りました：相談内容（本人）', '書き換えの案を作りました：相談内容（本人）'])
  assert.equal(r.reply, '本人の言葉に近づけました。')
  assert.deepEqual(doc, before)
})

test(`道具を呼び続けたら ${MAX_CALLS} 回で止め、そこまでの案は返す`, async () => {
  let n = 0
  const model: ChatModel = async () => (++n === 1 ? [call('propose_edit', { key: 'person.lifeHistory', value: '農業を営んできた。' })] : [call('read_form')])
  const r = await runChat({ model, document: doc, recordings, messages: [{ role: 'user', text: '生活歴を書いて' }] })
  assert.equal(n, MAX_CALLS)
  assert.match(r.reply, /途中/)
  assert.equal(r.proposals.length, 1)
})

test('read_form: 用紙に印字するときだけ付く印（家族の主たる介護者の「※」）を知らせる', async () => {
  const { model, seen } = scripted([[call('read_form', { query: '家族' })], [{ text: '読みました' }]])
  await runChat({ model, document: doc, recordings, messages: [{ role: 'user', text: '余計な※を消して' }] })
  const family = responseOf(seen, 1, 'read_form').filled.find((f: any) => f.key === 'family.members')
  assert.match(family.printed, /isMainCaregiver/)
  assert.match(family.printed, /※/)
  assert.match(chatSystem('assessment'), /printed/)
})

test('書き換えの案の確かめ: 文章の欄は文、選択肢の欄は選択肢の文字、まとまりの欄は今の値と同じ形の JSON', () => {
  assert.deepEqual(checkProposal(doc, 'intake.method', '電話'), { key: 'intake.method', label: '相談受付の方法', before: '訪問', after: '電話' })
  // 相談者（object）: 空の項目は落とす
  assert.deepEqual(checkProposal(doc, 'consulter', '{"name":"甲斐 春子","sex":"女","relationship":"子の配偶者","age":null}'), {
    key: 'consulter', label: '相談者', before: { sex: '女', name: '春子', relationship: '子の配偶者' }, after: { name: '甲斐 春子', sex: '女', relationship: '子の配偶者' },
  })
  // 家族（list）
  const family = checkProposal(doc, 'family.members', JSON.stringify([{ name: '甲斐 雅史', relationship: '子', isMainCaregiver: false }, { name: '甲斐 春子', relationship: '子の配偶者', isMainCaregiver: true }]))
  assert.equal(typeof family, 'object')
  assert.equal((family as any).after[1].name, '甲斐 春子')
  // 項目の並びが違うだけなら、今と同じ
  assert.equal(checkProposal(doc, 'consulter', '{"relationship":"子の配偶者","name":"春子","sex":"女"}'), '相談者（今の値と同じです）')
  assert.equal(checkProposal(doc, 'consulter', '{name: 春子'), '相談者（JSON として読めません）')
  assert.equal(checkProposal(doc, 'consulter', '{"name":"春子","nickname":"はる"}'), '相談者（入れられない値です）')
  assert.equal(checkProposal(doc, 'family.genogram', '{}'), '家族構成図（図の欄は案を出せません）')
  assert.equal(checkProposal(doc, 'no.such.key', 'x'), 'no.such.key（その欄はありません）')
  assert.equal(checkProposal(doc, 'complaint.family', ''), '相談内容（介護者・家族）（文が空です）')
  assert.equal(checkProposal({ kind: 'admission', fields: {} }, 'complaint.person', '別の文'), '相談内容（本人）（この書類にない欄です）')
})

test('試しの中身（fake）: 「直して」なら用紙を読んで案を出し、それ以外は道具を使わずに答える', async () => {
  const r = await runChat({ model: fakeModel, document: doc, recordings, messages: [{ role: 'user', text: '相談内容を直して' }] })
  assert.deepEqual(r.steps, ['用紙を読みました', '書き換えの案を作りました：相談内容（本人）'])
  assert.equal(r.proposals[0].key, 'complaint.person')
  const plain = await runChat({ model: fakeModel, document: doc, recordings, messages: [{ role: 'user', text: 'こんにちは' }] })
  assert.deepEqual([plain.steps, plain.proposals], [[], []])
  const missing = await runChat({ model: fakeModel, document: doc, recordings, messages: [{ role: 'user', text: '足りないところは？' }] })
  assert.match(missing.steps[0], /足りない欄を調べました/)
})
