// Gemini（Vertex AI）を呼ぶ。design/runner/llm.py の写し: JSON で答えさせ、失敗したらやり直し、
// schema が通らないと言われたら schema なし（JSON だけ）で聞き直す。
// ログには中身（指示文・答え・エラーの文面）を出さない。出すのは段・回数・時間・トークン数・エラーの種類だけ。
import { GoogleGenAI, type ThinkingLevel } from '@google/genai'
import type { Usage } from '../types.ts'

export interface AskMeta {
  /** 段の名前（欄の値・読み直し・2回目の直し・話した人 など） */
  step: string
  group?: string | number
}

/** JSON で答えを返す 1 回の呼び出し（テストでは差し替える） */
export type Ask = (prompt: string, schema: unknown, meta: AskMeta) => Promise<unknown>

/** 1 回の処理（ジョブ）で使った量を数えながら呼ぶ入れ物 */
export interface Llm {
  ask: Ask
  usage(): Usage
}

// 単価（円／100万トークン、1 ドル 158 円）。Gemini 3.8 Flash の global の特別価格（$0.75・$3.75、2026-12-31 まで）。
// 2027-01-01 からは $1.5・$7.5（237 円・1,185 円）になるので、GEMINI_YEN_IN／GEMINI_YEN_OUT で変える。
// キャッシュに当たった入力は、入力の単価の 1 割（GEMINI_YEN_CACHED で変える。既定は GEMINI_YEN_IN の 1 割）。
// 思考のトークンは出力の単価。
const YEN_IN = 119
const YEN_OUT = 593
const CACHED_RATE = 0.1

// 思考の深さ（GEMINI_THINKING_LEVEL）。既定は LOW（モデルの既定は MEDIUM。3.8 Flash は MINIMAL を受け付けない）。
// DEFAULT にすると指定しない（モデルの既定に任せる）
const THINKING_LEVEL = 'LOW'

const log = (rec: Record<string, unknown>) => console.log(JSON.stringify({ severity: 'INFO', ...rec }))

interface Client {
  generate(args: { model: string, prompt: string, schema: unknown | null, thinkingLevel?: string }): Promise<{ text: string | undefined, prompt: number, output: number, thinking: number, cached: number }>
}

function realClient(env: NodeJS.ProcessEnv): Client {
  let ai: GoogleGenAI | undefined
  return {
    async generate({ model, prompt, schema, thinkingLevel }) {
      // 3.6〜3.8 Flash は東京にない（global・us・eu だけ。2026-11-09 に確かめた）ので、既定は global
      ai ??= new GoogleGenAI({ vertexai: true, project: env.GOOGLE_CLOUD_PROJECT, location: env.GEMINI_LOCATION ?? 'global' })
      const r = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          maxOutputTokens: 65536,
          ...(schema ? { responseJsonSchema: schema } : {}),
          ...(thinkingLevel ? { thinkingConfig: { thinkingLevel: thinkingLevel as ThinkingLevel } } : {}),
        },
      })
      const u = r.usageMetadata
      // promptTokenCount はキャッシュに当たった分（cachedContentTokenCount）も含む
      return { text: r.text, prompt: u?.promptTokenCount ?? 0, output: u?.candidatesTokenCount ?? 0, thinking: u?.thoughtsTokenCount ?? 0, cached: u?.cachedContentTokenCount ?? 0 }
    },
  }
}

/** GEMINI_THINKING_LEVEL → API に渡す値（DEFAULT・空なら渡さない） */
function thinkingLevelOf(env: NodeJS.ProcessEnv): string | undefined {
  const v = (env.GEMINI_THINKING_LEVEL ?? THINKING_LEVEL).trim().toUpperCase()
  return v && v !== 'DEFAULT' ? v : undefined
}

export interface GeminiOptions {
  retries?: number
  /** やり直しの待ち（テストで差し替える） */
  sleep?: (ms: number) => Promise<void>
  client?: Client
}

/** ジョブごとに `newLlm()` で数え直す（クライアントは使い回す） */
export function geminiFactory(env: NodeJS.ProcessEnv, opts: GeminiOptions = {}): () => Llm {
  const model = env.GEMINI_MODEL ?? 'gemini-3.8-flash'
  const yenIn = Number(env.GEMINI_YEN_IN ?? YEN_IN)
  const yenOut = Number(env.GEMINI_YEN_OUT ?? YEN_OUT)
  const yenCached = Number(env.GEMINI_YEN_CACHED ?? yenIn * CACHED_RATE)
  const thinkingLevel = thinkingLevelOf(env)
  const retries = opts.retries ?? 4
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
  const client = opts.client ?? realClient(env)
  return () => {
    const u = { calls: 0, promptTokens: 0, cachedTokens: 0, outputTokens: 0, thinkingTokens: 0 }
    const ask: Ask = async (prompt, schema, meta) => {
      let useSchema = true
      for (let attempt = 0; attempt <= retries; attempt++) {
        const t0 = Date.now()
        try {
          const r = await client.generate({ model, prompt, schema: useSchema ? schema : null, thinkingLevel })
          u.calls++
          u.promptTokens += r.prompt
          u.cachedTokens += r.cached
          u.outputTokens += r.output
          u.thinkingTokens += r.thinking
          const data = JSON.parse(r.text ?? '')
          log({ msg: 'gemini', step: meta.step, group: meta.group ?? null, ok: true, attempt, schema: useSchema, thinkingLevel: thinkingLevel ?? null, seconds: (Date.now() - t0) / 1000, promptTokens: r.prompt, cachedTokens: r.cached, outputTokens: r.output, thinkingTokens: r.thinking })
          return data
        } catch (e) {
          // JSON の崩れも API の失敗も、やり直す。文面は中身が入りうるのでログに出さない
          const msg = String((e as Error)?.message ?? '').replace(/\n/g, ' ')
          log({ msg: 'gemini', step: meta.step, group: meta.group ?? null, ok: false, attempt, schema: useSchema, seconds: (Date.now() - t0) / 1000, error: (e as Error)?.name ?? 'Error', status: (e as { status?: number })?.status ?? null })
          if (msg.includes('INVALID_ARGUMENT') && msg.toLowerCase().includes('schema')) useSchema = false
          if (attempt === retries) throw e
          await sleep(Math.min(60, 4 * 2 ** attempt) * 1000)
        }
      }
      throw new Error('unreachable')
    }
    return {
      ask,
      usage: () => ({
        ...u,
        yen: ((u.promptTokens - u.cachedTokens) * yenIn + u.cachedTokens * yenCached + (u.outputTokens + u.thinkingTokens) * yenOut) / 1e6,
      }),
    }
  }
}
