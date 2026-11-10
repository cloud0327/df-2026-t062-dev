
test('根拠IDがないAIの値は採用しない', async () => {
  const handler: Handler = (_p, schema, m) => {
    if (m.step === '欄の値') {
      return Object.fromEntries(
        Object.keys(schema.properties).map((key) => [
          key,
          { value: key === text.key ? '根拠のない文章。' : null, from: [] },
        ]),
      )
    }
    if (m.step === '読み直し') {
      return {
        checks: schema.properties.checks.items.properties.id.enum.map(
          (id: string) => ({ id, verdict: 'ok', from: [] }),
        ),
      }
    }
    return {}
  }

  const r = await sheetWriter(fakeLlm(handler)).write({
    visits: [v1],
    newVisitId: 'v1',
    current: {},
    people,
    first: true,
  })

  assert.equal(r.values[text.key], undefined)
})

test('読み直しの検証結果がないAIの値は採用しない', async () => {
  const handler: Handler = (_p, schema, m) => {
    if (m.step === '欄の値') {
      return Object.fromEntries(
        Object.keys(schema.properties).map((key) => [
          key,
          {
            value: key === text.key ? '左半身が動きにくい。' : null,
            from: key === text.key ? ['s1-1'] : [],
          },
        ]),
      )
    }
    if (m.step === '読み直し') {
      return { checks: [] }
    }
    return {}
  }

  const r = await sheetWriter(fakeLlm(handler)).write({
    visits: [v1],
    newVisitId: 'v1',
    current: {},
    people,
    first: true,
  })

  assert.equal(r.values[text.key], undefined)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ZERO_USAGE, type Person, type Visit } from '../worker/types.ts'
import { BUNDLES, SUMMARY, bundleOf, groupByBundle } from '../worker/vertex/bundles.ts'
import { candidateFields, needsDocument } from '../worker/vertex/common.ts'
import { geminiFactory, type AskMeta, type Llm } from '../worker/vertex/gemini.ts'
import { speakerAssigner } from '../worker/vertex/speakers.ts'
import { fieldSchema, mapLimit, sheetWriter, updateSchema } from '../worker/vertex/writer.ts'

const specs = candidateFields()
// 書類がないときに書く欄（会話から書ける欄）を、まとまりごとに
const talkGroups = groupByBundle(specs.filter((s) => !needsDocument(s)))
// 会話から書ける文章の欄（読み直しで 1 文だけ落とす確かめに使う）と、それが入るまとまり
const text = specs.find((s) => s.item23 && s.type === 'longtext' && !needsDocument(s))!
const n = bundleOf(text).id
// 別のまとまり（呼び出しの失敗の確かめに使う）
const other = [...talkGroups.keys()].find((id) => id !== n && id !== SUMMARY.id)!

const people: Person[] = [{ label: '甲斐', role: '本人', relation: '利用者' }]
const v1: Visit = { id: 'v1', date: '2026-11-01', scenes: [{ id: 's1', kind: '会話', entries: [{ id: 's1-1', speaker: '甲斐', text: '左半身が動きにくい。夜はよく眠れる。' }] }] }
const v2: Visit = { id: 'v2', date: '2026-11-08', scenes: [{ id: 's2', kind: '観察', entries: [{ id: 's2-1', speaker: null, text: '玄関に段差がある' }] }] }

type Handler = (prompt: string, schema: any, meta: AskMeta) => unknown
const fakeLlm = (h: Handler, log: AskMeta[] = []) => (): Llm => ({
  ask: async (p, s, m) => { log.push(m); return h(p, s, m) },
  usage: () => ({ ...ZERO_USAGE, calls: log.length }),
})

/** 全部の文字列に共通する先頭の部分 */
const commonPrefix = (xs: string[]) => xs.reduce((a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i) })

/** 欄の値では text の欄だけに値を書き、読み直しでは全部 ok にする偽の Gemini */
const writeText: Handler = (_p, schema, m) => {
  if (m.step === '欄の値') return Object.fromEntries(Object.keys(schema.properties).map((k) => [k, { value: k === text.key ? '左半身が動きにくい。' : null, from: k === text.key ? ['s1-1'] : [] }]))
  if (m.step === '読み直し') return { checks: schema.properties.checks.items.properties.id.enum.map((id: string) => ({ id, verdict: 'ok', from: ['s1-1'] })) }
  return {}
}

