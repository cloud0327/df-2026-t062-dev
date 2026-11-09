// db/migrations/*.sql を名前の順に流す（流したものは schema_migrations に残す）。
//   npm run db:migrate
//   node db/migrate.ts --forms  … あわせて forms/seed の様式を登録する（リリースの移行の段。中身が同じなら何もしない）
// 同時に 2 つ走らないように advisory lock を取る。移行は足すだけにする（戻せるように）。
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createPool, type Db } from './pool.ts'

const DIR = new URL('./migrations/', import.meta.url)

export async function migrate(db: Db, log: (m: string) => void = () => {}): Promise<string[]> {
  const c = await db.connect()
  const applied: string[] = []
  try {
    await c.query('SELECT pg_advisory_lock(727001)')
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    const done = new Set((await c.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name))
    for (const name of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(name)) continue
      const sql = readFileSync(new URL(name, DIR), 'utf8')
      await c.query('BEGIN')
      try {
        await c.query(sql)
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name])
        await c.query('COMMIT')
      } catch (e) {
        await c.query('ROLLBACK')
        throw e
      }
      applied.push(name)
      log(`移行を流しました: ${name}`)
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock(727001)').catch(() => {})
    c.release()
  }
  return applied
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = await createPool()
  if (process.env.DB_SCHEMA) await db.query(`CREATE SCHEMA IF NOT EXISTS ${process.env.DB_SCHEMA}`)
  const applied = await migrate(db, console.log)
  if (!applied.length) console.log('新しい移行はありません')
  if (process.argv.includes('--forms')) {
    const { seedForms } = await import('../forms/admin/seed.ts')
    for (const [kind, r] of Object.entries(await seedForms(db))) {
      const note = !r.created ? '（変わっていません）' : r.version > 1 ? '（新しい版。前の版を指す書類は npm run forms:rebase で移す）' : '（登録しました）'
      console.log(`様式 ${kind}: v${r.version}${note}`)
    }
  }
  await db.end()
}
