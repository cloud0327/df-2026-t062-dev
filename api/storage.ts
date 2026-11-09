// ファイルの置き場（録音・PDF・作業用・様式）。
//   STORAGE_MODE=gcs: Cloud Storage。録音は api を通さず、ブラウザから再開できる送信（resumable upload）で直接入れる
//   STORAGE_MODE=local（既定）: .data/storage の下。送信は api の /api/dev-upload が同じ約束（Content-Range と 308）で受ける
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, stat, writeFile, appendFile, link, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** forms は様式の元の PDF とページの画像（非公開。上書きしない。画面には期限つきの URL で渡す） */
export type Bucket = 'source' | 'output' | 'work' | 'forms'

/** 期限つきの URL が使える間。同じ間なら同じ URL になるので、ブラウザが画像を覚えておける */
export interface UrlWindow { from: Date, until: Date }

const DAY = 24 * 60 * 60 * 1000
/** 24 時間の区切り（UTC の 0 時）から 48 時間。日をまたいでも、開いている画面の URL は切れない */
export function dailyWindow(now = Date.now()): UrlWindow {
  const from = Math.floor(now / DAY) * DAY
  return { from: new Date(from), until: new Date(from + 2 * DAY) }
}

/** 様式の置き場に、別の中身の同じ名前のファイルを置こうとした */
export class AlreadyExists extends Error {}

export interface Storage {
  /** ブラウザが直接送るための、再開できる送信の URL */
  createUploadSession(bucket: Bucket, path: string, mime: string, origin: string | undefined): Promise<string>
  /** 置いてあればバイト数 */
  size(bucket: Bucket, path: string): Promise<number | null>
  read(bucket: Bucket, path: string): Promise<Uint8Array>
  write(bucket: Bucket, path: string, data: Uint8Array, mime: string): Promise<void>
  /** 置いていなければ置く。同じ中身ならそのまま（same）。別の中身があれば AlreadyExists（様式の置き場は上書きしない） */
  writeOnce(bucket: Bucket, path: string, data: Uint8Array, mime: string, cacheControl?: string): Promise<'written' | 'same'>
  /** 読むための期限つきの URL */
  signedReadUrl(bucket: Bucket, path: string, window: UrlWindow): Promise<string>
  /** STT などに渡す場所（gs://… か、ローカルのファイルの場所） */
  uri(bucket: Bucket, path: string): string
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && createHash('sha256').update(a).digest('hex') === createHash('sha256').update(b).digest('hex')

export class GcsStorage implements Storage {
  private names: Record<Bucket, string | undefined>
  private client: Promise<import('@google-cloud/storage').Storage> | undefined

  constructor(env: NodeJS.ProcessEnv = process.env) {
    // 置き場の名前は使うときに確かめる（様式の置き場は api と管理者の forms:assets だけが使い、worker には設定しない）
    this.names = { source: env.GCS_SOURCE_BUCKET, output: env.GCS_OUTPUT_BUCKET, work: env.GCS_WORK_BUCKET, forms: env.GCS_FORMS_BUCKET }
  }

  private async bucket(b: Bucket) {
    const name = this.names[b]
    if (!name) throw new Error(`置き場 ${b} が設定されていません（GCS_${b.toUpperCase()}_BUCKET）`)
    this.client ??= import('@google-cloud/storage').then((m) => new m.Storage())
    return (await this.client).bucket(name)
  }

  async createUploadSession(bucket: Bucket, path: string, mime: string, origin: string | undefined) {
    const file = (await this.bucket(bucket)).file(path)
    // Origin を渡しておかないと、ブラウザからの PUT が CORS で止まる
    const [url] = await file.createResumableUpload({ metadata: { contentType: mime }, origin, preconditionOpts: { ifGenerationMatch: 0 } })
    return url
  }

  async size(bucket: Bucket, path: string) {
    const file = (await this.bucket(bucket)).file(path)
    const [exists] = await file.exists()
    if (!exists) return null
    const [meta] = await file.getMetadata()
    return Number(meta.size ?? 0)
  }

  async read(bucket: Bucket, path: string) {
    const [buf] = await (await this.bucket(bucket)).file(path).download()
    return new Uint8Array(buf)
  }

  async write(bucket: Bucket, path: string, data: Uint8Array, mime: string) {
    await (await this.bucket(bucket)).file(path).save(Buffer.from(data), { contentType: mime, resumable: false })
  }

  async writeOnce(bucket: Bucket, path: string, data: Uint8Array, mime: string, cacheControl?: string): Promise<'written' | 'same'> {
    const file = (await this.bucket(bucket)).file(path)
    try {
      // 置いていないときだけ置く（ifGenerationMatch: 0）
      await file.save(Buffer.from(data), { resumable: false, metadata: { contentType: mime, cacheControl }, preconditionOpts: { ifGenerationMatch: 0 } })
      return 'written'
    } catch (e) {
      if ((e as { code?: number }).code !== 412) throw e
      if (sameBytes(await this.read(bucket, path), data)) return 'same'
      throw new AlreadyExists(path)
    }
  }

  async signedReadUrl(bucket: Bucket, path: string, window: UrlWindow) {
    // accessibleAt を区切りにそろえると、同じ間は同じ URL になる（V4 の署名の日時が区切りになる）
    const [url] = await (await this.bucket(bucket)).file(path).getSignedUrl({ version: 'v4', action: 'read', accessibleAt: window.from, expires: window.until })
    return url
  }