/** 答えの形（JSON Schema）の中の項目（properties）の数。入れ子も数える */
const schemaProps = (s: any): number => !s || typeof s !== 'object' ? 0
  : (s.properties ? Object.keys(s.properties).length + Object.values(s.properties).reduce((a: number, v) => a + schemaProps(v), 0) : 0)
    + (s.items ? schemaProps(s.items) : 0) + (s.anyOf ? s.anyOf.reduce((a: number, v: any) => a + schemaProps(v), 0) : 0)

test('23 項目のまとまり: AI が書く欄のある項目は、どれか 1 つのまとまりにだけ入る。まとまりは 7 つまで', () => {
  for (const no of new Set(specs.map((s) => s.item23 || 0))) {
    assert.equal([...BUNDLES, SUMMARY].filter((b) => b.items.includes(no)).length, 1, `23 項目の ${no}`)
  }
  assert.ok(BUNDLES.length <= 7)
  // まとまりに分けても、欄は 1 つも落ちず、増えもしない
  assert.deepEqual([...groupByBundle(specs).values()].flat().map((s) => s.key).sort(), specs.map((s) => s.key).sort())
})

test('23 項目のまとまり: 答えの形の中の項目は、欄の値・2 回目の直しのどちらも 157 以下（Gemini が受け付けた大きさ）', () => {
  // 2026-11-10 に gemini-3.8-flash で確かめた: 157 までは受け付け、161 からは 400（Request contains an invalid argument）で断られる
  for (const [id, ss] of groupByBundle(specs)) {
    assert.ok(schemaProps(fieldSchema(ss)) <= 157, `${id}: 欄の値 ${schemaProps(fieldSchema(ss))}`)
    assert.ok(schemaProps(updateSchema(ss)) <= 157, `${id}: 2 回目の直し ${schemaProps(updateSchema(ss))}`)
  }
})

test('1 回目: 書く → 読み直しで根拠のない文を落とす。1 つのまとまりの呼び出しが失敗しても残りは返す', async () => {
  const handler: Handler = (_p, schema, m) => {
    if (m.step === '欄の値') {
      if (m.group === other) throw new Error('boom')
      return Object.fromEntries(Object.keys(schema.properties).map((k) => [k, { value: k === text.key ? '左半身が動きにくい。夜は歩き回る。' : null, from: k === text.key ? ['s1-1', 'zzz'] : [] }]))
    }
    if (m.step === '読み直し') {
      const ids: string[] = schema.properties.checks.items.properties.id.enum
      return { checks: ids.map((id) => ({ id, verdict: id.endsWith('#1') ? 'no_source' : 'ok', from: ['s1-1'] })) }
    }
    return {}   // 全体のまとめは空
  }
  const r = await sheetWriter(fakeLlm(handler), { concurrency: 2 }).write({ visits: [v1], newVisitId: 'v1', current: {}, people, first: true })
  assert.deepEqual(r.values, { [text.key]: { value: '左半身が動きにくい。', cite: ['s1-1'] } })   // zzz（記録にない id）は根拠から外れる
  assert.deepEqual(r.failed, [other])
  assert.deepEqual(r.incompleteFields.sort(), [...talkGroups.get(other)!.map((s) => s.key), text.key].sort())
})

test('1 回目: まとまりごとに 1 回ずつ書かせ、どの呼び出しも、記録を先頭に置いた同じ前置きで始まる', async () => {
  const calls: { prompt: string, schema: any, meta: AskMeta }[] = []
  const handler: Handler = (p, schema, m) => { calls.push({ prompt: p, schema, meta: m }); return writeText(p, schema, m) }
  await sheetWriter(fakeLlm(handler)).write({ visits: [v1], newVisitId: 'v1', current: {}, people, first: true })

  // 欄の値: 全体のまとめを除くまとまりごとに 1 回。答えの形には、そのまとまりの欄が全部入る
  const writes = calls.filter((c) => c.meta.step === '欄の値')
  const expected = [...talkGroups].filter(([id]) => id !== SUMMARY.id)
  assert.deepEqual(writes.map((c) => c.meta.group).sort(), expected.map(([id]) => id).sort())
  for (const c of writes) assert.deepEqual(Object.keys(c.schema.properties).sort(), talkGroups.get(String(c.meta.group))!.map((s) => s.key).sort())

  // 欄の値・読み直し・全体のまとめは、話した人と記録の全部を含む同じ前置きで始まる（2 つ目の呼び出しからキャッシュに当たる）
  assert.ok(calls.some((c) => c.meta.step === '読み直し') && calls.some((c) => c.meta.step === '全体のまとめ'))
  const prefix = commonPrefix(calls.map((c) => c.prompt))
  assert.ok(prefix.includes('甲斐: 本人（利用者）'))
  assert.ok(prefix.includes('[s1-1] 甲斐: 左半身が動きにくい。夜はよく眠れる。'))
})

