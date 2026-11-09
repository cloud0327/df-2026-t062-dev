import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWorkerApp } from '../worker/app.ts'
import type { WorkerDeps } from '../worker/jobs.ts'

test('worker health check uses a Cloud Run compatible path', async () => {
  const app = createWorkerApp({} as WorkerDeps, async () => {})
  const response = await app.request('/health')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok', source: 'worker' })
})
