// 様式の版の元の PDF とページの画像を、非公開の置き場（forms）に入れる（管理用）。api は読むだけ。
//   npm run forms:assets                 … 使う版（published）の PDF と画像（pdftoppm が要る）
//   npm run forms:assets -- --pdf-only   … PDF だけ
// 置き場は上書きしない（同じ中身ならそのまま。別の中身があれば止まる）。STORAGE_MODE=gcs なら Cloud Storage（GCS_FORMS_BUCKET）。
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formAssetPath, pageImageName, FORM_KINDS } from '../../core/form.ts'
import { basePdfPath, loadVersion, publishedVersionId, type FormVersion } from '../../db/forms.ts'
import { createPool } from '../../db/pool.ts'
import { defaultStorage, type Storage } from '../../api/storage.ts'
import { ensurePdf } from './pdf.ts'

/** 画像は 1 日ブラウザが覚えてよい（期限つきの URL も 1 日の区切りで同じ） */
const IMAGE_CACHE = 'private, max-age=86400'

/** 版の PDF（と画像）を置き場に入れる。PDF の中身が版のハッシュと違えば断る */
export async function putFormAssets(storage: Storage, v: FormVersion, pdf: Uint8Array, opts: { images?: boolean } = {}) {
  if (createHash('sha256').update(pdf).digest('hex') !== v.basePdfSha256) throw new Error(`${v.kind} v${v.version}: PDF の中身が版と違います`)
  const out = [`base.pdf: ${await storage.writeOnce('forms', basePdfPath(v), pdf, 'application/pdf')}`]
  if (opts.images === false) return out
  const dir = mkdtempSync(join(tmpdir(), 'form-pages-'))
  try {
    const src = join(dir, 'base.pdf')
    writeFileSync(src, pdf)
    // 180 dpi のグレー。-cropbox: 見開きの半分を見せるページ（アセスメントの最後の 2 ページ）は、見せる枠だけを画像にする
    execFileSync('pdftoppm', ['-r', '180', '-gray', '-png', '-cropbox', src, join(dir, 'p')], { stdio: 'inherit' })
    const files = readdirSync(dir).filter((f) => /^p-\d+\.png$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    for (const page of v.pages) {
      const f = files[page.pdfIndex]
      if (!f) throw new Error(`${v.kind} v${v.version}: PDF に ${page.pdfIndex + 1} ページ目がありません`)
      const r = await storage.writeOnce('forms', formAssetPath(v.templateId, v.version, pageImageName(page.no)), new Uint8Array(readFileSync(join(dir, f))), 'image/png', IMAGE_CACHE)
      out.push(`${pageImageName(page.no)}: ${r}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pdfOnly = process.argv.includes('--pdf-only')
  const db = await createPool()
  const storage = defaultStorage()
  // 全事業所の様式の使う版（事業所の様式は、その事業所の id を指定して入れる。今はない）
  const office = (await db.query('SELECT id FROM offices LIMIT 1')).rows[0]?.id ?? '00000000-0000-0000-0000-000000000000'
  for (const kind of FORM_KINDS) {
    const v = await loadVersion(db, await publishedVersionId(db, office, kind))
    const { pdf, message } = await ensurePdf(kind)
    if (!pdf) { console.log(`${kind} v${v.version}: ${message}`); continue }
    for (const line of await putFormAssets(storage, v, pdf, { images: !pdfOnly })) console.log(`${kind} v${v.version} ${line}`)
  }
  await db.end()
}
