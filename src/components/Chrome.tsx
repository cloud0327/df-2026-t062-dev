// PC の上の帯（キャンバスの header と同じ）と、小さな共通部品
import { useAuth } from '../lib/auth.tsx'

export function PcHeader({ staffName }: { staffName: string }) {
  const auth = useAuth()
  return (
    <header style={{ flex: '0 0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 24px', background: '#FFFFFF', borderBottom: '1px solid #E1E4EA' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Logo size={32} />
        <div style={{ fontWeight: 700, fontSize: 15 }}>ケア書類アシスタント<span style={{ fontWeight: 400, color: '#5A6270', fontSize: 12, marginLeft: 4 }}>（仮）</span></div>
      </div>
      <button type="button" onClick={() => void auth.signOut()} title="ログアウト" style={{ font: 'inherit', fontSize: 13, color: '#5A6270', background: 'none', border: 0, cursor: 'pointer', padding: 0 }}>{staffName}（ケアマネ）</button>
    </header>
  )
}

export function Logo({ size }: { size: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size / 4, background: '#2453C4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M8 13h8" /><path d="M8 17h5" /></svg>
    </div>
  )
}

export const countText = (c: { ai: number, hand: number }) =>
  c.ai || c.hand ? `未保存: AI の変更 ${c.ai} か所${c.hand ? `・手入力 ${c.hand} 欄` : ''}` : ''

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
