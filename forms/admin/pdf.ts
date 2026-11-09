// 様式の元の PDF を手元（forms/tools/templates/<種類>/base.pdf）に用意する。中身は form.json のハッシュで確かめる。
//   アセスメント: 全社協が公開している PDF を公式の URL から取ってくる
//   入院時情報提供書: 公開されていない地域の版なので、手元に置いたときだけ
// PDF は公開リポジトリに入れない（.gitignore）。
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FormKind } from '../../core/form.ts'
import { readMeta } from './files.ts'

export const localPdf = (kind: FormKind) => fileURLToPath(new URL(`../tools/templates/${kind}/base.pdf`, import.meta.url))
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

export async function ensurePdf(kind: FormKind): Promise<{ pdf: Uint8Array | null, message: string }> {
  const meta = readMeta(kind)
  const file = localPdf(kind)
  if (existsSync(file)) {
    const b = new Uint8Array(readFileSync(file))
    if (sha(b) === meta.basePdfSha256) return { pdf: b, message: '元の PDF はもうあります' }
    if (!meta.sourceUrl) throw new Error(`${file} の中身が、欄の位置を合わせた版と違います（form.json の basePdfSha256）`)
  }
  if (!meta.sourceUrl) return { pdf: null, message: `元の PDF がありません（公開されていない様式なので、手元の PDF を ${file} に置いてください）` }
  const res = await fetch(meta.sourceUrl)
  if (!res.ok) throw new Error(`元の PDF を取ってこられませんでした（HTTP ${res.status}）: ${meta.sourceUrl}`)
  const b = new Uint8Array(await res.arrayBuffer())
  if (sha(b) !== meta.basePdfSha256) throw new Error(`公式の PDF が、欄の位置を合わせた版と違います（様式が改訂された可能性。欄の位置と対応を作り直して、新しい版にする）: ${meta.sourceUrl}`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, b)
  return { pdf: b, message: `公式の URL から取ってきました: ${meta.sourceUrl}` }
}
