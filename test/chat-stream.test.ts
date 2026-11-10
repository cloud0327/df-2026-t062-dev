// 書き方の相談の答え（NDJSON）を読む（src/lib/chatStream.ts）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readChatStream } from '../src/lib/chatStream.ts'

const body = (chunks: string[]) => new ReadableStream<Uint8Array>({
  start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close() },
})

test('step を届いた順に知らせ、done で答えを返す。行や文字が途中で切れて届いても読める', async () => {
  const done = JSON.stringify({ type: 'done', reply: 'できました', steps: ['用紙を読みました', '録音を探しました「畑」（1 件）'], proposals: [] })
  const all = `${JSON.stringify({ type: 'step', text: '用紙を読みました' })}\n${JSON.stringify({ type: 'step', text: '録音を探しました「畑」（1 件）' })}\n${done}\n`
  const bytes = new TextEncoder().encode(all)
  // 3 バイトずつ（日本語の 1 文字の途中でも切れる）
  const chunks: Uint8Array[] = []
  for (let i = 0; i < bytes.length; i += 3) chunks.push(bytes.slice(i, i + 3))
  const stream = new ReadableStream<Uint8Array>({ start(c) { for (const x of chunks) c.enqueue(x); c.close() } })
  const live: string[] = []
  const r = await readChatStream(stream, (s) => live.push(s))
  assert.deepEqual(live, ['用紙を読みました', '録音を探しました「畑」（1 件）'])
  assert.deepEqual(r, { reply: 'できました', steps: live, proposals: [] })
})

test('error が来たら、done が来ないまま終わったら、失敗にする', async () => {
  await assert.rejects(readChatStream(body([`${JSON.stringify({ type: 'step', text: 'a' })}\n{"type":"error"}\n`]), () => {}))
  await assert.rejects(readChatStream(body([`${JSON.stringify({ type: 'step', text: 'a' })}\n`]), () => {}))
})
