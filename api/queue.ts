// ジョブを積む。
//   QUEUE_MODE=tasks: Cloud Tasks。worker の /tasks/jobs/<id>/run を OIDC トークンつきで呼ぶ
//   QUEUE_MODE=local（既定）: 同じプロセスで worker の処理を呼ぶ（ローカルとテスト）
export interface Queue {
  enqueue(jobId: string): Promise<void>
}

export class CloudTasksQueue implements Queue {
  private client: Promise<import('@google-cloud/tasks').CloudTasksClient> | undefined
  private env: NodeJS.ProcessEnv

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.env = env
  }

  async enqueue(jobId: string) {
    const { TASKS_QUEUE, WORKER_URL, TASKS_INVOKER_SA } = this.env
    if (!TASKS_QUEUE || !WORKER_URL || !TASKS_INVOKER_SA) throw new Error('TASKS_QUEUE・WORKER_URL・TASKS_INVOKER_SA を設定してください')
    this.client ??= import('@google-cloud/tasks').then((m) => new m.CloudTasksClient())
    const client = await this.client
    await client.createTask({
      parent: TASKS_QUEUE,
      task: {
        // 再配信・見回りでは複数タスクになりうる。DB の実行トークンで一つだけ取得する。
        name: `${TASKS_QUEUE}/tasks/job-${jobId}-${Date.now().toString(36)}`,
        dispatchDeadline: { seconds: 1800 },
        httpRequest: {
          httpMethod: 'POST',
          url: `${WORKER_URL}/tasks/jobs/${jobId}/run`,
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.from('{}').toString('base64'),
          // audience は worker の URL（パスを含めない）
          oidcToken: { serviceAccountEmail: TASKS_INVOKER_SA, audience: WORKER_URL },
        },
      },
    })
  }
}

export class LocalQueue implements Queue {
  private run: (jobId: string) => Promise<void>

  constructor(run: (jobId: string) => Promise<void>) {
    this.run = run
  }

  async enqueue(jobId: string) {
    setImmediate(() => {
      this.run(jobId).catch((e) => console.error(JSON.stringify({ msg: 'job failed', jobId, error: String(e?.name ?? 'Error') })))
    })
  }
}
