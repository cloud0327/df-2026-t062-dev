import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import { createApiServer } from '../api/server.ts'

const server = createApiServer()
let origin: string

before(async () => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  origin = `http://127.0.0.1:${address.port}`
})

after(async () => {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
})

test('returns the live API status as uncached JSON', async () => {
  const response = await fetch(`${origin}/api/health.json?check=1`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { status: 'ok', source: 'failure-probe' })
})

test('returns 404 for an unknown endpoint', async () => {
  const response = await fetch(`${origin}/api/other.json`)
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), { error: 'not_found' })
})

test('returns 405 and advertises GET for unsupported methods', async () => {
  const response = await fetch(`${origin}/api/health.json`, { method: 'POST' })
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'GET')
  assert.deepEqual(await response.json(), { error: 'method_not_allowed' })
})
