import { createAdaptorServer } from '@hono/node-server'
import { createApp, type ApiDeps } from './app.ts'
import { defaultVerifier, type Verifier } from './auth.ts'
import type { ChatAsk } from './chat.ts'
import { CloudTasksQueue, LocalQueue, type Queue } from './queue.ts'
import { defaultStorage, type Storage } from './storage.ts'

/** 依存は使うときに作る（health では DB にも Firebase にもつながない） */
export function defaultApiDeps(env: NodeJS.ProcessEnv = process.env): ApiDeps {
  let verifier: Verifier | undefined
  let storage: Storage | undefined
  let queue: Queue | undefined
  let chat: Promise<ChatAsk> | undefined
  const getStorage = () => (storage ??= defaultStorage(env))
  return {
    db: async () => (await import('../db/pool.ts')).getDb(),
    verifier: () => (verifier ??= defaultVerifier(env)),
    storage: getStorage,
    queue: () => {
      if (queue) return queue
      if (env.QUEUE_MODE === 'tasks') return (queue = new CloudTasksQueue(env))
      // ローカル: 同じプロセスで worker の処理を呼ぶ
      return (queue = new LocalQueue(async (jobId) => {
        const [{ runJob }, { defaultProviders }, { getDb }] = await Promise.all([
          import('../worker/jobs.ts'), import('../worker/providers.ts'), import('../db/pool.ts'),
        ])
        await runJob({ db: getDb, storage: getStorage, providers: () => defaultProviders(env) }, jobId)
      }))
    },
    chat: () => (chat ??= defaultChat(env)),
    devAuth: env.AUTH_MODE === 'dev',
  }
}

/** AI_PROVIDER=vertex なら Gemini に聞く。既定は試しの答え（費用なし） */
async function defaultChat(env: NodeJS.ProcessEnv): Promise<ChatAsk> {
  if (env.AI_PROVIDER !== 'vertex') return (await import('./chat.ts')).fakeChat
  const { geminiFactory } = await import('../worker/vertex/gemini.ts')
  // 画面が待っているので、やり直しは 1 回だけ
  const newLlm = geminiFactory(env, { retries: 1, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 2000))) })
  return async (prompt, schema) => {
    const llm = newLlm()
    try {
      return await llm.ask(prompt, schema, { step: 'チャット' })
    } finally {
      // 中身は出さず、使った量だけ
      console.log(JSON.stringify({ severity: 'INFO', msg: 'chat usage', ...llm.usage() }))
    }
  }
}

export function createApiServer(deps: ApiDeps = defaultApiDeps()) {
  return createAdaptorServer({ fetch: createApp(deps).fetch })
}
