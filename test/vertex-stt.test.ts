import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toUtterances, vertexStt, type SpeechApi } from '../worker/vertex/stt.ts'

const w = (word: string, speaker: string, s: number, e: number) => ({ word, speakerLabel: speaker, startOffset: { seconds: s }, endOffset: { seconds: e, nanos: 500_000_000 } })

test('単語を、話者が続くかたまりごとの発言にする（結果をまたいでも同じ話者なら 1 つ）', () => {
  const u = toUtterances([
    { alternatives: [{ words: [w('こんにちは', '1', 0, 1), w('。', '1', 1, 1)] }] },
    { alternatives: [{ words: [w('はい', '2', 2, 3)] }] },
    { alternatives: [{ words: [w('お願いします', '2', 3, 4), w('OK', '2', 4, 5), w('go', '2', 5, 6)] }] },
  ], 3)
  assert.deepEqual(u, [
    { id: 'r3-0001', startMs: 0, endMs: 1500, speaker: 'speaker_1', text: 'こんにちは。' },
    { id: 'r3-0002', startMs: 2000, endMs: 6500, speaker: 'speaker_2', text: 'はいお願いしますOK go' },
  ])
})

test('単語がない結果（話者分離なし）は、結果ごとの発言にする', () => {
  const u = toUtterances([{ alternatives: [{ transcript: '一言目' }], resultEndOffset: { seconds: 4 } }], 1)
  assert.deepEqual(u, [{ id: 'r1-0001', startMs: 0, endMs: 4000, speaker: 'speaker_1', text: '一言目' }])
})

test('BatchRecognize: operation の名前をすぐ残し、待って結果を発言にする。resume は新しく始めない', async () => {
  let started = 0
  const done = { done: true, result: { results: { 'gs://b/a.m4a': { transcript: { results: [{ alternatives: [{ words: [w('はい', '1', 0, 1)] }] }] }, metadata: { totalBilledDuration: { seconds: 61 } } } } } }
  let polls = 0
  const client: SpeechApi = {
    async batchRecognize(req) {
      started++
      assert.equal((req.config as { model: string }).model, 'chirp_3')
      assert.deepEqual(req.files, [{ uri: 'gs://b/a.m4a' }])
      return [{ name: 'op/1' }]
    },
    async checkBatchRecognizeProgress(name) { assert.equal(name, 'op/1'); return polls++ ? done : { done: false } },
  }
  const stt = vertexStt({ GOOGLE_CLOUD_PROJECT: 'p' }, { client, pollMs: 1 })
  const names: string[] = []
  const r = await stt.transcribe({ uri: 'gs://b/a.m4a', mime: 'audio/mp4', recordingId: 'x', sequence: 2, onOperation: async (n) => { names.push(n) } })
  assert.deepEqual(names, ['op/1'])
  assert.equal(r.model, 'chirp_3')
  assert.equal(r.audioSeconds, 61)
  assert.equal(r.utterances[0].id, 'r2-0001')

  const again = await stt.transcribe({ uri: 'gs://b/a.m4a', mime: 'audio/mp4', recordingId: 'x', sequence: 2, resumeOperation: 'op/1' })
  assert.equal(again.utterances.length, 1)
  assert.equal(started, 1)
})
