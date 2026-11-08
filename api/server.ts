import { createAdaptorServer } from '@hono/node-server'
import { createApp, type ApiDeps } from './app.ts'
import { defaultVerifier, type Verifier } from './auth.ts'
import { CloudTasksQueue, LocalQueue, type Queue } from './queue.ts'
import { defaultStorage, type Storage } from './storage.ts'

/** 依存は使うときに作る（health では DB にも Firebase にもつながない） */
export function defaultApiDeps(env: NodeJS.ProcessEnv = process.env): ApiDeps {
  let verifier: Verifier | undefined
  let storage: Storage | undefined
  let queue: Queue | undefined
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
    devAuth: env.AUTH_MODE === 'dev',
  }
}

export function createApiServer(deps: ApiDeps = defaultApiDeps()) {
  return createAdaptorServer({ fetch: createApp(deps).fetch })
}