test('1 回目: 最初の 1 回を済ませてから、残りを並べて呼ぶ（同じ前置きをキャッシュに載せてから）', async () => {
  const events: string[] = []
  const handler: Handler = async (p, schema, m) => {
    if (m.step === '欄の値') {
      events.push(`start:${m.group}`)
      await new Promise((ok) => setTimeout(ok, 5))
      events.push(`end:${m.group}`)
    }
    return writeText(p, schema, m)
  }
  await sheetWriter(fakeLlm(handler), { concurrency: 4 }).write({ visits: [v1], newVisitId: 'v1', current: {}, people, first: true })
  const first = events[0].slice('start:'.length)
  assert.equal(events[1], `end:${first}`)
  assert.ok(events.length > 2)
})

test('2 回目: 今の値を渡さず新しい記録だけで直し、新しい記録を根拠にした直しだけ入れる', async () => {
  const seen: string[] = []
  const groupsSeen: unknown[] = []
  const handler: Handler = (p, schema, m) => {
    if (m.step === '2回目の直し') {
      seen.push(p)
      groupsSeen.push(m.group)
      if (m.group !== n) return { changed: [] }
      return { changed: [text.key], [text.key]: { value: '左半身が動きにくい。玄関に段差がある。', from: ['s2-1'] } }
    }
    if (m.step === '読み直し') return { checks: schema.properties.checks.items.properties.id.enum.map((id: string) => ({ id, verdict: 'ok', from: ['s2-1'] })) }
    throw new Error(`想定外の呼び出し: ${m.step}`)
  }
  const r = await sheetWriter(fakeLlm(handler)).write({
    visits: [v1, v2], newVisitId: 'v2', current: { [text.key]: '左半身が動きにくい。' }, people, first: false,
  })
  assert.equal(r.values[text.key].value, '左半身が動きにくい。玄関に段差がある。')
  assert.deepEqual(r.values[text.key].cite, ['s2-1'])
  assert.deepEqual(r.failed, [])
  assert.deepEqual(r.incompleteFields, [])
  // 直す係には新しい記録だけを見せる（1 回目の発言は入らない）
  assert.ok(seen.every((p) => p.includes('s2-1') && !p.includes('s1-1')))
  assert.ok(seen.some((p) => p.includes('- 今の値: "左半身が動きにくい。"')))
  // 直す係は、全体のまとめも含めて、まとまりごとに 1 回。どれも新しい記録を先頭に置いた同じ前置きで始まる
  assert.deepEqual(groupsSeen.sort(), [...talkGroups.keys()].sort())
  assert.ok(['[s2-1]', '玄関に段差がある'].every((x) => commonPrefix(seen).includes(x)))
})

test('型に合わず AI の値を落とした欄を未反映欄として返す', async () => {
  const choice = specs.find((s) => s.type === 'enum' && s.choices?.length)
  assert.ok(choice)
  const handler: Handler = (_p, schema, m) => {
    if (m.step === '欄の値') return Object.fromEntries(Object.keys(schema.properties).map((key) => [key, {
      value: key === choice.key ? '存在しない選択肢' : null,
      from: key === choice.key ? ['s1-1'] : [],
    }]))
    if (m.step === '読み直し') return { checks: [] }
    return {}
  }
  const r = await sheetWriter(fakeLlm(handler)).write({ visits: [v1], newVisitId: 'v1', current: {}, people, first: true })
  assert.ok(r.incompleteFields.includes(choice.key))
})

test('mapLimit は同時に動かす数を絞り、順番どおりに返す', async () => {
  let running = 0
  let peak = 0
  const r = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (x) => { running++; peak = Math.max(peak, running); await new Promise((ok) => setTimeout(ok, 5)); running--; return x * 2 })
  assert.deepEqual(r, [2, 4, 6, 8, 10, 12])
  assert.equal(peak, 2)
})

