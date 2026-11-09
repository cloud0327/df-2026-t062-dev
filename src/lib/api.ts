// api の呼び出し。ログインのトークンを付ける。型は db/repo.ts と同じ形。
import type { ClientSummary, DocumentView, JobView, Staff } from '../../db/repo.ts'
import type { FormId } from '../../forms/index.ts'

export type { ClientSummary, DocumentView, JobView, Staff }

export interface ClientDetail {
  id: string
  name: string
  status: string
  nextVisitAt: string | null
  documents: { id: string, form: FormId }[]
  required: { filled: number, total: number }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

let tokenSource: () => Promise<string | null> = async () => null
export function setTokenSource(fn: () => Promise<string | null>) {
  tokenSource = fn
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await tokenSource()
  const res = await fetch(path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new ApiError(res.status, j.message ?? j.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  me: () => req<{ staff: Staff }>('GET', '/api/me'),
  clients: (q = '', sort: 'updated' | 'name' = 'updated') => req<{ clients: ClientSummary[] }>('GET', `/api/clients?q=${encodeURIComponent(q)}&sort=${sort}`),
  createClient: (input: { name: string, sex?: '男' | '女' | null, status?: string }) => req<{ id: string, assessmentId: string }>('POST', '/api/clients', input),
  client: (id: string) => req<{ client: ClientDetail, jobs: JobView[] }>('GET', `/api/clients/${id}`),
  createAdmission: (clientId: string) => req<{ id: string }>('POST', `/api/clients/${clientId}/documents`, { form: 'admission' }),
  document: (id: string) => req<{ document: DocumentView }>('GET', `/api/documents/${id}`),
  patch: (id: string, changes: { key: string, value: unknown, mode?: 'edit' | 'revert' }[]) =>
    req<{ syncedTo: string[], document: DocumentView }>('PATCH', `/api/documents/${id}/fields`, { changes }),
  save: (id: string, body: { scope: 'document' } | { scope: 'page', page: number } | { scope: 'hunk', key: string, hunkIndex: number }) =>
    req<{ rev: number, document: DocumentView }>('POST', `/api/documents/${id}/save`, body),
  jobs: (clientId: string) => req<{ jobs: JobView[] }>('GET', `/api/clients/${clientId}/jobs`),
  startRecording: (clientId: string, mime: string) => req<{ recordingId: string, uploadUrl: string }>('POST', `/api/clients/${clientId}/recordings`, { mime }),
  completeRecording: (id: string, durationMs: number | null) => req<{ jobId: string, status: string }>('POST', `/api/recordings/${id}/complete`, { durationMs }),
  async pdf(id: string): Promise<Blob> {
    const token = await tokenSource()
    const res = await fetch(`/api/documents/${id}/pdf`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`)
    return res.blob()
  },
}
