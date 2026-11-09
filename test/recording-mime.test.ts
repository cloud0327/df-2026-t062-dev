// 録音の形式: Speech-to-Text（Chirp 3）が受け付ける形式で録る。mp4 は AAC だけ、Opus は webm か ogg の入れ物だけ。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickRecordingMime, transcribable } from '../core/audio.ts'

const supports = (list: string[]) => (m: string) => list.includes(m)

test('Chrome（mp4 も webm も録れる）は webm の Opus で録る。mp4 にすると Opus になり、文字起こしできない', () => {
  assert.equal(pickRecordingMime(supports(['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'])), 'audio/webm;codecs=opus')
})

test('Safari（mp4 だけ）は mp4 の AAC で録る', () => {
  assert.equal(pickRecordingMime(supports(['audio/mp4', 'audio/mp4;codecs=mp4a.40.2'])), 'audio/mp4;codecs=mp4a.40.2')
  assert.equal(pickRecordingMime(supports(['audio/mp4'])), 'audio/mp4')
})

test('録れる形式がなければ空（ブラウザに任せる）', () => {
  assert.equal(pickRecordingMime(supports([])), '')
})

test('文字起こしできる形式: mp4 は AAC だけ、Opus は webm・ogg だけ', () => {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/x-m4a', 'audio/wav', 'audio/mpeg', 'audio/flac']) {
    assert.equal(transcribable(m), true, m)
  }
  for (const m of ['audio/mp4;codecs=opus', 'audio/mp4; codecs="opus"', 'audio/webm;codecs=vorbis', 'audio/ogg;codecs=vorbis', 'audio/webm;codecs=pcm']) {
    assert.equal(transcribable(m), false, m)
  }
})
