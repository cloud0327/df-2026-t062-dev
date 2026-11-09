// ジョブを積む。
//   QUEUE_MODE=tasks: Cloud Tasks。worker の /tasks/jobs/<id>/run を OIDC トークンつきで呼ぶ
//   QUEUE_MODE=local（既定）: 同じプロセスで worker の処理を呼ぶ（ローカルとテスト）
export interface Queue {
  enqueue(jobId: string, options?: { initial: boolean }): Promise<void>
}

export class CloudTasksQueue implements Queue {
  private client: Promise<import('@google-cloud/tasks').CloudTasksClient> | undefined
  private env: NodeJS.ProcessEnv

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.env = env
  }

  async enqueue(jobId: string, options?: { initial: boolean }) {
    const { TASKS_QUEUE, WORKER_URL, TASKS_INVOKER_SA } = this.env
    if (!TASKS_QUEUE || !WORKER_URL || !TASKS_INVOKER_SA) throw new Error('TASKS_QUEUE・WORKER_URL・TASKS_INVOKER_SA を設定してください')
    this.client ??= import('@google-cloud/tasks').then((m) => new m.CloudTasksClient())
    const client = await this.client
    const attempt = options?.initial ? 'initial' : Date.now().toString(36)
    await client.createTask({
      parent: TASKS_QUEUE,
      task: {
        // 最初の投入は同じ名前を使う。見回りでの積み直しには別の名前が必要。
        name: `${TASKS_QUEUE}/tasks/job-${jobId}-${attempt}`,
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
    }).catch((e: unknown) => {
      if (!options?.initial || (e as { code?: number }).code !== 6) throw e // ALREADY_EXISTS
    })
  }
}

export class LocalQueue implements Queue {
  private run: (jobId: string) => Promise<void>
  private tail = Promise.resolve()

  constructor(run: (jobId: string) => Promise<void>) {
    this.run = run
  }

  async enqueue(jobId: string) {
    // ローカルには見回りがないため、先の録音が終わってから次を処理する。
    this.tail = this.tail.then(() => new Promise<void>((resolve) => setImmediate(resolve)))
      .then(() => this.run(jobId))
      .catch((e) => console.error(JSON.stringify({ msg: 'job failed', jobId, error: String(e?.name ?? 'Error') })))
  }
}
