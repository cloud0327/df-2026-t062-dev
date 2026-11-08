// worker の入口（api と同じイメージ。起動のコマンドだけ違う: node worker/index.ts）
import { createAdaptorServer } from '@hono/node-server'
import { defaultStorage } from '../api/storage.ts'
import { CloudTasksQueue } from '../api/queue.ts'
import { getDb } from '../db/pool.ts'
import { createWorkerApp } from './app.ts'
import { defaultProviders } from './providers.ts'

const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 8788)
let storage: ReturnType<typeof defaultStorage> | undefined
const deps = { db: getDb, storage: () => (storage ??= defaultStorage()), providers: () => defaultProviders() }
const queue = new CloudTasksQueue()
const server = createAdaptorServer({ fetch: createWorkerApp(deps, (id) => queue.enqueue(id)).fetch })
server.listen(port, host, () => console.log(`Worker listening on http://${host}:${port}`))
