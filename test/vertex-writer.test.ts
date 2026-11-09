import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ZERO_USAGE, type Person, type Visit } from '../worker/types.ts'
import { candidateFields, groupByItem23, needsDocument } from '../worker/vertex/common.ts'
import { geminiFactory, type AskMeta, type Llm } from '../worker/vertex/gemini.ts'
import { speakerAssigner } from '../worker/vertex/speakers.ts'
import { mapLimit, sheetWriter } from '../worker/vertex/writer.ts'

const specs = candidateFields()
const groups = groupByItem23(specs)
// 会話から書ける文章の欄が 2 つ以上ある項目（読み直しで 1 文だけ落とす確かめに使う）
const [n, text] = [...groups].map(([k, ss]) => [k, ss.find((s) => s.type === 'longtext' && !needsDocument(s))] as const).find(([k, s]) => k && s)!
const other = [...groups].map(([k, ss]) => [k, ss.find((s) => s.type === 'longtext' && !needsDocument(s))] as const).filter(([k, s]) => k && s && k !== n)[0]

const people: Person[] = [{ label: '甲斐', role: '本人', relation: '利用者' }]
const v1: Visit = { id: 'v1', date: '2026-11-01', scenes: [{ id: 's1', kind: '会話', entries: [{ id: 's1-1', speaker: '甲斐', text: '左半身が動きにくい。夜はよく眠れる。' }] }] }
const v2: Visit = { id: 'v2', date: '2026-11-08', scenes: [{ id: 's2', kind: '観察', entries: [{ id: 's2-1', speaker: null, text: '玄関に段差がある' }] }] }

type Handler = (prompt: string, schema: any, meta: AskMeta) => unknown
const fakeLlm = (h: Handler, log: AskMeta[] = []) => (): Llm => ({
  ask: async (p, s, m) => { log.push(m); return h(p, s, m) },
  usage: () => ({ ...ZERO_USAGE, calls: log.length }),
})

test('1 回目: 書く → 読み直しで根拠のない文を落とす。1 つの項目の呼び出しが失敗しても残りは返す', async () => {
  const handler: Handler = (_p, schema, m) => {
    if (m.step === '欄の値') {
      if (m.group === other![0]) throw new Error('boom')
      return Object.fromEntries(Object.keys(schema.properties).map((k) => [k, { value: k === text!.key ? '左半身が動きにくい。夜は歩き回る。' : null, from: k === text!.key ? ['s1-1', 'zzz'] : [] }]))
    }
    if (m.step === '読み直し') {
      const ids: string[] = schema.properties.checks.items.properties.id.enum
      return { checks: ids.map((id) => ({ id, verdict: id.endsWith('#1') ? 'no_source' : 'ok', from: ['s1-1'] })) }
    }
    return {}   // 全体のまとめは空
  }
  const r = await sheetWriter(fakeLlm(handler), { concurrency: 2 }).write({ visits: [v1], newVisitId: 'v1', current: {}, people, first: true })
  assert.deepEqual(r.values, { [text!.key]: { value: '左半身が動きにくい。', cite: ['s1-1'] } })   // zzz（記録にない id）は根拠から外れる
  assert.deepEqual(r.failed, [String(other![0])])
})

test('2 回目: 今の値を渡さず新しい記録だけで直し、新しい記録を根拠にした直しだけ入れる', async () => {
  const seen: string[] = []
  const handler: Handler = (p, schema, m) => {
    if (m.step === '2回目の直し') {
      seen.push(p)
      if (m.group !== n) return { changed: [] }
      return { changed: [text!.key], [text!.key]: { value: '左半身が動きにくい。玄関に段差がある。', from: ['s2-1'] } }
    }
    if (m.step === '読み直し') return { checks: schema.properties.checks.items.properties.id.enum.map((id: string) => ({ id, verdict: 'ok', from: ['s2-1'] })) }
    throw new Error(`想定外の呼び出し: ${m.step}`)
  }
  const r = await sheetWriter(fakeLlm(handler)).write({
    visits: [v1, v2], newVisitId: 'v2', current: { [text!.key]: '左半身が動きにくい。' }, people, first: false,
  })
  assert.equal(r.values[text!.key].value, '左半身が動きにくい。玄関に段差がある。')
  assert.deepEqual(r.values[text!.key].cite, ['s2-1'])
  assert.deepEqual(r.failed, [])
  // 直す係には新しい記録だけを見せる（1 回目の発言は入らない）
  assert.ok(seen.every((p) => p.includes('s2-1') && !p.includes('s1-1')))
  assert.ok(seen.some((p) => p.includes('- 今の値: "左半身が動きにくい。"')))
})

test('mapLimit は同時に動かす数を絞り、順番どおりに返す', async () => {
  let running = 0
  let peak = 0
  const r = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (x) => { running++; peak = Math.max(peak, running); await new Promise((ok) => setTimeout(ok, 5)); running--; return x * 2 })
  assert.deepEqual(r, [2, 4, 6, 8, 10, 12])
  assert.equal(peak, 2)
})

test('Gemini: 失敗したらやり直し、schema を断られたら schema なしで聞き直す。使った量と円を数える', async () => {
  const calls: (unknown | null)[] = []
  const client = {
    async generate({ schema }: { schema: unknown | null }) {
      calls.push(schema)
      if (calls.length === 1) throw Object.assign(new Error('400 INVALID_ARGUMENT: bad schema'), { status: 400 })
      if (calls.length === 2) return { text: 'not json', prompt: 10, output: 1, thinking: 0 }
      return { text: '{"ok":true}', prompt: 1_000_000, output: 1_000_000, thinking: 0 }
    },
  }
  const llm = geminiFactory({ GEMINI_YEN_IN: '50', GEMINI_YEN_OUT: '400' }, { client, sleep: async () => {} })()
  const out = await llm.ask('p', { type: 'object' }, { step: 't' })
  assert.deepEqual(out, { ok: true })
  assert.deepEqual(calls, [{ type: 'object' }, null, null])
  const u = llm.usage()
  assert.equal(u.calls, 2)
  assert.equal(u.yen, (1_000_010 * 50 + 1_000_001 * 400) / 1e6)
})

test('話した人: 知っている人はそのまま、新しい人は役割つきで返し、決められない記号は null', async () => {
  const handler: Handler = () => ({
    speakers: [
      { speaker: 'speaker_1', person: '甲斐', role: null, relation: null },
      { speaker: 'speaker_2', person: '長男の妻', role: '家族', relation: '長男の妻' },
      { speaker: 'speaker_3', person: null, role: null, relation: null },
      { speaker: 'speaker_9', person: '誰か', role: '家族', relation: null },   // 発言にない記号は無視
    ],
  })
  const u = (speaker: string) => ({ id: speaker, startMs: 0, endMs: 1, speaker, text: 'はい' })
  const r = await speakerAssigner(fakeLlm(handler)).assign({ utterances: [u('speaker_1'), u('speaker_2'), u('speaker_3')], people })
  assert.deepEqual(r.map, { speaker_1: '甲斐', speaker_2: '長男の妻', speaker_3: null })
  assert.deepEqual(r.newPeople, [{ label: '長男の妻', role: '家族', relation: '長男の妻' }])
})
