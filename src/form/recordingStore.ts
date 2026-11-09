// 読み書きの成功は、リクエスト単体ではなくトランザクションの確定で判断する。
const DB = 'careman-recordings'

export interface PendingRecording {
  id: string
  clientId: string
  blob: Blob
  mime: string
  startedAt: number
  durationMs: number
}

function idb<T>(fn: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode = 'readonly'): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore('pending')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      try {
        const tx = db.transaction('pending', mode)
        const request = fn(tx.objectStore('pending'))
        tx.oncomplete = () => resolve(request.result)
        tx.onabort = () => reject(tx.error ?? request.error ?? new Error('IndexedDB transaction aborted'))
      } catch (error) {
        reject(error)
      } finally {
        // close() は開始済みのトランザクションが確定するまで待つ。
        db.close()
      }
    }
  })
}

export const saveRecording = (recording: PendingRecording) => idb((s) => s.put(recording, recording.id), 'readwrite')
export const deleteRecording = (id: string) => idb((s) => s.delete(id), 'readwrite')

export async function pendingRecordings(clientId: string): Promise<PendingRecording[]> {
  const recordings = await idb((s) => s.getAll() as IDBRequest<PendingRecording[]>)
  // 旧形式（利用者IDがキー）は録音IDを持たない。
  return recordings.filter((p) => p.id && p.clientId === clientId && p.blob.size > 0)
    .sort((a, b) => a.startedAt - b.startedAt)
}
