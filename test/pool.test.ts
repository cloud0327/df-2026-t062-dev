import test from 'node:test'
import assert from 'node:assert/strict'
import { closePool, createPool } from '../db/pool.ts'

test('DATABASE_URL pool closes without a Cloud SQL connector', async () => {
  const db = await createPool({ DATABASE_URL: 'postgres://localhost:5432/careman' })
  await closePool(db)
  await closePool(db)
})

test('Cloud SQL pool closes its connector once, including concurrent close calls', async () => {
  let closes = 0
  const db = await createPool({ CLOUD_SQL_INSTANCE: 'project:region:instance', DB_USER: 'runtime' }, async () => ({
    authType: 'IAM',
    ipType: 'PUBLIC',
    connector: {
      getOptions: async () => ({}),
      close: () => { closes += 1 },
    },
  }))

  await Promise.all([closePool(db), closePool(db)])
  assert.equal(closes, 1)
})

test('connector closes when option creation fails', async () => {
  let closes = 0
  await assert.rejects(createPool({ CLOUD_SQL_INSTANCE: 'project:region:instance' }, async () => ({
    authType: 'IAM',
    ipType: 'PUBLIC',
    connector: {
      getOptions: async () => { throw new Error('connector setup failed') },
      close: () => { closes += 1 },
    },
  })), /connector setup failed/)
  assert.equal(closes, 1)
})
