import assert from 'node:assert/strict'
import { test } from 'node:test'
import { failedTopicNames } from '../src/lib/jobStatus.ts'

test('部分失敗の内部番号を、重複のない項目名にして表示する', () => {
  const names = failedTopicNames(['3', 'check:3', 'check:0'])
  assert.equal(names.length, 2)
  assert.ok(names.every((name) => name && name !== '項目不明'))
})
