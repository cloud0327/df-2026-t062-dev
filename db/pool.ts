// PostgreSQL への接続。
//   ローカル・CI: DATABASE_URL（例 postgres://localhost:54329/careman）
//   Cloud Run: CLOUD_SQL_INSTANCE（project:region:instance）と DB_USER（IAM のユーザー）。パスワードは持たない
// DB_SCHEMA を付けると、そのスキーマだけを使う（テストでファイルごとに分けるため）。
import pg from 'pg'

export type Db = pg.Pool
export type Tx = pg.PoolClient

let shared: Promise<Db> | undefined

export async function createPool(env: NodeJS.ProcessEnv = process.env): Promise<Db> {
  const schema = env.DB_SCHEMA
  const options = schema ? `-c search_path=${schema},public` : undefined
  if (env.DATABASE_URL) {
    return new pg.Pool({ connectionString: env.DATABASE_URL, max: Number(env.DB_POOL_MAX ?? 5), options })
  }
  if (env.CLOUD_SQL_INSTANCE) {
    const { Connector, AuthTypes, IpAddressTypes } = await import('@google-cloud/cloud-sql-connector')
    const connector = new Connector()
    const clientOpts = await connector.getOptions({
      instanceConnectionName: env.CLOUD_SQL_INSTANCE,
      authType: AuthTypes.IAM,
      ipType: IpAddressTypes.PUBLIC,
    })
    return new pg.Pool({ ...clientOpts, user: env.DB_USER, database: env.DB_NAME ?? 'careman', max: Number(env.DB_POOL_MAX ?? 5), options })
  }
  throw new Error('DATABASE_URL か CLOUD_SQL_INSTANCE を設定してください')
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
