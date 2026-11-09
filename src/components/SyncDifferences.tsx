import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type SyncDifference } from '../lib/api.ts'
import './SyncDifferences.css'

function valueText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '未記入'
  if (typeof value === 'boolean') return value ? 'はい' : 'いいえ'
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return JSON.stringify(value, null, 2)
}

export function SyncDifferences({ targetId, refreshKey, hasLocalEdits, onApplied }: {
  targetId: string
  refreshKey: unknown
  hasLocalEdits: boolean
  onApplied: () => void
}) {
  const [differences, setDifferences] = useState<SyncDifference[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const result = await api.syncDifferences(targetId)
      setDifferences(result.differences)
      setOpen((wasOpen) => wasOpen || result.differences.some((d) => d.status === 'review'))
      setError('')
    } catch (e) { setError((e as Error).message) }
  }, [targetId])

  useEffect(() => { void load() }, [load, refreshKey])
  useEffect(() => {
    const onFocus = () => { void load() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  const decide = async (d: SyncDifference, decision: 'apply' | 'keep') => {
    setBusy(d.key)
    setError('')
    try {
      const result = await api.decideSync(targetId, { key: d.key, decision, source: d.source, target: d.target })
      setDifferences(result.differences)
      if (decision === 'apply') onApplied()
    } catch (e) {
      await load()
      setError(e instanceof ApiError && e.status === 409 ? '書類の値が変わりました。最新の差異を読み直しました。' : (e as Error).message)
    } finally { setBusy('') }
  }

  const attention = differences.filter((d) => d.status === 'review').length
  if (!differences.length && !error) return null
  return (
    <section className="sync-differences" aria-label="書類間の差異">
      <button type="button" className="sync-differences-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="sync-differences-icon" aria-hidden="true">⇄</span>
        <span><strong>{attention ? `確認が必要な差異 ${attention} 件` : '書類間の差異'}</strong><small>アセスメントと入院時情報提供書を比較</small></span>
        <span className="sync-differences-chevron" aria-hidden="true">{open ? '閉じる −' : '見る ＋'}</span>
      </button>
      {open && (
        <div className="sync-differences-body">
          <p className="sync-differences-help">入院時情報提供書の値は作成後に独立します。内容を確かめて、欄ごとに反映するか選んでください。</p>
          {hasLocalEdits && <p className="sync-differences-warning">入力途中の欄があります。入力を確定してから反映してください。</p>}
          {error && <p role="alert" className="sync-differences-error">{error}</p>}
          {differences.map((d) => (
            <article className="sync-differences-row" key={d.key}>
              <div className="sync-differences-heading">
                <h3>{d.label}</h3>
                <span className={`sync-differences-status sync-differences-${d.status}`}>
                  {d.status === 'review' ? '要確認' : d.status === 'pending' ? '元書類が未保存' : '書類ごとに異なる記載'}
                </span>
              </div>
              <div className="sync-differences-values">
                <div><b>アセスメント</b><pre>{valueText(d.source)}</pre></div>
                <div><b>入院時情報提供書</b><pre>{valueText(d.target)}</pre></div>
              </div>
              {d.status === 'review' && (
                <div className="sync-differences-actions">
                  <button type="button" disabled={!!busy || hasLocalEdits} onClick={() => void decide(d, 'apply')}>{d.source === null ? '空欄を反映' : '入院時情報提供書に反映'}</button>
                  <button type="button" disabled={!!busy || hasLocalEdits} onClick={() => void decide(d, 'keep')}>今の記載を維持</button>
                </div>
              )}
            </article>
          ))}
          {attention > 0 && <p className="sync-differences-help">反映した欄は、入院時情報提供書を保存すると PDF に入ります。</p>}
        </div>
      )}
    </section>
  )
}
