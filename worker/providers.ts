// AI の中身を選ぶ。AI_PROVIDER=vertex で本物（Speech-to-Text Chirp 3 と Gemini）、既定は fake（費用なし）。
import type { Providers } from './types.ts'

let cached: Promise<Providers> | undefined

export function defaultProviders(env: NodeJS.ProcessEnv = process.env): Promise<Providers> {
  cached ??= (async () => {
    if (env.AI_PROVIDER === 'vertex') {
      const m = await import('./vertex/index.ts')
      return m.vertexProviders(env)
    }
    const f = await import('./fake.ts')
    return { stt: new f.FakeStt(), speakers: new f.FakeSpeakers(), writer: new f.FakeWriter() }
  })()
  return cached
}