  uri(bucket: Bucket, path: string) {
    return `gs://${this.names[bucket]}/${path}`
  }
}

/** ローカルの置き場。送信の URL は api の /api/dev-upload/<token>、期限つきの URL は api の /api/dev-files/<置き場>/<場所> */
export class LocalStorage implements Storage {
  readonly root: string
  private apiOrigin: string
  private sessions = new Map<string, { file: string, partial: string, tail: Promise<void> }>()
  private secret: Buffer

  constructor(root = process.env.LOCAL_STORAGE_DIR ?? '.data/storage', apiOrigin = process.env.PUBLIC_API_ORIGIN ?? '') {
    this.root = resolve(root)
    this.apiOrigin = apiOrigin
    this.secret = process.env.LOCAL_SIGNING_SECRET ? Buffer.from(process.env.LOCAL_SIGNING_SECRET) : randomBytes(32)
  }

  private sign(bucket: Bucket, path: string, from: number, until: number) {
    return createHmac('sha256', this.secret).update(`${bucket}\n${path}\n${from}\n${until}`).digest('hex')
  }

  /** /api/dev-files が呼ぶ。署名が合っていて、期限の中なら、置き場のファイルの中身 */
  async readSigned(bucket: Bucket, path: string, q: { from?: string, until?: string, sig?: string }, now = Date.now()): Promise<Uint8Array | null> {
    const from = Number(q.from)
    const until = Number(q.until)
    if (!q.sig || !Number.isFinite(from) || !Number.isFinite(until) || now < from * 1000 || now > until * 1000) return null
    const want = Buffer.from(this.sign(bucket, path, from, until))
    const got = Buffer.from(q.sig)
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null
    return this.read(bucket, path).catch(() => null)
  }

  private file(bucket: Bucket, path: string) {
    if (path.includes('..')) throw new Error('bad path')
    return join(this.root, bucket, path)
  }

  async createUploadSession(bucket: Bucket, path: string) {
    const token = randomUUID().replaceAll('-', '')
    const file = this.file(bucket, path)
    const partial = `${file}.${token}.part`
    await mkdir(dirname(file), { recursive: true })
    await writeFile(partial, new Uint8Array())
    this.sessions.set(token, { file, partial, tail: Promise.resolve() })
    return `${this.apiOrigin}/api/dev-upload/${token}`
  }

  /** /api/dev-upload が呼ぶ。完了したファイルだけを、上書きせずに公開する。 */
  async receive(token: string, contentRange: string | undefined, chunk: Uint8Array): Promise<{ status: 200 | 308 | 404 | 400, range?: string }> {
    const session = this.sessions.get(token)
    if (!session) return { status: 404 }
    const result = session.tail.then(async () => {
      if (!this.sessions.has(token)) return { status: 200 } as const
      const current = (await stat(session.partial)).size
      const range = contentRange ? /^bytes (?:(\d+)-(\d+)|\*)\/(\d+|\*)$/.exec(contentRange) : null
      if (contentRange && !range) return { status: 400 } as const
      const total = range && range[3] !== '*' ? Number(range[3]) : contentRange ? undefined : current + chunk.length
      if (range?.[1] !== undefined) {
        const start = Number(range[1]), end = Number(range[2])
        if (end - start + 1 !== chunk.length || (total !== undefined && end >= total)) return { status: 400 } as const
        if (start !== current) return { status: 308, range: current ? `bytes=0-${current - 1}` : undefined } as const
      }
      const writing = !contentRange || range?.[1] !== undefined
      if (writing) await appendFile(session.partial, chunk)
      const size = current + (writing ? chunk.length : 0)
      if (total !== undefined && size === total && size > 0) {
        try {
          await link(session.partial, session.file)
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
        }
        this.sessions.delete(token)
        await unlink(session.partial).catch(() => {})
        return { status: 200 } as const
      }
      return { status: 308, range: size ? `bytes=0-${size - 1}` : undefined } as const
    })
    session.tail = result.then(() => {}, () => {})
    return result
  }

  async size(bucket: Bucket, path: string) {
    try {
      return (await stat(this.file(bucket, path))).size
    } catch {
      return null
    }
  }

  async read(bucket: Bucket, path: string) {
    return new Uint8Array(await readFile(this.file(bucket, path)))
  }

  async write(bucket: Bucket, path: string, data: Uint8Array) {
    await mkdir(dirname(this.file(bucket, path)), { recursive: true })
    await writeFile(this.file(bucket, path), data)
  }

  async writeOnce(bucket: Bucket, path: string, data: Uint8Array, _mime?: string, _cacheControl?: string): Promise<'written' | 'same'> {
    const cur = await this.read(bucket, path).catch(() => null)
    if (cur) {
      if (sameBytes(cur, data)) return 'same'
      throw new AlreadyExists(path)
    }
    await this.write(bucket, path, data)
    return 'written'
  }

  async signedReadUrl(bucket: Bucket, path: string, window: UrlWindow) {
    const from = Math.floor(window.from.getTime() / 1000)
    const until = Math.floor(window.until.getTime() / 1000)
    const q = new URLSearchParams({ from: String(from), until: String(until), sig: this.sign(bucket, path, from, until) })
    return `${this.apiOrigin}/api/dev-files/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}?${q}`
  }

  uri(bucket: Bucket, path: string) {
    return this.file(bucket, path)
  }
}

export function defaultStorage(env: NodeJS.ProcessEnv = process.env): Storage {
  return env.STORAGE_MODE === 'gcs' ? new GcsStorage(env) : new LocalStorage()
}
