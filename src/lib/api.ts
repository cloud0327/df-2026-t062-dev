// api の呼び出し。ログインのトークンを付ける。型は db/repo.ts と同じ形。
import type { ClientSummary, DocumentView, JobView, SlotEdit, SlotEditResult, Staff, SyncDifference } from '../../db/repo.ts'
import type { FormAssetsView, FormKind, FormVersionView } from '../../core/form.ts'

import type { SurveyImportKey, SurveySource } from '../../core/survey-import.ts'
import type { ChatMessage, ChatReply } from '../../api/chat.ts'

export type { ClientSummary, DocumentView, JobView, SlotEdit, SlotEditResult, Staff, SyncDifference }

export interface ClientDetail {
  id: string
  name: string
  status: string
  nextVisitAt: string | null
  documents: { id: string, kind: FormKind, formVersionId: string }[]
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

async function req<T>(method: string, path: string, body?: unknown, cache: RequestCache = 'no-store'): Promise<T> {
  const token = await tokenSource()
  const res = await fetch(path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache,
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new ApiError(res.status, j.message ?? j.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

/** 様式の版は中身が変わらないので、開いている間は覚えておく（ブラウザも覚える） */
const versions = new Map<string, Promise<FormVersionView>>()

export const api = {
  formVersion(id: string): Promise<FormVersionView> {
    let p = versions.get(id)
    if (!p) {
      p = req<{ formVersion: FormVersionView }>('GET', `/api/form-versions/${id}`, undefined, 'default').then((r) => r.formVersion)
      p.catch(() => versions.delete(id))
      versions.set(id, p)
    }
    return p
  },
  formAssets: (id: string) => req<FormAssetsView>('GET', `/api/form-versions/${id}/assets`),
  me: () => req<{ staff: Staff }>('GET', '/api/me'),
  clients: (q = '', sort: 'updated' | 'name' = 'updated') => req<{ clients: ClientSummary[] }>('GET', `/api/clients?q=${encodeURIComponent(q)}&sort=${sort}`),
  createClient: (input: { name: string, sex?: '男' | '女' | null, status?: string }) => req<{ id: string, assessmentId: string }>('POST', '/api/clients', input),
  client: (id: string) => req<{ client: ClientDetail, jobs: JobView[] }>('GET', `/api/clients/${id}`),
  createAdmission: (clientId: string) => req<{ id: string }>('POST', `/api/clients/${clientId}/documents`, { form: 'admission' }),
  document: (id: string) => req<{ document: DocumentView }>('GET', `/api/documents/${id}`),
  syncDifferences: (id: string) => req<{ differences: SyncDifference[] }>('GET', `/api/documents/${id}/sync-differences`),
  decideSync: (id: string, input: { key: string, decision: 'apply' | 'keep', source: unknown, target: unknown }) =>
    req<{ differences: SyncDifference[], document: DocumentView }>('POST', `/api/documents/${id}/sync-decisions`, input),
  patch: (id: string, changes: { key: string, value: unknown, base: unknown, mode?: 'edit' | 'revert' }[]) =>
    req<{ syncedTo: string[], document: DocumentView }>('PATCH', `/api/documents/${id}/fields`, { changes }),
  chat: (id: string, messages: ChatMessage[]) => req<ChatReply>('POST', `/api/documents/${id}/chat`, { messages }),
  importSurvey: (id: string, body: Pick<SurveySource, 'fileName' | 'sha256' | 'recordedOn'> & {
    changes: { key: SurveyImportKey, choice: number, base: unknown }[],
  }) => req<{ document: DocumentView }>('POST', `/api/documents/${id}/survey-import`, body),
  edits: (id: string, formVersionId: string, edits: SlotEdit[]) =>
    req<{ results: SlotEditResult[], syncedTo: string[], document: DocumentView }>('POST', `/api/documents/${id}/edits`, { formVersionId, edits }),
  save: (id: string, body: { scope: 'document' } | { scope: 'page', page: number } | { scope: 'hunk', key: string, hunkIndex: number }) =>
    req<{ rev: number, document: DocumentView }>('POST', `/api/documents/${id}/save`, body),
  jobs: (clientId: string) => req<{ jobs: JobView[] }>('GET', `/api/clients/${clientId}/jobs`),
  startRecording: (clientId: string, mime: string, deviceRecordingId: string, expiredUploadUrl?: string) =>
    req<{ recordingId: string, uploadUrl: string | null }>('POST', `/api/clients/${clientId}/recordings/resumable`, { mime, deviceRecordingId, expiredUploadUrl }),
  completeRecording: (id: string, durationMs: number, bytes: number) =>
    req<{ jobId: string, status: string }>('POST', `/api/recordings/${id}/complete`, { durationMs, bytes }),
  async pdf(id: string): Promise<Blob> {
    const token = await tokenSource()
    const res = await fetch(`/api/documents/${id}/pdf`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`)
    return res.blob()
  },
}
