// ログイン（キャンバスにない画面なので、同じ色と部品で作った）。自分での登録はできない（事業所の管理者が作る）。
import { useState } from 'react'
import { useAuth } from '../lib/auth.tsx'
import { Logo } from '../components/Chrome.tsx'

export function Login() {
  const auth = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await auth.signIn(email.trim(), password)
    } catch (err: unknown) {
      const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined
      const isNetworkError = code === 'auth/network-request-failed' || code === 'auth/timeout'
      setError(isNetworkError
        ? 'つながらない。今日は一度止めてまた'
        : 'メールアドレスかパスワードが違います')
    } finally {
      setBusy(false)
    }
  }
  const field = { width: '100%', boxSizing: 'border-box' as const, font: 'inherit', fontSize: 15, padding: '10px 12px', border: '1px solid #CBD1DA', borderRadius: 8, background: '#FFFFFF', color: '#1F2430', minHeight: 44 }
  return (
    <div className="pc" style={{ minHeight: '100vh', background: '#F4F5F7', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '14vh 16px 40px', fontFamily: "'Noto Sans JP',system-ui,sans-serif", color: '#1F2430' }}>
      <form onSubmit={submit} style={{ width: 'min(400px, 100%)', background: '#FFFFFF', border: '1px solid #E1E4EA', borderRadius: 14, padding: '28px 26px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo size={36} />
          <div style={{ fontWeight: 700, fontSize: 17 }}>ケア書類アシスタント<span style={{ fontWeight: 400, color: '#5A6270', fontSize: 12, marginLeft: 4 }}>（仮）</span></div>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: '#5A6270' }}>メールアドレス
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} style={field} />
        </label>
        {auth.mode === 'firebase' ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: '#5A6270' }}>パスワード
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} style={field} />
          </label>
        ) : (
          <div style={{ fontSize: 12, color: '#5A6270', background: '#F4F6FA', borderRadius: 8, padding: '8px 10px' }}>開発用の画面です。登録してあるケアマネのメールアドレスだけで入れます（見本は kato@example.com）。</div>
        )}
        {error && <div role="alert" style={{ color: '#A3261C', fontSize: 13 }}>{error}</div>}
        <button type="submit" className="btn btn-p" disabled={busy} style={{ minHeight: 44, fontSize: 15 }}>ログイン</button>
      </form>
    </div>
  )
}
