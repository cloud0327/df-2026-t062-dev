// worker の道。Cloud Run の設定で非公開にし、Cloud Tasks と Cloud Scheduler のサービスアカウントだけが呼べる。
import { Hono } from 'hono'
import { reconcile, runJob, type WorkerDeps } from './jobs.ts'

export function createWorkerApp(deps: WorkerDeps, enqueue: (jobId: string) => Promise<void>) {
  const app = new Hono()
  app.get('/health', (c) => c.json({ status: 'ok', source: 'worker' }))
  // 処理は応答の前に終える（Cloud Run は応答のあとの処理を遅くする）。失敗したら 500 で、Cloud Tasks が間をあけてやり直す
  app.post('/tasks/jobs/:id/run', async (c) => {
    await runJob(deps, c.req.param('id'))
    return c.json({ ok: true })
  })
  app.post('/tasks/reconcile', async (c) => c.json({ requeued: await reconcile(deps, enqueue) }))
  app.notFound((c) => c.json({ error: 'not_found' }, 404))
  app.onError((err, c) => {
    console.error(JSON.stringify({ severity: 'ERROR', msg: 'worker error', path: c.req.routePath, error: err.name }))
    return c.json({ error: 'internal' }, 500)
  })
  return app
}
