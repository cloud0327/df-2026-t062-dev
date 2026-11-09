import assert from 'node:assert/strict'
import { test } from 'node:test'
import { activeJobs } from '../db/repo.ts'
import { incompleteFieldNames } from '../src/lib/jobStatus.ts'
import { incompleteFieldKeys, prepareWriterValues } from '../worker/job-values.ts'

test('未反映の欄キーを重複なく項目名にする', () => {
  const names = incompleteFieldNames(['person.lifeHistory', 'person.lifeHistory', 'unknown.field'])
  assert.equal(names.length, 2)
  assert.ok(names.includes('生活歴') || names.some((name) => name === 'これまでの生活' || name.includes('生活')))
  assert.ok(names.includes('unknown.field'))
})

test('形式不一致の値を落とし、どの欄かをキーで返す', () => {
  const result = prepareWriterValues({
    'intake.method': { value: '選択肢にない値' },
    'person.lifeHistory': { value: '面談で確認した内容' },
  })
  assert.deepEqual(result.droppedFields, ['intake.method'])
  assert.deepEqual(Object.keys(result.proposed), ['person.lifeHistory'])
})

test('AI が書けなかった欄と形式不一致の欄をまとめる', () => {
  assert.deepEqual(incompleteFieldKeys(['person.lifeHistory', 'person.address'], ['person.address', 'intake.method']), [
    'person.lifeHistory', 'person.address', 'intake.method',
  ])
})

test('ジョブ API は保存された未反映欄キーをフロントに返す', async () => {
  const db = {
    async query() {
      return { rows: [{
        id: 'job-1', status: 'partial', step: 'done', eta_seconds: null,
        created_at: new Date('2026-11-10T00:00:00Z'), updated_at: new Date('2026-11-10T00:01:00Z'),
        incomplete_fields: ['person.lifeHistory', 'intake.method', 'person.lifeHistory'], n: 1, k: 0,
      }] }
    },
  } as unknown as Parameters<typeof activeJobs>[0]
  const jobs = await activeJobs(db, 'office-1', 'client-1')
  assert.deepEqual(jobs[0].incompleteFields, ['person.lifeHistory', 'intake.method'])
})
