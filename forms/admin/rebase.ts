// 古い版を指す書類を、その様式の使う版に移す（管理用）。新しい版が、古い版の読んでいた key を全部読むときだけ移す。
//   npm run forms:rebase                 … 全部の様式
//   npm run forms:rebase -- --dry-run    … 移す数と、読まなくなる key を見るだけ
import { fileURLToPath } from 'node:url'
import { rebaseDocuments } from '../../db/forms.ts'
import { closePool, createPool } from '../../db/pool.ts'

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes('--dry-run')
  const db = await createPool()
  let failed = false
  try {
    for (const t of (await db.query('SELECT id, kind, office_id FROM form_templates ORDER BY kind')).rows) {
      const r = await rebaseDocuments(db, t.id, { dryRun })
      const scope = t.office_id ? `事業所 ${t.office_id} の ` : '全事業所の '
      if (Object.keys(r.missingKeys).length) {
        failed = true
        console.log(`${scope}${t.kind}: 移せません。新しい版 v${r.to.version} が読まない key があります:`)
        for (const [v, keys] of Object.entries(r.missingKeys)) console.log(`  ${v}: ${keys.join(', ')}`)
      } else if (!r.from.length) console.log(`${scope}${t.kind}: 古い版を指す書類はありません（v${r.to.version}）`)
      else console.log(`${scope}${t.kind}: ${r.from.map((f) => `v${f.version}`).join('・')} → v${r.to.version}、書類 ${r.documents} 件${dryRun ? '（--dry-run なので移していません）' : 'を移しました'}`)
    }
  } finally {
    await closePool(db)
  }
  if (failed) process.exit(1)
}
