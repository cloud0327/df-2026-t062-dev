// iPad の録音と送信。
//   - 録音は MediaRecorder。止めるまで端末（IndexedDB）にも書き出し、サーバーが受け取ったと答えるまで消さない
//   - 送信は Cloud Storage の再開できる送信（api が出す URL に、8 MiB ずつ Content-Range つきで PUT）。電波が切れても続きから
//   - 録音中は画面が消えないようにする（Wake Lock）
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.ts'
import { pickRecordingMime } from '../../core/audio.ts'

const CHUNK = 8 * 1024 * 1024 // 256 KiB の倍数
const DB = 'careman-recordings'

function idb<T>(fn: (s: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode = 'readonly'): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB, 1)
      open.onupgradeneeded = () => open.result.createObjectStore('pending')
      open.onerror = () => resolve(undefined)
      open.onsuccess = () => {
        const tx = open.result.transaction('pending', mode)
        const req = fn(tx.objectStore('pending'))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(undefined)
      }
    } catch {
      resolve(undefined)
    }
  })
}

interface PendingRec { clientId: string, blob: Blob, mime: string, durationMs: number }

/** 文字起こしできる形式で録る（PC の Chrome は webm の Opus、Safari は mp4 の AAC） */
function pickMime(): string {
  return pickRecordingMime((m) => typeof MediaRecorder !== 'undefined' && !!MediaRecorder.isTypeSupported?.(m))
}

/** 再開できる送信。進み具合（0〜100）を返す */
async function upload(url: string, blob: Blob, onPct: (n: number) => void) {
  const total = blob.size
  const put = (start: number, end: number) => new Promise<{ status: number, range: string | null }>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Range', end > start ? `bytes ${start}-${end - 1}/${total}` : `bytes */${total}`)
    xhr.upload.onprogress = (e) => onPct(Math.min(99, Math.round(((start + e.loaded) / total) * 100)))
    xhr.onload = () => resolve({ status: xhr.status, range: xhr.getResponseHeader('Range') })
    xhr.onerror = () => reject(new Error('network'))
    xhr.send(end > start ? blob.slice(start, end) : null)
  })
  let offset = 0
  let failures = 0
  while (offset < total) {
    try {
      const r = await put(offset, Math.min(total, offset + CHUNK))
      if (r.status === 200 || r.status === 201) { onPct(100); return }
      if (r.status === 308) {
        offset = r.range ? Number(r.range.split('-')[1]) + 1 : 0
        failures = 0
        continue
      }
      throw new Error(`HTTP ${r.status}`)
    } catch {
      if (++failures > 5) throw new Error('送れませんでした')
      await new Promise((res) => setTimeout(res, 1500 * failures))
      // どこまで届いたかを聞いてから続ける
      const s = await put(total, total).catch(() => null)
      if (s?.status === 200 || s?.status === 201) { onPct(100); return }
      offset = s?.range ? Number(s.range.split('-')[1]) + 1 : offset
    }
  }
  onPct(100)
}

export type RecPhase = 'idle' | 'rec' | 'upload' | 'sent' | 'error'

export function useRecorder(clientId: string, onSent: () => void) {
  const [phase, setPhase] = useState<RecPhase>('idle')
  const [pct, setPct] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const started = useRef(0)
  const wake = useRef<{ release(): Promise<void> } | null>(null)
  const sent = useRef(onSent)
  sent.current = onSent

  useEffect(() => {
    if (phase !== 'rec') return
    const t = setInterval(() => setElapsed(Date.now() - started.current), 500)
    return () => clearInterval(t)
  }, [phase])

  const send = useCallback(async (p: PendingRec) => {
    setPhase('upload')
    setPct(0)
    try {
      const { recordingId, uploadUrl } = await api.startRecording(p.clientId, p.mime || 'audio/webm')
      await upload(uploadUrl, p.blob, setPct)
      await api.completeRecording(recordingId, p.durationMs)
      await idb((s) => s.delete(p.clientId), 'readwrite')
      setPhase('sent')
      sent.current()
    } catch (e) {
      setError(String((e as Error).message))
      setPhase('error')
    }
  }, [])

  // 前に送り終わらなかった録音があれば、続きから送る
  useEffect(() => {
    void idb<PendingRec>((s) => s.get(clientId) as IDBRequest<PendingRec>).then((p) => { if (p?.blob) void send(p) })
  }, [clientId, send])

  const start = useCallback(async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = pickMime()
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunks.current = []
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data) }
      r.start(1000)
      rec.current = r
      started.current = Date.now()
      setElapsed(0)
      setPhase('rec')
      try { wake.current = await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen') ?? null } catch { /* 使えない端末 */ }
    } catch (e) {
      setError(`マイクを使えませんでした（${(e as Error).message}）`)
      setPhase('error')
    }
  }, [])

  const stop = useCallback(async () => {
    const r = rec.current
    if (!r) return
    const done = new Promise<void>((res) => { r.onstop = () => res() })
    r.stop()
    r.stream.getTracks().forEach((t) => t.stop())
    await done
    void wake.current?.release().catch(() => {})
    const mime = r.mimeType || pickMime()
    const p: PendingRec = { clientId, blob: new Blob(chunks.current, { type: mime }), mime, durationMs: Date.now() - started.current }
    rec.current = null
    await idb((s) => s.put(p, clientId), 'readwrite')
    await send(p)
  }, [clientId, send])

  const mmss = `${String(Math.floor(elapsed / 60000)).padStart(2, '0')}:${String(Math.floor(elapsed / 1000) % 60).padStart(2, '0')}`
  return { phase, pct, elapsed: mmss, error, start, stop, reset: () => setPhase('idle') }
}
