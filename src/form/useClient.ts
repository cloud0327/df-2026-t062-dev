// 利用者と、録音の処理（ジョブ）の状態。処理中は数秒ごとに聞き、終わったら書類を読み直す。
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type ClientDetail, type JobView } from '../lib/api.ts'

const ACTIVE = (j: JobView) => j.status === 'queued' || j.status === 'processing'

export function useClient(clientId: string, onJobDone: () => void) {
  const [client, setClient] = useState<ClientDetail | null>(null)
  const [jobs, setJobs] = useState<JobView[]>([])
  const [error, setError] = useState('')
  const done = useRef(onJobDone)
  done.current = onJobDone
  const seen = useRef(new Set<string>())

  const load = useCallback(async () => {
    try {
      const r = await api.client(clientId)
      setClient(r.client)
      setJobs(r.jobs)
      for (const j of r.jobs) if (!ACTIVE(j)) seen.current.add(j.id)
    } catch (e) {
      setError(String((e as Error).message))
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const poll = useCallback(async () => {
    try {
      const r = await api.jobs(clientId)
      setJobs(r.jobs)
      let finished = false
      for (const j of r.jobs) {
        if (!ACTIVE(j) && !seen.current.has(j.id)) { seen.current.add(j.id); finished = true }
      }
      if (finished) done.current()
    } catch { /* 次に聞く */ }
  }, [clientId])

  const active = jobs.some(ACTIVE)
  useEffect(() => {
    const t = setInterval(() => void poll(), active ? 2500 : 15000)
    return () => clearInterval(t)
  }, [active, poll])

  return { client, jobs, error, reload: load, poll }
}
