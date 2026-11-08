// ログインの確かめ（Identity Platform / Firebase Authentication の ID トークン）。
//   AUTH_MODE=firebase（既定）: firebase-admin で ID トークンを確かめる。FIREBASE_AUTH_EMULATOR_HOST があればエミュレータ
//   AUTH_MODE=dev: 「dev:<メール>」をトークンとして受け付ける（ローカルとテストだけ。本番では使わない）
export interface AuthUser {
  uid: string
  email?: string
}

export interface Verifier {
  verify(token: string): Promise<AuthUser | null>
}

export class DevVerifier implements Verifier {
  async verify(token: string): Promise<AuthUser | null> {
    if (!token.startsWith('dev:')) return null
    const email = token.slice(4).trim()
    return email ? { uid: `dev:${email}`, email } : null
  }
}

export class FirebaseVerifier implements Verifier {
  private auth: Promise<{ verifyIdToken(t: string): Promise<{ uid: string, email?: string }> }> | undefined

  private get() {
    this.auth ??= (async () => {
      const { initializeApp, getApps } = await import('firebase-admin/app')
      const { getAuth } = await import('firebase-admin/auth')
      const app = getApps()[0] ?? initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT })
      return getAuth(app)
    })()
    return this.auth
  }

  async verify(token: string): Promise<AuthUser | null> {
    try {
      const d = await (await this.get()).verifyIdToken(token)
      return { uid: d.uid, email: d.email }
    } catch {
      return null
    }
  }
}

export function defaultVerifier(env: NodeJS.ProcessEnv = process.env): Verifier {
  if (env.AUTH_MODE === 'dev') {
    if (env.NODE_ENV === 'production' && env.ALLOW_DEV_AUTH !== 'true') throw new Error('AUTH_MODE=dev は本番では使えません')
    return new DevVerifier()
  }
  return new FirebaseVerifier()
}
