// 作業のお手伝い（キャンバスの部品 PetHelper）。右下の猫を押すと、用紙の上に浮かんで出る。
// メニューを押したあとの動きとメモの送り先は、まだ決めていない（2026-11-09。モックのまま）。
import { useState } from 'react'

interface Props {
  context: string
  message: string
  items: string[]
  startOpen?: boolean
}

export function PetHelper({ context, message, items, startOpen = true }: Props) {
  const [open, setOpen] = useState(startOpen)
  const list = items.map((label, i) => ({ no: (i < 9 ? '0' : '') + (i + 1), label }))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 14, fontFamily: "'Noto Sans JP',system-ui,sans-serif", color: '#1F2430', fontSize: 13, lineHeight: 1.6 }}>
      {open && (
        <div role="dialog" aria-label="作業のお手伝い" style={{ width: 360, background: '#FFFFFF', border: '1px solid #E1E4EA', borderRadius: 16, boxShadow: '0 12px 36px rgba(20,24,32,0.18)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px' }}>
            <span aria-hidden="true" style={{ width: 30, height: 30, borderRadius: 8, background: '#EEF3FD', color: '#2453C4', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v4" /><path d="M12 17v4" /><path d="M3 12h4" /><path d="M17 12h4" /><path d="M12 8l1.5 2.5L16 12l-2.5 1.5L12 16l-1.5-2.5L8 12l2.5-1.5z" /></svg>
            </span>
            <strong style={{ fontSize: 15 }}>作業のお手伝い</strong>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#5A6270' }}>{context}</span>
          </div>
          <div style={{ background: '#F4F6FA', padding: '14px 16px', fontSize: 13, whiteSpace: 'pre-line' }}>{message}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px 10px' }}>
            {list.map((it) => (
              <button key={it.no} type="button" style={{ font: 'inherit', display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', border: '1px solid #E1E4EA', borderRadius: 12, background: '#FFFFFF', padding: '12px 14px', cursor: 'pointer', color: '#1F2430', minHeight: 52 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#2453C4', background: '#EEF3FD', borderRadius: 6, padding: '2px 7px' }}>{it.no}</span>
                <span style={{ fontSize: 14, fontWeight: 700, flex: '1 1 auto' }}>{it.label}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A919C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            ))}
          </div>
          <div style={{ padding: '4px 16px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #CBD1DA', borderRadius: 12, padding: '6px 6px 6px 12px' }}>
              <label htmlFor="petMemo" className="sr">メモや直してほしいこと</label>
              <input id="petMemo" type="text" placeholder="メモや修正内容を入力…" style={{ flex: '1 1 auto', minWidth: 0, border: 0, outline: 'none', font: 'inherit', fontSize: 13, color: '#1F2430', background: 'transparent', minHeight: 32 }} />
              <button type="button" aria-label="送る" style={{ flex: '0 0 auto', width: 34, height: 34, borderRadius: 8, border: 0, background: '#2453C4', color: '#FFFFFF', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8-13 8z" /></svg>
              </button>
            </div>
          </div>
          <div style={{ padding: '8px 16px 14px', fontSize: 11, color: '#5A6270' }}>＊ペットは決まったメニューを案内します</div>
        </div>
      )}
      <button type="button" aria-label={open ? '作業のお手伝いを閉じる' : '作業のお手伝いを開く'} aria-expanded={open} onClick={() => setOpen(!open)} style={{ width: 84, height: 84, borderRadius: 22, background: '#FFFFFF', border: '1px solid #E1E4EA', boxShadow: '0 8px 24px rgba(20,24,32,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
        <svg width="60" height="60" viewBox="0 0 64 64" aria-hidden="true"><path d="M12 27 L14 8 L26 18 Q32 16 38 18 L50 8 L52 27 Q56 35 52 44 Q46 56 32 56 Q18 56 12 44 Q8 35 12 27 Z" fill="#FFFFFF" stroke="#2F5FD0" strokeWidth="2.6" strokeLinejoin="round" /><path d="M16.5 14 L18 22 L23 18 Z" fill="#DCE7FB" /><path d="M47.5 14 L46 22 L41 18 Z" fill="#DCE7FB" /><ellipse cx="24" cy="34" rx="2.6" ry="3.4" fill="#1F2430" /><ellipse cx="40" cy="34" rx="2.6" ry="3.4" fill="#1F2430" /><path d="M30 40 L34 40 L32 42.5 Z" fill="#E97C93" /><path d="M27 45 Q29.5 47.5 32 45 Q34.5 47.5 37 45" fill="none" stroke="#1F2430" strokeWidth="1.8" strokeLinecap="round" /><ellipse cx="18.5" cy="42" rx="3.5" ry="2" fill="#F9CDD6" /><ellipse cx="45.5" cy="42" rx="3.5" ry="2" fill="#F9CDD6" /></svg>
      </button>
    </div>
  )
}
