// forms/seed/ の様式を、全事業所の様式の版として DB に入れる（管理用）。中身が変わっていなければ何もしない。
// 中身が変わっていれば新しい版を作って使う版にする。前の版を指す書類は、npm run forms:rebase で移す。
//   npm run forms:seed
// 元の PDF やページの画像がなくても登録できる（PDF・画像は npm run forms:assets で置き場に入れる）。
import { fileURLToPath } from 'node:url'
import { registerVersion, type RegisterResult } from '../../db/forms.ts'
import { createPool, type Db } from '../../db/pool.ts'
import { readSeed, seedKinds } from './files.ts'

export async function seedForms(db: Db): Promise<Record<string, RegisterResult>> {
  const out: Record<string, RegisterResult> = {}
  for (const kind of seedKinds()) out[kind] = await registerVersion(db, readSeed(kind), { publish: true })
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = await createPool()
  for (const [kind, r] of Object.entries(await seedForms(db))) {
    const rebase = r.version > 1 ? '。前の版を指す書類は npm run forms:rebase で移す' : ''
    console.log(`${kind}: ${r.created ? `新しい版 v${r.version} を登録して、使う版にしました${rebase}` : `v${r.version} のまま（変わっていません）`}`)
  }
  await db.end()
}
