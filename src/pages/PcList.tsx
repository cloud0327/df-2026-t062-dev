// PC ① 利用者一覧（キャンバス PcList）
import { useEffect, useState } from 'react'
import { api, type ClientSummary } from '../lib/api.ts'
import { linkProps, navigate } from '../lib/router.tsx'
import { PcHeader } from '../components/Chrome.tsx'

export function PcList({ staffName }: { staffName: string }) {
  const [clients, setClients] = useState<ClientSummary[] | null>(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'updated' | 'name'>('updated')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const t = setTimeout(() => {
      api.clients(q, sort).then((r) => setClients(r.clients)).catch((e) => setError(String(e.message)))
    }, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [q, sort])

  return (
    <div className="pc" style={{ fontFamily: "'Noto Sans JP',system-ui,sans-serif", color: '#1F2430', background: '#F4F5F7', minHeight: '100vh', fontSize: 14, lineHeight: 1.6 }}>
      <PcHeader staffName={staffName} />
      <main style={{ maxWidth: 1000, margin: '0 auto', padding: '28px 24px 40px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>担当の利用者</h1>
            <p style={{ margin: '2px 0 0', color: '#5A6270', fontSize: 13 }}>{clients ? `${clients.length} 人` : ' '}</p>
          </div>
          <button className="btn btn-p" type="button" onClick={() => setAdding(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>利用者を追加
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <div style={{ flex: '1 1 280px', position: 'relative', display: 'flex', alignItems: 'center' }}>
            <label className="sr" htmlFor="q">氏名で探す</label>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5A6270" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ position: 'absolute', left: 12 }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            <input id="q" type="search" placeholder="氏名で探す" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 14, padding: '9px 12px 9px 36px', border: '1px solid #CBD1DA', borderRadius: 8, background: '#FFFFFF', color: '#1F2430', minHeight: 40 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label htmlFor="sort" style={{ fontSize: 13, color: '#5A6270' }}>並べ替え</label>
            <select id="sort" value={sort} onChange={(e) => setSort(e.target.value as 'updated' | 'name')} style={{ font: 'inherit', fontSize: 13, padding: '8px 10px', border: '1px solid #CBD1DA', borderRadius: 8, background: '#FFFFFF', color: '#1F2430', minHeight: 40 }}>
              <option value="updated">更新日が新しい順</option>
              <option value="name">氏名順</option>
            </select>
          </div>
        </div>

        {error && <div role="alert" style={{ color: '#A3261C', fontSize: 13 }}>読み込めませんでした（{error}）</div>}

        <div style={{ background: '#FFFFFF', border: '1px solid #E1E4EA', borderRadius: 12, overflowX: 'auto' }}>
          <div style={{ minWidth: 640 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '240px 120px minmax(240px,1fr)', gap: 20, padding: '10px 20px', fontSize: 12, fontWeight: 700, color: '#5A6270', background: '#F9FAFB' }}>
              <div>利用者</div>
              <div>要介護度</div>
              <div>アセスメント（必須 {clients?.[0]?.required.total ?? 84} 欄）</div>
            </div>
            {(clients ?? []).map((c) => {
              const pct = c.required.total ? (c.required.filled / c.required.total) * 100 : 0
              const sub = [c.sex ? `${c.sex}性` : null, c.status, c.isNew ? '新規' : null].filter(Boolean).join(' ・ ')
              const filledText = c.required.filled === 0 ? 'まだ何も入っていません' : c.required.filled >= c.required.total ? 'すべて入っています' : `${c.required.filled} 欄が入っています`
              return (
                <a className="row" key={c.id} {...linkProps(`/clients/${c.id}`)}>
                  <div><span className="name">{c.name} さん</span><div className="sub">{sub}</div></div>
                  <div>{c.careLevel ? <span className="chip c-gray">{c.careLevel.replace(/(\d)$/, ' $1')}</span> : <span className="chip c-miss">未入力</span>}</div>
                  <div><div className="bar">{pct > 0 && <div style={{ height: 8, width: `${pct.toFixed(1)}%`, background: '#2F5FD0' }} />}</div><div className="sub" style={{ marginTop: 6 }}>{filledText}</div></div>
                </a>
              )
            })}
          </div>
        </div>
      </main>
      {adding && <AddClient onClose={() => setAdding(false)} />}
    </div>
  )
}

/** 利用者を追加（キャンバスにない画面なので、同じ色と部品で作った） */
function AddClient({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [sex, setSex] = useState<'男' | '女' | ''>('')
  const [status, setStatus] = useState('在宅')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      const r = await api.createClient({ name: name.trim(), sex: sex || null, status })
      navigate(`/clients/${r.id}`)
    } catch (err) {
      setError(String((err as Error).message))
      setBusy(false)
    }
  }
  const field = { width: '100%', boxSizing: 'border-box' as const, font: 'inherit', fontSize: 14, padding: '9px 12px', border: '1px solid #CBD1DA', borderRadius: 8, background: '#FFFFFF', color: '#1F2430', minHeight: 40 }
  return (
    <div role="dialog" aria-modal="true" aria-label="利用者を追加" style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,32,0.35)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh', zIndex: 50 }} onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px, calc(100% - 32px))', background: '#FFFFFF', borderRadius: 14, boxShadow: '0 8px 30px rgba(20,24,32,0.18)', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>利用者を追加</div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#5A6270' }}>氏名
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} style={field} required maxLength={60} />
        </label>
        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#5A6270' }}>性別
            <select value={sex} onChange={(e) => setSex(e.target.value as '男' | '女' | '')} style={field}><option value="">—</option><option value="男">男性</option><option value="女">女性</option></select>
          </label>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#5A6270' }}>いまの場所
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={field}><option>在宅</option><option>入院中</option><option>入所中</option></select>
          </label>
        </div>
        {error && <div role="alert" style={{ color: '#A3261C', fontSize: 13 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>やめる</button>
          <button type="submit" className="btn btn-p" disabled={busy || !name.trim()}>追加する</button>
        </div>
      </form>
    </div>
  )
}
