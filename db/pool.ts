// PostgreSQL への接続。
//   ローカル・CI: DATABASE_URL（例 postgres://localhost:54329/careman）
//   Cloud Run: CLOUD_SQL_INSTANCE（project:region:instance）と DB_USER（IAM のユーザー）。パスワードは持たない
// DB_SCHEMA を付けると、そのスキーマだけを使う（テストでファイルごとに分けるため）。
import pg from 'pg'

export type Db = pg.Pool
export type Tx = pg.PoolClient

let shared: Promise<Db> | undefined
const connectors = new WeakMap<Db, { close: () => void | Promise<void> }>()
const closing = new WeakMap<Db, Promise<void>>()

type ConnectorLike = {
  getOptions: (options: Record<string, unknown>) => Promise<pg.PoolConfig>
  close: () => void | Promise<void>
}
type ConnectorFactory = () => Promise<{ connector: ConnectorLike, authType: unknown, ipType: unknown }>

async function defaultConnectorFactory() {
  const { Connector, AuthTypes, IpAddressTypes } = await import('@google-cloud/cloud-sql-connector')
  return { connector: new Connector(), authType: AuthTypes.IAM, ipType: IpAddressTypes.PUBLIC }
}

export async function createPool(env: NodeJS.ProcessEnv = process.env, connectorFactory: ConnectorFactory = defaultConnectorFactory): Promise<Db> {
  const schema = env.DB_SCHEMA
  const options = schema ? `-c search_path=${schema},public` : undefined
  if (env.DATABASE_URL) {
    return new pg.Pool({ connectionString: env.DATABASE_URL, max: Number(env.DB_POOL_MAX ?? 5), options })
  }
  if (env.CLOUD_SQL_INSTANCE) {
    const { connector, authType, ipType } = await connectorFactory()
    try {
      const clientOpts = await connector.getOptions({
        instanceConnectionName: env.CLOUD_SQL_INSTANCE,
        authType,
        ipType,
      })
      const db = new pg.Pool({ ...clientOpts, user: env.DB_USER, database: env.DB_NAME ?? 'careman', max: Number(env.DB_POOL_MAX ?? 5), options })
      connectors.set(db, connector)
      return db
    } catch (error) {
      await connector.close()
      throw error
    }
  }
  throw new Error('DATABASE_URL か CLOUD_SQL_INSTANCE を設定してください')
}

/** Close the pool and the Cloud SQL connector created for it, if any. Safe to call repeatedly. */
export function closePool(db: Db): Promise<void> {
  const existing = closing.get(db)
  if (existing) return existing
  const promise = (async () => {
    try {
      await db.end()
    } finally {
      await connectors.get(db)?.close()
      connectors.delete(db)
    }
  })()
  closing.set(db, promise)
  return promise
}

/** プロセスで 1 つの接続の束（最初に使うときに作る。health では作らない） */
export function getDb(): Promise<Db> {
  shared ??= createPool()
  return shared
}

export async function tx<T>(db: Db, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await db.connect()
  try {
    await c.query('BEGIN')
    const out = await fn(c)
    await c.query('COMMIT')
    return out
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}
