import { useEffect, useState } from 'react'
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

  useEffect(() => { setTokenSource(auth.token) }, [auth.token])
  useEffect(() => {
    setStaff(null)
    setDenied(false)
    if (!auth.signedIn) return
    api.me().then((r) => setStaff(r.staff)).catch((e) => {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setDenied(true)
    })
  }, [auth.signedIn, auth.email])

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
  if (!staff) return null
  if (route.name === 'client') return device === 'pad' ? <PadWork clientId={route.id} /> : <PcWork clientId={route.id} staffName={staff.name} />
  return device === 'pad' ? <PadList staffName={staff.name} /> : <PcList staffName={staff.name} />
}

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  )
}
