import { api } from '../lib/api.ts'
import type { PendingRecording } from './recordingStore.ts'

const CHUNK = 8 * 1024 * 1024 // 256 KiB の倍数

/** 保存済みの範囲を照会し、最後に確定したバイトの次から送る。 */
async function upload(url: string, blob: Blob, onPct: (n: number) => void): Promise<'uploaded' | 'expired'> {
  const total = blob.size
  const put = (start: number, end: number) => new Promise<{ status: number, range: string | null }>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.timeout = 120_000
    xhr.setRequestHeader('Content-Range', end > start ? `bytes ${start}-${end - 1}/${total}` : `bytes */${total}`)
    xhr.upload.onprogress = (e) => onPct(Math.min(99, Math.round(((start + e.loaded) / total) * 100)))
    xhr.onload = () => resolve({ status: xhr.status, range: xhr.getResponseHeader('Range') })
    xhr.onerror = xhr.ontimeout = () => reject(new Error('network'))
    xhr.send(end > start ? blob.slice(start, end) : null)
  })

  let offset = 0
  let probe = true
  let failures = 0
  for (;;) {
    try {
      const response = probe ? await put(total, total) : await put(offset, Math.min(total, offset + CHUNK))
      if (response.status === 200 || response.status === 201) return 'uploaded'
      // 412 は別の送信が先に同じオブジェクトを確定した場合。APIで確かめ直す。
      if ([404, 410, 412].includes(response.status)) return 'expired'
      if (response.status !== 308) throw new Error(`HTTP ${response.status}`)
      const match = /^bytes=0-(\d+)$/.exec(response.range ?? '')
      const next = match ? Number(match[1]) + 1 : 0
      if (next >= total || (!probe && next <= offset)) throw new Error('upload did not advance')
      if (next > offset) failures = 0
      offset = next
      probe = false
    } catch {
      if (++failures > 5) throw new Error('録音を送れませんでした')
      await new Promise((resolve) => setTimeout(resolve, 1500 * failures))
      probe = true
    }
  }
}

export async function sendRecording(recording: PendingRecording, onPct: (n: number) => void) {
  const { clientId, id, mime, blob, durationMs } = recording
  let session = await api.startRecording(clientId, mime, id)
  if (session.uploadUrl && await upload(session.uploadUrl, blob, onPct) === 'expired') {
    session = await api.startRecording(clientId, mime, id, session.uploadUrl)
    if (session.uploadUrl && await upload(session.uploadUrl, blob, onPct) === 'expired') {
      throw new Error('録音を送れませんでした')
    }
  }
  await api.completeRecording(session.recordingId, durationMs, blob.size)
  onPct(100)
}
