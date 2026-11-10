import { useCallback, useEffect, useState } from 'react'
import { AuthProvider, useAuth } from './lib/auth.tsx'
import { api, ApiError, setTokenSource, type Staff } from './lib/api.ts'
import { useDevice, useRoute } from './lib/router.tsx'
import { Login } from './pages/Login.tsx'
import { PcList } from './pages/PcList.tsx'
import { PcWork } from './pages/PcWork.tsx'
import { PadList } from './pages/PadList.tsx'
import { PadWork } from './pages/PadWork.tsx'

function Shell() {
  const auth = useAuth()
  const route = useRoute()
  const device = useDevice()
  const [staff, setStaff] = useState<Staff | null>(null)
  const [denied, setDenied] = useState(false)
  /** /api/me が 401/403 以外で失敗したときの見える化（もう一度で取り直す） */
  const [meError, setMeError] = useState('')
  const [trying, setTrying] = useState(false)

  useEffect(() => { setTokenSource(auth.token) }, [auth.token])
  const loadMe = useCallback(async () => {
    setStaff(null)
    setDenied(false)
    if (!auth.signedIn) { setMeError(''); return }
    setTrying(true)
    try {
      const r = await api.me()
      setStaff(r.staff)
      setMeError('')
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setDenied(true)
      else setMeError(String((e as Error).message))
    } finally {
      setTrying(false)
    }
  }, [auth.signedIn, auth.email])
  useEffect(() => { void loadMe() }, [loadMe])

  if (!auth.ready) return null
  if (!auth.signedIn) return <Login />
  if (denied) {
    return (
      <div className="pc" style={{ padding: 40, fontFamily: "'Noto Sans JP',sans-serif" }}>
        <p>このアカウントは、どの事業所にも登録されていません。事業所の管理者に確かめてください。</p>
        <button type="button" className="btn" onClick={() => void auth.signOut()}>別のアカウントで入る</button>
      </div>
    )
  }
  if (meError && !staff) {
    return (
      <div className="pc" style={{ padding: 40, fontFamily: "'Noto Sans JP',sans-serif" }}>
        <p role="alert" style={{ margin: 0, color: '#A3261C', fontWeight: 600 }}>開けませんでした（{meError}）。少し待ってから、もう一度。</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button type="button" className="btn btn-p" disabled={trying} onClick={() => void loadMe()}>{trying ? '確かめています…' : 'もう一度'}</button>
          <button type="button" className="btn" disabled={trying} onClick={() => void auth.signOut()}>別のアカウントで入る</button>
        </div>
      </div>
    )
  }
  if (!staff) return null
  if (route.name === 'client') return device === 'pad' ? <PadWork clientId={route.id} /> : <PcWork key={route.id} clientId={route.id} staffName={staff.name} />
  return device === 'pad' ? <PadList staffName={staff.name} /> : <PcList staffName={staff.name} />
}

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  )
}
