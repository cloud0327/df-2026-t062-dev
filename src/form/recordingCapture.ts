import { pickRecordingMime } from '../../core/audio.ts'
import type { PendingRecording } from './recordingStore.ts'

// 1秒ごとに届くチャンクを、最初のチャンクと以降9秒間隔で保存する。
const CHECKPOINT_MS = 9_000

export function captureRecording(
  stream: MediaStream, clientId: string, save: (recording: PendingRecording) => Promise<unknown>,
  onCheckpoint: (saved: boolean) => void,
) {
  const preferredMime = pickRecordingMime((mime) => !!MediaRecorder.isTypeSupported?.(mime))
  const recorder = new MediaRecorder(stream, preferredMime ? { mimeType: preferredMime } : undefined)
  const id = crypto.randomUUID()
  const startedAt = Date.now()
  const chunks: Blob[] = []
  let lastCheckpoint = 0
  let checkpoint = Promise.resolve()
  let stoppedAt: number | undefined
  let wake: WakeLockSentinel | undefined

  const release = () => {
    stream.getTracks().forEach((track) => track.stop())
    void wake?.release().catch(() => {})
    wake = undefined
  }
  const snapshot = (at: number): PendingRecording => {
    const mime = recorder.mimeType || chunks[0]?.type || preferredMime || 'audio/webm'
    return { id, clientId, startedAt, mime, blob: new Blob(chunks, { type: mime }), durationMs: Math.max(0, at - startedAt) }
  }

  recorder.ondataavailable = ({ data }) => {
    if (!data.size) return
    chunks.push(data)
    const at = Date.now()
    if (stoppedAt !== undefined || (lastCheckpoint && at - lastCheckpoint < CHECKPOINT_MS)) return
    lastCheckpoint = at
    const recording = snapshot(at)
    checkpoint = checkpoint.then(async () => {
      const saved = await save(recording).then(() => true, () => false)
      onCheckpoint(saved)
    })
  }
  const finished = new Promise<PendingRecording>((resolve) => {
    recorder.onstop = () => {
      release()
      const recording = snapshot(stoppedAt ?? Date.now())
      // 古いスナップショットが最後の保存を上書きしないよう、先行する保存を待つ。
      void checkpoint.then(() => resolve(recording))
    }
  })

  recorder.start(1000)
  void navigator.wakeLock?.request('screen').then((lock) => {
    if (recorder.state === 'inactive') void lock.release().catch(() => {})
    else wake = lock
  }).catch(() => {})

  return {
    startedAt,
    finished,
    stop() {
      if (recorder.state === 'inactive') return
      stoppedAt = Date.now()
      try { recorder.stop() } finally { release() }
    },
  }
}
