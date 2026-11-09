// ログイン。本番は Identity Platform（Firebase Authentication）のメールとパスワード。
// Firebase の設定は Hosting の /__/firebase/init.json から読む（ビルドに秘密を入れない）。
// それが読めないローカルの開発では、メールだけで入る仮のログイン（api 側も AUTH_MODE=dev のときだけ受け付ける）。
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

type Mode = 'loading' | 'firebase' | 'dev'

interface AuthState {
  mode: Mode
  ready: boolean
  signedIn: boolean
  email: string | null
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  token(): Promise<string | null>
}

const Ctx = createContext<AuthState | null>(null)
const DEV_KEY = 'careman.devEmail'

interface FirebaseBits {
  auth: import('firebase/auth').Auth
  mod: typeof import('firebase/auth')
}

let firebase: Promise<FirebaseBits | null> | undefined

function loadFirebase(): Promise<FirebaseBits | null> {
  firebase ??= (async () => {
    try {
      const r = await fetch('/__/firebase/init.json', { cache: 'no-store' })
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null
      const config = await r.json()
      const [{ initializeApp }, mod] = await Promise.all([import('firebase/app'), import('firebase/auth')])
      const app = initializeApp(config)
      return { auth: mod.getAuth(app), mod }
    } catch {
      return null
    }
  })()
  return firebase
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>('loading')
  const [email, setEmail] = useState<string | null>(null)
  const [fb, setFb] = useState<FirebaseBits | null>(null)

  useEffect(() => {
    let off = () => {}
    loadFirebase().then((bits) => {
      if (!bits) {
        setMode('dev')
        try { setEmail(localStorage.getItem(DEV_KEY)) } catch { /* 使えない */ }
        return
      }
      setFb(bits)
      setMode('firebase')
      off = bits.mod.onIdTokenChanged(bits.auth, (u) => setEmail(u?.email ?? null))
    })
    return () => off()
  }, [])

  const value = useMemo<AuthState>(() => ({
    mode,
    ready: mode !== 'loading',
    signedIn: !!email,
    email,
    async signIn(e, password) {
      if (mode === 'firebase' && fb) {
        await fb.mod.signInWithEmailAndPassword(fb.auth, e, password)
      } else {
        try { localStorage.setItem(DEV_KEY, e) } catch { /* 使えない */ }
        setEmail(e)
      }
    },
    async signOut() {
      if (mode === 'firebase' && fb) await fb.mod.signOut(fb.auth)
      else try { localStorage.removeItem(DEV_KEY) } catch { /* 使えない */ }
      setEmail(null)
    },
    async token() {
      if (mode === 'firebase' && fb) return (await fb.auth.currentUser?.getIdToken()) ?? null
      return email ? `dev:${email}` : null
    },
  }), [mode, email, fb])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('AuthProvider の外です')
  return v
}