test('Gemini: 失敗したらやり直し、schema を断られたら schema なしで聞き直す。使った量と円を数える（キャッシュに当たった分は安い単価）', async () => {
  const calls: { schema: unknown | null, thinkingLevel?: string }[] = []
  const client = {
    async generate({ schema, thinkingLevel }: { schema: unknown | null, thinkingLevel?: string }) {
      calls.push({ schema, thinkingLevel })
      if (calls.length === 1) throw Object.assign(new Error('400 INVALID_ARGUMENT: bad schema'), { status: 400 })
      if (calls.length === 2) return { text: 'not json', prompt: 10, output: 1, thinking: 0, cached: 0 }
      return { text: '{"ok":true}', prompt: 1_000_000, output: 1_000_000, thinking: 0, cached: 600_000 }
    },
  }
  const llm = geminiFactory({ GEMINI_YEN_IN: '50', GEMINI_YEN_OUT: '400', GEMINI_YEN_CACHED: '5' }, { client, sleep: async () => {} })()
  const out = await llm.ask('p', { type: 'object' }, { step: 't' })
  assert.deepEqual(out, { ok: true })
  assert.deepEqual(calls.map((c) => c.schema), [{ type: 'object' }, null, null])
  // 思考の深さは、指定がなければ LOW
  assert.deepEqual(calls.map((c) => c.thinkingLevel), ['LOW', 'LOW', 'LOW'])
  const u = llm.usage()
  assert.equal(u.calls, 2)
  assert.equal(u.promptTokens, 1_000_010)
  assert.equal(u.cachedTokens, 600_000)
  // キャッシュに当たらなかった入力 400,010 は 50 円、当たった 600,000 は 5 円、出力と思考は 400 円（いずれも 100 万トークンあたり）
  assert.equal(u.yen, (400_010 * 50 + 600_000 * 5 + 1_000_001 * 400) / 1e6)
})

test('Gemini: 400（INVALID_ARGUMENT）は文面に schema がなくても、schema なしで聞き直す', async () => {
  const schemas: (unknown | null)[] = []
  const client = {
    async generate({ schema }: { schema: unknown | null }) {
      schemas.push(schema)
      if (schema) throw Object.assign(new Error('{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}'), { status: 400 })
      return { text: '{"ok":true}', prompt: 1, output: 1, thinking: 0, cached: 0 }
    },
  }
  const out = await geminiFactory({}, { client, sleep: async () => {} })().ask('p', { type: 'object' }, { step: 't' })
  assert.deepEqual(out, { ok: true })
  assert.deepEqual(schemas, [{ type: 'object' }, null])
})

test('Gemini: 思考の深さは GEMINI_THINKING_LEVEL で変えられ、DEFAULT ならモデルの既定に任せる。キャッシュの単価の既定は入力の 1 割', async () => {
  const levels: (string | undefined)[] = []
  const client = {
    async generate({ thinkingLevel }: { thinkingLevel?: string }) {
      levels.push(thinkingLevel)
      return { text: '{}', prompt: 1_000_000, output: 0, thinking: 0, cached: 1_000_000 }
    },
  }
  await geminiFactory({ GEMINI_THINKING_LEVEL: 'medium' }, { client })().ask('p', null, { step: 't' })
  await geminiFactory({ GEMINI_THINKING_LEVEL: 'DEFAULT' }, { client })().ask('p', null, { step: 't' })
  assert.deepEqual(levels, ['MEDIUM', undefined])
  const llm = geminiFactory({ GEMINI_YEN_IN: '100' }, { client })()
  await llm.ask('p', null, { step: 't' })
  assert.equal(llm.usage().yen, 10)
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

test('最初の根拠が空でも読み直しで根拠が見つかれば採用する', async () => {
  const handler: Handler = (_p, schema, m) => {
    if (m.step === '欄の値') {
      return Object.fromEntries(
        Object.keys(schema.properties).map((key) => [
          key,
          {
            value: key === text.key ? '左半身が動きにくい。' : null,
            from: [],
          },
        ]),
      )
    }
    if (m.step === '読み直し') {
      return {
        checks: schema.properties.checks.items.properties.id.enum.map(
          (id: string) => ({ id, verdict: 'ok', from: ['s1-1'] }),
        ),
      }
    }
    return {}
  }

  const r = await sheetWriter(fakeLlm(handler)).write({
    visits: [v1],
    newVisitId: 'v1',
    current: {},
    people,
    first: true,
  })

  assert.deepEqual(r.values[text.key], {
    value: '左半身が動きにくい。',
    cite: ['s1-1'],
  })
})
