// iPad の録音と送信。録音は端末に逐次保存し、API が受け付けた録音だけを消す。
import { useCallback, useEffect, useRef, useState } from 'react'
import { captureRecording } from './recordingCapture.ts'
import { deleteRecording, pendingRecordings, saveRecording, type PendingRecording } from './recordingStore.ts'
import { sendRecording } from './recordingUpload.ts'

export type RecPhase = 'idle' | 'rec' | 'upload' | 'sent' | 'error'

interface RecorderScope {
  clientId: string
  disposed: boolean
  busy: boolean
  capture: ReturnType<typeof captureRecording> | null
  unsaved: Map<string, PendingRecording>
}

const localLocks = new Map<string, Promise<void>>()

function withRecordingLock(clientId: string, run: () => Promise<void>) {
  const key = `careman-recordings:${clientId}`
  // 別タブで録音中の途中データを復旧対象にしない。
  if (navigator.locks) return navigator.locks.request(key, run)
  const work = (localLocks.get(key) ?? Promise.resolve()).then(run)
  const tail = work.then(() => {}, () => {})
  localLocks.set(key, tail)
  return work.finally(() => { if (localLocks.get(key) === tail) localLocks.delete(key) })
}

export function useRecorder(clientId: string, onSent: () => void) {
  const [phase, setPhase] = useState<RecPhase>('idle')
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [storageWarning, setStorageWarning] = useState(false)
  const scope = useRef<RecorderScope | null>(null)
  const sent = useRef(onSent)
  sent.current = onSent

  useEffect(() => {
    if (phase !== 'rec') return
    const capture = scope.current?.capture
    if (!capture) return
    const timer = setInterval(() => setElapsed(Date.now() - capture.startedAt), 500)
    return () => clearInterval(timer)
  }, [phase])

  const sendPending = useCallback(async (current: RecorderScope) => {
    try {
      for (const recording of current.unsaved.values()) {
        await saveRecording(recording)
        current.unsaved.delete(recording.id)
      }
    } catch {
      throw new Error('録音をこの端末に保存できませんでした。画面を開いたまま、空き容量などを確認して再試行してください。')
    }
    const pending = await pendingRecordings(current.clientId).catch(() => {
      throw new Error('端末の録音を読み込めませんでした。ブラウザの保存設定を確認して再試行してください。')
    })
    for (const recording of pending) {
      if (current.disposed) return
      setPhase('upload')
      setPct(0)
      try {
        await sendRecording(recording, (n) => { if (!current.disposed) setPct(n) })
      } catch {
        throw new Error('録音を送れませんでした。未送信の録音はこの端末に残っています。通信できる場所で再試行してください。')
      }
      await deleteRecording(recording.id).catch(() => {
        throw new Error('録音は送信済みですが、この端末の送信待ち一覧を更新できませんでした。再試行してください。')
      })
      if (!current.disposed) sent.current()
    }
    if (!current.disposed) setPhase(pending.length ? 'sent' : 'idle')
  }, [])

  const run = useCallback(async (current: RecorderScope, action: () => Promise<void>) => {
    if (current.disposed || current.busy) return
    current.busy = true
    setBusy(true)
    setError('')
    try {
      await withRecordingLock(current.clientId, async () => {
        if (!current.disposed) await action()
      })
    } catch (e) {
      if (!current.disposed) {
        setError((e as Error).message)
        setPhase('error')
      }
    } finally {
      current.busy = false
      if (!current.disposed) setBusy(false)
    }
  }, [])

  useEffect(() => {
    const current: RecorderScope = { clientId, disposed: false, busy: false, capture: null, unsaved: new Map() }
    scope.current = current
    setPhase('idle')
    setStorageWarning(false)
    const stopCapture = () => current.capture?.stop()
    window.addEventListener('pagehide', stopCapture)
    void run(current, () => sendPending(current))
    return () => {
      current.disposed = true
      window.removeEventListener('pagehide', stopCapture)
      stopCapture()
    }
  }, [clientId, run, sendPending])

  const start = useCallback(async () => {
    const current = scope.current
    if (!current) return
    await run(current, async () => {
      let stream: MediaStream | undefined
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (current.disposed) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        setStorageWarning(false)
        current.capture = captureRecording(stream, current.clientId, saveRecording, (saved) => {
          if (!current.disposed) setStorageWarning(!saved)
        })
      } catch (e) {
        stream?.getTracks().forEach((track) => track.stop())
        throw new Error(`マイクを使えませんでした（${(e as Error).message}）`)
      }

      setElapsed(0)
      setPhase('rec')
      const recording = await current.capture.finished
      current.capture = null
      if (!recording.blob.size) throw new Error('録音データを取得できませんでした。もう一度録音してください。')

      // 離脱時も、最後のチャンクまで保存してからロックを解放する。
      current.unsaved.set(recording.id, recording)
      if (current.disposed) {
        await saveRecording(recording)
        return
      }
      setPhase('upload')
      setPct(0)
      await sendPending(current)
    })
  }, [run, sendPending])

  const stop = () => scope.current?.capture?.stop()
  const retry = () => {
    const current = scope.current
    if (current) void run(current, () => sendPending(current))
  }
  const mmss = `${String(Math.floor(elapsed / 60000)).padStart(2, '0')}:${String(Math.floor(elapsed / 1000) % 60).padStart(2, '0')}`
  return { phase, busy, pct, elapsed: mmss, error, storageWarning, start, stop, retry, reset: () => setPhase('idle') }
}
