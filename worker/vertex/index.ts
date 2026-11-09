// 本物の中身（Speech-to-Text Chirp 3 と Gemini）。AI_PROVIDER=vertex のときだけ読み込まれる。
// 環境変数: GOOGLE_CLOUD_PROJECT、GEMINI_LOCATION（既定 global）、GEMINI_MODEL（既定 gemini-3.8-flash）、
// GEMINI_CONCURRENCY（既定 4）、GEMINI_YEN_IN／GEMINI_YEN_OUT、STT_LOCATION（既定 us）
import type { Providers } from '../types.ts'
import { geminiFactory } from './gemini.ts'
import { speakerAssigner } from './speakers.ts'
import { vertexStt } from './stt.ts'
import { sheetWriter } from './writer.ts'

export function vertexProviders(env: NodeJS.ProcessEnv): Providers {
  if (!env.GOOGLE_CLOUD_PROJECT) throw new Error('GOOGLE_CLOUD_PROJECT が未設定です')
  const newLlm = geminiFactory(env)
  return {
    stt: vertexStt(env),
    speakers: speakerAssigner(newLlm),
    writer: sheetWriter(newLlm, { concurrency: Number(env.GEMINI_CONCURRENCY) || 4 }),
  }
}
