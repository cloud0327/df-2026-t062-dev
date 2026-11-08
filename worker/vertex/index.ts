// 本物の中身（Speech-to-Text Chirp 3 と Gemini）。まだ作っていない。
import type { Providers } from '../types.ts'

export function vertexProviders(_env: NodeJS.ProcessEnv): Providers {
  throw new Error('AI_PROVIDER=vertex はまだ使えません')
}
