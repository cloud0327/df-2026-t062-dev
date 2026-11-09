// 見本のデータ（ローカルと demo 環境だけ。架空の人と、公開の演習シナリオの正解だけを入れる）。
//   npm run db:seed
//   甲斐さん  … 演習シナリオ（eval/scenario、公開）の 1 回目の正解を、AI の書き込み（未保存）として入れる
//   佐藤さん  … 何も入っていない新しい利用者
//   山田さん・田中さん … 架空の見本データ（forms/samples/見本_花子.json）を保存済みで入れる
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Db } from './pool.ts'
import { createPool } from './pool.ts'
import { applyBatch, createClient, saveDocument, staffByAuth, type Staff } from './repo.ts'

const load = (u: string) => {
  const raw = JSON.parse(readFileSync(new URL(u, import.meta.url), 'utf8'))
  delete raw._comment
  return raw as Record<string, unknown>
}

export interface SeedResult { officeId: string, staff: Staff, clients: Record<string, string> }

export async function seed(db: Db, opts: { email?: string, authUid?: string, officeName?: string } = {}): Promise<SeedResult> {
  const email = opts.email ?? 'kato@example.com'
  const authUid = opts.authUid ?? `dev:${email}`
  const office = (await db.query("INSERT INTO offices (name, phone, fax) VALUES ($1, '', '') RETURNING id", [opts.officeName ?? 'みほん居宅介護支援事業所'])).rows[0]
  await db.query("INSERT INTO staff (office_id, auth_uid, name, email) VALUES ($1,$2,'加藤',$3)", [office.id, authUid, email])
  const staff = (await staffByAuth(db, authUid))!
  const clients: Record<string, string> = {}

  const toProposed = (v: Record<string, unknown>) => Object.fromEntries(Object.entries(v).map(([k, value]) => [k, { value }]))
  const tomorrow = (h: number, plusDays = 1) => {
    const d = new Date()
    d.setDate(d.getDate() + plusDays)
    d.setHours(h, 0, 0, 0)
    return d.toISOString()
  }

  // 甲斐さん（入院中）。1 回目の面談のあと、AI が書いた状態
  const kai = await createClient(db, staff, { name: '甲斐', sex: '男', status: '入院中' })
  clients.kai = kai.id
  const v1 = load('../eval/scenario/gold/用紙/アセスメント_v1.json')
  await applyBatch(db, { officeId: staff.officeId, documentId: kai.assessmentId, kind: 'seed', label: 'AI 書き込み 1・1/21 病院の面談', proposed: toProposed(v1), system: { 'assessment.initialDate': v1['assessment.initialDate'] } })
  await db.query('UPDATE clients SET next_visit_at = $2 WHERE id = $1', [kai.id, tomorrow(14)])

  // 山田さん・田中さん（保存済み）
  const sample = load('../forms/samples/見本_花子.json')
  for (const [key, name, extra, visit] of [
    ['yamada', '山田 花子', {}, tomorrow(16)],
    ['tanaka', '田中 和子', { 'cert.careLevel': '要介護3' }, tomorrow(10, 9)],
  ] as const) {
    const c = await createClient(db, staff, { name, sex: '女', status: '在宅' })
    clients[key] = c.id
    const values: Record<string, unknown> = { ...sample, ...extra, 'person.name': name }
    await applyBatch(db, { officeId: staff.officeId, documentId: c.assessmentId, kind: 'seed', label: '見本のデータ', proposed: toProposed(values), system: Object.fromEntries(['assessment.initialDate', 'assessment.updateDate'].filter((k) => values[k]).map((k) => [k, values[k]])) })
    await saveDocument(db, staff, c.assessmentId, { scope: 'document' })
    await db.query('UPDATE clients SET next_visit_at = $2 WHERE id = $1', [c.id, visit])
  }

  // 佐藤さん（新規）
  const sato = await createClient(db, staff, { name: '佐藤 一郎', sex: '男', status: '在宅' })
  clients.sato = sato.id
  await db.query('UPDATE clients SET next_visit_at = $2 WHERE id = $1', [sato.id, tomorrow(10, 2)])
  return { officeId: staff.officeId, staff, clients }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    console.error('本番では見本のデータを入れません（demo 環境なら --force）')
    process.exit(1)
  }
  const db = await createPool()
  const exists = (await db.query('SELECT count(*) AS n FROM offices')).rows[0].n
  if (Number(exists) > 0 && !process.argv.includes('--again')) {
    console.log('もう入っています（もう一度入れるときは --again）')
  } else {
    const emailArg = process.argv.find((a) => a.startsWith('--email='))?.slice(8)
    const uidArg = process.argv.find((a) => a.startsWith('--uid='))?.slice(6)
    const r = await seed(db, { email: emailArg, authUid: uidArg })
    console.log(`見本のデータを入れました（事業所 ${r.officeId}、ケアマネ ${r.staff.email}）`)
  }
  await db.end()
}
