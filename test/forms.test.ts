// 様式の版の登録・書き換えの禁止・書類の向き先の移し（PostgreSQL が要る。DATABASE_URL がなければ飛ばす）。
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { Db } from '../db/pool.ts'

const url = process.env.DATABASE_URL
const skip = url ? false : 'DATABASE_URL がないので飛ばします'
const schema = `t_forms_${process.pid}`
let db: Db

before(async () => {
  if (!url) return
  const { createPool } = await import('../db/pool.ts')
  const admin = await createPool({ DATABASE_URL: url })
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}`)
  await admin.end()
  db = await createPool({ DATABASE_URL: url, DB_SCHEMA: schema })
  const { migrate } = await import('../db/migrate.ts')
  await migrate(db)
})

after(async () => {
  if (!db) return
  await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
  await db.end()
})

test('forms:seed は、中身が同じなら新しい版を作らない。中身が変われば新しい版を使う版にし、前の版は retired', { skip }, async () => {
  const { seedForms } = await import('../forms/admin/seed.ts')
  const first = await seedForms(db)
  assert.deepEqual([first.assessment.version, first.assessment.created, first.assessment.published], [1, true, true])
  const again = await seedForms(db)
  assert.deepEqual([again.assessment.versionId, again.assessment.created], [first.assessment.versionId, false])

  const { registerVersion } = await import('../db/forms.ts')
  const { readSeed } = await import('../forms/admin/files.ts')
  const input = readSeed('admission')
  const changed = { ...input, pages: input.pages.map((p) => ({ ...p, title: `${p.title}（改）` })) }
  const v2 = await registerVersion(db, changed, { publish: true })
  assert.deepEqual([v2.version, v2.created, v2.published], [2, true, true])
  const rows = (await db.query("SELECT v.version, v.status FROM form_template_versions v JOIN form_templates t ON t.id = v.template_id WHERE t.kind = 'admission' ORDER BY v.version")).rows
  assert.deepEqual(rows.map((r) => `${r.version}:${r.status}`), ['1:retired', '2:published'])
})

test('対応の足りない版は登録できない', { skip }, async () => {
  const { registerVersion } = await import('../db/forms.ts')
  const { readSeed } = await import('../forms/admin/files.ts')
  const input = readSeed('admission')
  const rest = { ...input.bindings }
  delete rest['1_患者氏名']
  await assert.rejects(registerVersion(db, { ...input, bindings: rest }), /対応のない印字欄: 1_患者氏名/)
})

test('版の中身は書き換えられず、消せない（DB が止める）', { skip }, async () => {
  const v = (await db.query("SELECT id FROM form_template_versions WHERE status = 'published' LIMIT 1")).rows[0].id
  await assert.rejects(db.query("UPDATE form_template_versions SET pages = '[]' WHERE id = $1", [v]), /書き換えられません/)
  await assert.rejects(db.query('DELETE FROM form_template_versions WHERE id = $1', [v]), /消せません/)
  await assert.rejects(db.query("UPDATE form_template_versions SET status = 'draft' WHERE id = $1", [v]), /draft → published → retired/)
})

test('事業所の様式があれば、その事業所の新しい書類はそれを使う。ほかの事業所には見えない', { skip }, async () => {
  const forms = await import('../db/forms.ts')
  const { readSeed } = await import('../forms/admin/files.ts')
  const a = (await db.query("INSERT INTO offices (name) VALUES ('A') RETURNING id")).rows[0].id
  const b = (await db.query("INSERT INTO offices (name) VALUES ('B') RETURNING id")).rows[0].id
  const own = await forms.registerVersion(db, { ...readSeed('assessment'), officeId: a, name: 'A のアセスメント' }, { publish: true })
  assert.equal(await forms.publishedVersionId(db, a, 'assessment'), own.versionId)
  assert.notEqual(await forms.publishedVersionId(db, b, 'assessment'), own.versionId)
  await assert.rejects(forms.versionForOffice(db, b, own.versionId), forms.FormNotFound)
  assert.equal((await forms.versionForOffice(db, a, own.versionId)).name, 'A のアセスメント')
})

test('forms:rebase は、新しい版が古い版の読んでいた key を全部読むときだけ書類を移す', { skip }, async () => {
  const forms = await import('../db/forms.ts')
  const { readSeed } = await import('../forms/admin/files.ts')
  const office = (await db.query("INSERT INTO offices (name) VALUES ('C') RETURNING id")).rows[0].id
  const client = (await db.query('INSERT INTO clients (office_id, name) VALUES ($1, $2) RETURNING id', [office, 'テスト'])).rows[0].id
  const input = { ...readSeed('assessment'), officeId: office, name: 'C のアセスメント' }
  const v1 = await forms.registerVersion(db, input, { publish: true })
  const doc = (await db.query("INSERT INTO documents (office_id, client_id, kind, template_version_id) VALUES ($1,$2,'assessment',$3) RETURNING id", [office, client, v1.versionId])).rows[0].id
  const templateId = (await forms.loadVersion(db, v1.versionId)).templateId

  // 「その他の内容」の欄をなくした版（intake.methodOther を読まなくなる）は、移さない
  const { p1_受付方法_その他の内容: _drop, ...bindings } = input.bindings as Record<string, never>
  void _drop
  const schemas = input.schemas.map((page) => page.filter((s) => s.name !== 'p1_受付方法_その他の内容'))
  const v2 = await forms.registerVersion(db, { ...input, schemas, bindings }, { publish: true })
  const refused = await forms.rebaseDocuments(db, templateId)
  assert.deepEqual(refused.missingKeys, { v1: ['intake.methodOther'] })
  assert.equal((await db.query('SELECT template_version_id FROM documents WHERE id = $1', [doc])).rows[0].template_version_id, v1.versionId)

  // 欄を戻した版（v3）なら移す。移した記録を残す
  const v3 = await forms.registerVersion(db, { ...input, pages: input.pages.map((p) => ({ ...p, title: `${p.title} ` })) }, { publish: true })
  const dry = await forms.rebaseDocuments(db, templateId, { dryRun: true })
  assert.equal((await db.query('SELECT template_version_id FROM documents WHERE id = $1', [doc])).rows[0].template_version_id, v1.versionId)
  assert.deepEqual(dry.missingKeys, {})
  const moved = await forms.rebaseDocuments(db, templateId)
  assert.equal(moved.documents, 1)
  assert.equal((await db.query('SELECT template_version_id FROM documents WHERE id = $1', [doc])).rows[0].template_version_id, v3.versionId)
  const log = (await db.query("SELECT detail FROM audit_events WHERE office_id = $1 AND action = 'form.rebase'", [office])).rows[0].detail
  assert.equal(log.to.version, 3)
  void v2
})
