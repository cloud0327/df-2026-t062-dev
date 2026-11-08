// ファイルの置き場（録音・PDF・作業用）。
//   STORAGE_MODE=gcs: Cloud Storage。録音は api を通さず、ブラウザから再開できる送信（resumable upload）で直接入れる
//   STORAGE_MODE=local（既定）: .data/storage の下。送信は api の /api/dev-upload が同じ約束（Content-Range と 308）で受ける
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, writeFile, appendFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export type Bucket = 'source' | 'output' | 'work'

export interface Storage {
  /** ブラウザが直接送るための、再開できる送信の URL */
  createUploadSession(bucket: Bucket, path: string, mime: string, origin: string | undefined): Promise<string>
  /** 置いてあればバイト数 */
  size(bucket: Bucket, path: string): Promise<number | null>
  read(bucket: Bucket, path: string): Promise<Uint8Array>
  write(bucket: Bucket, path: string, data: Uint8Array, mime: string): Promise<void>
  /** STT などに渡す場所（gs://… か、ローカルのファイルの場所） */
  uri(bucket: Bucket, path: string): string
}

export class GcsStorage implements Storage {
  private names: Record<Bucket, string>
  private client: Promise<import('@google-cloud/storage').Storage> | undefined

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const need = (k: string) => {
      const v = env[k]
      if (!v) throw new Error(`${k} を設定してください`)
      return v
    }
    this.names = { source: need('GCS_SOURCE_BUCKET'), output: need('GCS_OUTPUT_BUCKET'), work: need('GCS_WORK_BUCKET') }
  }

  private async bucket(b: Bucket) {
    this.client ??= import('@google-cloud/storage').then((m) => new m.Storage())
    return (await this.client).bucket(this.names[b])
  }

  async createUploadSession(bucket: Bucket, path: string, mime: string, origin: string | undefined) {
    const file = (await this.bucket(bucket)).file(path)
    // Origin を渡しておかないと、ブラウザからの PUT が CORS で止まる
    const [url] = await file.createResumableUpload({ metadata: { contentType: mime }, origin })
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

  uri(bucket: Bucket, path: string) {
    return `gs://${this.names[bucket]}/${path}`
  }
}

/** ローカルの置き場。送信の URL は api の /api/dev-upload/<token> */
export class LocalStorage implements Storage {
  readonly root: string
  private apiOrigin: string
  private sessions = new Map<string, { bucket: Bucket, path: string, total?: number }>()

  constructor(root = process.env.LOCAL_STORAGE_DIR ?? '.data/storage', apiOrigin = process.env.PUBLIC_API_ORIGIN ?? '') {
    this.root = resolve(root)
    this.apiOrigin = apiOrigin
  }

  private file(bucket: Bucket, path: string) {
    if (path.includes('..')) throw new Error('bad path')
    return join(this.root, bucket, path)
  }

  async createUploadSession(bucket: Bucket, path: string) {
    const token = createHash('sha256').update(randomUUID()).digest('hex').slice(0, 32)
    this.sessions.set(token, { bucket, path })
    await mkdir(dirname(this.file(bucket, path)), { recursive: true })
    await writeFile(this.file(bucket, path), new Uint8Array())
    return `${this.apiOrigin}/api/dev-upload/${token}`
  }

  /** /api/dev-upload が呼ぶ。GCS と同じく、途中なら 308 と Range、送り終われば 200 */
  async receive(token: string, contentRange: string | undefined, chunk: Uint8Array): Promise<{ status: 200 | 308 | 404 | 400, range?: string }> {
    const s = this.sessions.get(token)
    if (!s) return { status: 404 }
    const file = this.file(s.bucket, s.path)
    const current = (await stat(file)).size
    const m = contentRange ? /^bytes (?:(\d+)-(\d+)|\*)\/(\d+|\*)$/.exec(contentRange) : null
    if (contentRange && !m) return { status: 400 }
    if (m && m[1] !== undefined) {
      const start = Number(m[1])
      if (start !== current) return { status: 308, range: current ? `bytes=0-${current - 1}` : undefined }
      await appendFile(file, chunk)
    } else if (!contentRange) {
      await appendFile(file, chunk)
    }
    const size = (await stat(file)).size
    const total = m && m[3] !== '*' ? Number(m[3]) : contentRange ? undefined : size
    if (total !== undefined && size >= total) {
      this.sessions.delete(token)
      return { status: 200 }
    }
    return { status: 308, range: size ? `bytes=0-${size - 1}` : undefined }
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

  uri(bucket: Bucket, path: string) {
    return this.file(bucket, path)
  }
}

export function defaultStorage(env: NodeJS.ProcessEnv = process.env): Storage {
  return env.STORAGE_MODE === 'gcs' ? new GcsStorage(env) : new LocalStorage()
}
