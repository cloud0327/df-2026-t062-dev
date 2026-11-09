import { useState } from 'react'
import { sameValue } from '../../core/apply-batch.ts'
import { spec } from '../../core/fields.ts'
import { SURVEY_IMPORT_KEYS, surveyChoice, type SurveyImportKey } from '../../core/survey-import.ts'
import { api, ApiError, type DocumentView } from '../lib/api.ts'
import type { SurveyPreview } from './readSurvey.ts'

export interface SurveyImportProps {
  document: DocumentView
  clientName: string
  beforeApply: () => Promise<boolean>
  onApplied: () => void
}

export function SurveyImport({ document, clientName, beforeApply, onApplied }: SurveyImportProps) {
  const [preview, setPreview] = useState<SurveyPreview | null>(null)
  const [selected, setSelected] = useState<Set<SurveyImportKey>>(new Set())
  const [reviewDoc, setReviewDoc] = useState<DocumentView>(document)
  const [stale, setStale] = useState(false)
  const [recordedOn, setRecordedOn] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState<'reading' | 'applying' | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const choose = async (file: File) => {
    setPreview(null)
    setSelected(new Set())
    setConfirmed(false)
    setRecordedOn('')
    setError('')
    setMessage('')
    setBusy('reading')
    try {
      const { readSurvey } = await import('./readSurvey.ts')
      const result = await readSurvey(file)
      const latest = await api.document(document.id)
      setReviewDoc(latest.document)
      setStale(false)
      setPreview(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDFを読み取れませんでした。')
    } finally {
      setBusy(null)
    }
  }

  const apply = async () => {
    if (!preview || stale || busy || !confirmed || !selected.size) return
    const changes = preview.candidates.flatMap(({ key, choice }) =>
      choice !== null && selected.has(key) ? [{ key, choice, base: reviewDoc.fields[key]?.value ?? null }] : [],
    )
    setBusy('applying')
    setError('')
    setMessage('')
    try {
      if (!await beforeApply()) throw new Error('用紙の入力を送信できませんでした。用紙の状態を確認してください。')
      const { document: updated } = await api.importSurvey(document.id, {
        fileName: preview.fileName, sha256: preview.sha256, recordedOn: recordedOn || null, changes,
      })
      setReviewDoc(updated)
      setSelected(new Set())
      setMessage(`${changes.length}項目をp.6に反映しました。内容を確認して保存してください。`)
      onApplied()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setSelected(new Set())
        setConfirmed(false)
        const latest = await api.document(document.id).catch(() => null)
        if (latest) setReviewDoc(latest.document)
        setStale(!latest)
        setError(latest ? '用紙の値が変わりました。最新の値を見比べて、反映する項目を選び直してください。'
          : '最新の用紙を取得できません。用紙を読み直してから反映してください。')
      } else {
        setError(e instanceof Error ? e.message : '反映できませんでした。')
      }
    } finally {
      setBusy(null)
    }
  }

  const refresh = async () => {
    setBusy('applying')
    try {
      const latest = await api.document(document.id)
      setReviewDoc(latest.document)
      setStale(false)
      setError('最新の値を見比べて、反映する項目を選び直してください。')
    } catch {
      setError('最新の用紙を取得できません。時間をおいて読み直してください。')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-label="認定調査票の取り込み" className="survey-import">
      <label>認定調査票のPDFを選ぶ
        <input type="file" accept="application/pdf,.pdf" disabled={busy !== null}
          onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void choose(file) }} />
      </label>
      <p>広島市版のテキスト付きPDF（10 MBまで）。裏面の生活機能、第2群の12項目（2-1〜2-12）を読み取ります。</p>
      {busy === 'reading' && <p role="status">読み取り中です…</p>}
      {error && <p role="alert" className="survey-import-error">{error}</p>}
      {message && <p role="status">{message}</p>}
      {stale && <button className="assistant-outline" type="button" disabled={busy !== null} onClick={() => void refresh()}>用紙を読み直す</button>}
      {preview && (
        <div className="survey-import-review">
          <strong>{message ? '反映結果' : '確認待ち'} · {preview.fileName}</strong>
          <details>
            <summary>原本p.1で対象者と調査日を確認</summary>
            <img src={preview.identity} alt="原本p.1の調査日と対象者欄" />
          </details>
          <label>調査日（不明なら空欄）
            <input type="date" value={recordedOn} disabled={busy !== null} onChange={(e) => setRecordedOn(e.target.value)} />
          </label>
          <label className="survey-check">
            <input type="checkbox" checked={confirmed} disabled={busy !== null} onChange={(e) => setConfirmed(e.target.checked)} />
            原本が{clientName}さんのものだと確認した
          </label>
          {preview.candidates.map(({ key, choice, reason, preview: row, note }) => {
            const value = choice === null ? undefined : surveyChoice(key, choice)
            const current = reviewDoc.fields[key]?.value ?? null
            const same = value !== undefined && sameValue(current, value)
            return (
              <fieldset key={key} disabled={stale || busy !== null}>
                <legend>{spec(key)?.label ?? key}</legend>
                <div>用紙の現在値：{current == null ? '空欄' : String(current)}</div>
                <div>{reason ? `要確認：${reason}` : `読み取り候補：${value}`}</div>
                <details>
                  <summary>原本p.2の印を見る</summary>
                  <img src={row} alt={`${spec(key)?.label ?? key}の原本の選択欄`} />
                </details>
                {note && <p>特記事項 p.3：{note}</p>}
                {reason ? <small>原本を確認し、必要なら用紙で入力してください。</small> : same ? <small>用紙と同じ値です。</small> : (
                  <label className="survey-check">
                    <input type="checkbox" checked={selected.has(key)} onChange={(e) => {
                      const next = new Set(selected)
                      if (e.target.checked) next.add(key)
                      else next.delete(key)
                      setSelected(next)
                    }} />
                    この項目を反映する
                  </label>
                )}
              </fieldset>
            )
          })}
          <button className="assistant-primary" type="button" disabled={stale || !confirmed || !selected.size || busy !== null} onClick={() => void apply()}>
            {busy === 'applying' ? '反映中…' : `選んだ${selected.size}項目を反映`}
          </button>
        </div>
      )}
      {SURVEY_IMPORT_KEYS.some((key) => document.fields[key]?.surveySource) && (
        <details>
          <summary>現在の値の出典を見る</summary>
          <ul>
            {SURVEY_IMPORT_KEYS.map((key) => {
              const source = document.fields[key]?.surveySource
              return source && <li key={key}>{spec(key)?.label}：{source.fileName} p.{source.page}、選択肢{source.choice}、調査日 {source.recordedOn ?? '不明'}</li>
            })}
          </ul>
        </details>
      )}
    </section>
  )
}
