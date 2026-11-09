// 様式の元の PDF とページの画像を、非公開の置き場（forms）に入れる（管理用）。api は読むだけ。
//   npm run forms:assets                 … forms/seed の全部の様式の PDF と画像（pdftoppm が要る）
//   npm run forms:assets -- --pdf-only   … PDF だけ
// 場所は元の PDF のハッシュで決まる（pdf/<sha256>/…）ので DB は要らない。同じ中身ならそのまま、別の中身なら止まる（上書きしない）。
// STORAGE_MODE=gcs なら Cloud Storage（GCS_FORMS_BUCKET）。手元の gcloud の権限で入れる（infra/gcp/README.md）。
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { basePdfAssetPath, pageImageAssetPath, type FormPage } from '../../core/form.ts'
import { defaultStorage, type Storage } from '../../api/storage.ts'
import { readMeta, seedKinds } from './files.ts'
import { ensurePdf } from './pdf.ts'

/** 画像は 1 日ブラウザが覚えてよい（期限つきの URL も 1 日の区切りで同じ） */
const IMAGE_CACHE = 'private, max-age=86400'

/** 元の PDF（と、様式のページの画像）を置き場に入れる。PDF の中身がハッシュと違えば断る */
export async function putFormAssets(storage: Storage, form: { basePdfSha256: string, pages: FormPage[] }, pdf: Uint8Array, opts: { images?: boolean } = {}) {
  if (createHash('sha256').update(pdf).digest('hex') !== form.basePdfSha256) throw new Error('PDF の中身がハッシュと違います')
  const out = [`base.pdf: ${await storage.writeOnce('forms', basePdfAssetPath(form.basePdfSha256), pdf, 'application/pdf')}`]
  if (opts.images === false) return out
  const dir = mkdtempSync(join(tmpdir(), 'form-pages-'))
  try {
    const src = join(dir, 'base.pdf')
    writeFileSync(src, pdf)
    // 180 dpi のグレー。-cropbox: 見開きの半分を見せるページ（アセスメントの最後の 2 ページ）は、見せる枠だけを画像にする
    execFileSync('pdftoppm', ['-r', '180', '-gray', '-png', '-cropbox', src, join(dir, 'p')], { stdio: 'inherit' })
    const files = readdirSync(dir).filter((f) => /^p-\d+\.png$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    for (const page of form.pages) {
      const f = files[page.pdfIndex]
      if (!f) throw new Error(`PDF に ${page.pdfIndex + 1} ページ目がありません`)
      const r = await storage.writeOnce('forms', pageImageAssetPath(form.basePdfSha256, page.pdfIndex + 1), new Uint8Array(readFileSync(join(dir, f))), 'image/png', IMAGE_CACHE)
      out.push(`p${page.pdfIndex + 1}.png（${page.title}）: ${r}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pdfOnly = process.argv.includes('--pdf-only')
  const storage = defaultStorage()
  for (const kind of seedKinds()) {
    const meta = readMeta(kind)
    const { pdf, message } = await ensurePdf(kind)
    if (!pdf) { console.log(`${kind}: ${message}`); continue }
    for (const line of await putFormAssets(storage, meta, pdf, { images: !pdfOnly })) console.log(`${kind} ${line}`)
  }
}
