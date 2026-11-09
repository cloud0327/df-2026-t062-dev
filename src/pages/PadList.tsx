// iPad ① 利用者（キャンバス PadList）
import { useEffect, useState } from 'react'
import { api, type ClientSummary } from '../lib/api.ts'
import { linkProps } from '../lib/router.tsx'
import { Logo } from '../components/Chrome.tsx'
import { useAuth } from '../lib/auth.tsx'

const visit = (iso: string | null) => {
  if (!iso) return '次の訪問は未定'
  const d = new Date(iso)
  const hm = d.getHours() || d.getMinutes() ? ` ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : ''
  return `次の訪問 ${d.getMonth() + 1}/${d.getDate()}${hm}`
}

export function PadList({ staffName }: { staffName: string }) {
  const [clients, setClients] = useState<ClientSummary[]>([])
  const [q, setQ] = useState('')
  
const [error, setError] = useState('')
const [retry, setRetry] = useState(0)
const [loading, setLoading] = useState(true)

  const auth = useAuth()
  useEffect(() => {
  let cancelled = false

  setLoading(true)
  setError('')

  const t = setTimeout(() => {
    api.clients(q, 'updated')
      .then((r) => {
        if (cancelled) return
        setClients(r.clients)
        setError('')
      })
      .catch(() => {
        if (cancelled) return
        setError('利用者一覧を読み込めませんでした。')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
  }, q ? 250 : 0)

  return () => {
    cancelled = true
    clearTimeout(t)
  }
}, [q, retry])
  const sorted = [...clients].sort((a, b) => (a.nextVisitAt ?? '9').localeCompare(b.nextVisitAt ?? '9'))

  return (
    <div className="pad" style={{ minHeight: '100vh', fontFamily: "'Noto Sans JP',system-ui,sans-serif", color: '#1F2430', background: '#F4F5F7', fontSize: 16, lineHeight: 1.6, display: 'flex', flexDirection: 'column' }}>
      <header style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 24px', background: '#FFFFFF', borderBottom: '1px solid #E1E4EA' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo size={36} />
          <div style={{ fontWeight: 700, fontSize: 17 }}>ケア書類アシスタント</div>
        </div>
        <button type="button" onClick={() => void auth.signOut()} style={{ font: 'inherit', fontSize: 15, color: '#5A6270', background: 'none', border: 0, cursor: 'pointer', minHeight: 44 }}>{staffName}</button>
      </header>
      <main style={{ flex: '1 1 auto', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 820, width: '100%', margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 6px', fontSize: 28, fontWeight: 700 }}>利用者</h1>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <label htmlFor="q" className="sr">氏名で探す</label>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5A6270" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ position: 'absolute', left: 16 }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          <input id="q" type="search" placeholder="氏名で探す" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 17, padding: '12px 16px 12px 46px', border: '1px solid #CBD1DA', borderRadius: 12, background: '#FFFFFF', color: '#1F2430', minHeight: 54 }} />
        </div>
        
{error && (
  <div role="alert" style={{
    background: '#FFF4F2',
    border: '1px solid #F0B4AA',
    borderRadius: 12,
    padding: 16,
    color: '#A3261C',
  }}>
    <p>利用者一覧を読み込めませんでした。</p>
    <button type="button" className="btn" onClick={() => setRetry((n) => n + 1)}>
      もう一度
    </button>
  </div>
)}

{loading && !error && <p role="status">読み込み中...</p>}

        {!error && !loading && sorted.map((c) => (
          <a key={c.id} className="row" {...linkProps(`/clients/${c.id}`)}>
            <div style={{ flex: '1 1 auto', minWidth: 0 }}><div className="nm">{c.name} さん</div><div className="psub">{visit(c.nextVisitAt)}</div></div>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9AA3B0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </a>
        ))}
      </main>
    </div>
  )
}
