import assert from 'node:assert/strict'
import { test } from 'node:test'
import { COMING_SOON_LABEL, newDocMenu } from '../src/lib/docMenu.ts'

test('未対応の書類は「後日公開」として押せない項目にする', () => {
  assert.equal(COMING_SOON_LABEL, '後日公開')
  assert.deepEqual(newDocMenu.map((d) => d.label), ['モニタリング', 'デイの体験用紙'])
  for (const d of newDocMenu) assert.equal(d.available, false)
})
