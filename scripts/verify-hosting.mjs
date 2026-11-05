import assert from 'node:assert/strict'
import { setTimeout } from 'node:timers/promises'

const [origin, expectedSha] = process.argv.slice(2)
assert.ok(origin && expectedSha, 'Usage: node scripts/verify-hosting.mjs URL SHA')

async function get(path) {
  const response = await fetch(new URL(path, origin), {
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  })
  assert.equal(response.status, 200, path)
  return response
}

async function verify() {
  const [index, health, version] = await Promise.all([
    get('/'),
    get('/api/health.json'),
    get('/version.json'),
  ])
  assert.match(await index.text(), /data-app="df-2026-t062"/)
  assert.deepEqual(await health.json(), { status: 'ok', source: 'mock' })
  assert.deepEqual(await version.json(), { sha: expectedSha })
}

for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    await verify()
    console.log(`Verified ${origin} at ${expectedSha}`)
    break
  } catch (error) {
    if (attempt === 5) throw error
    console.warn(`Check ${attempt} failed: ${error.message}`)
    await setTimeout(5000)
  }
}
