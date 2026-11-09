// 様式の元の PDF を用意し、画面の背景にするページの画像を作る。
//
// 様式の PDF とそこから作った画像・座標データは、公開リポジトリに入れない（利用条件のため。2026-11-09 に決めた）。
//   アセスメント: 全社協が公開している PDF を、公式の URL から取ってくる（中身が同じかをハッシュで確かめる）
//   入院時情報提供書: 公開されていない地域の版なので、手元に forms/templates/admission/base.pdf を置いたときだけ使う
//
//   npm run forms:fetch              … PDF を用意して、画像も作る（pdftoppm が要る。brew install poppler など）
//   npm run forms:fetch -- --pdf-only … PDF だけ用意する（CI のテスト用）
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../../', import.meta.url)
const path = (rel) => fileURLToPath(new URL(rel, ROOT))

const ASSESSMENT = {
  url: 'https://www.shakyo.or.jp/download/careplanGL/assess.pdf',
  sha256: '9a8b35b1199bd205e46f2448463dc47001398411142c1d55d07478125a95e7e9',
  pdf: 'forms/templates/assessment/base.pdf',
  out: 'public/forms/assessment',
  // PDF の 1 ページ目は表紙なので、画面のページは 2 ページ目から
  first: 2,
}
const ADMISSION = { pdf: 'forms/templates/admission/base.pdf', out: 'public/forms/admission', first: 1 }

const sha = (buf) => createHash('sha256').update(buf).digest('hex')
const pdfOnly = process.argv.includes('--pdf-only')

async function fetchAssessment() {
  const file = path(ASSESSMENT.pdf)
  if (existsSync(file) && sha(readFileSync(file)) === ASSESSMENT.sha256) {
    console.log('アセスメントの PDF はもうあります')
    return
  }
  console.log(`アセスメントの PDF を全社協の公式の URL から取ってきます: ${ASSESSMENT.url}`)
  const res = await fetch(ASSESSMENT.url)
  if (!res.ok) throw new Error(`取ってこられませんでした（HTTP ${res.status}）`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (sha(buf) !== ASSESSMENT.sha256) {
    throw new Error('全社協の PDF が、欄の位置を合わせた版と違います（様式が改訂された可能性。template.json の作り直しが要る）')
  }
  writeFileSync(file, buf)
}

function render({ pdf, out, first }) {
  const src = path(pdf)
  if (!existsSync(src)) return false
  const dir = path(out)
  mkdirSync(dir, { recursive: true })
  const tmp = path(`${out}/.tmp`)
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp)
  // 180 dpi のグレー（拡大 160% でも罫線が読める大きさ）
  execFileSync('pdftoppm', ['-r', '180', '-gray', '-png', '-f', String(first), src, `${tmp}/p`], { stdio: 'inherit' })
  const files = readdirSync(tmp).filter((f) => f.endsWith('.png')).sort()
  files.forEach((f, i) => renameSync(`${tmp}/${f}`, `${dir}/p${i + 1}.png`))
  rmSync(tmp, { recursive: true, force: true })
  console.log(`${out} に ${files.length} ページの画像を作りました`)
  return true
}

await fetchAssessment()
if (!pdfOnly) {
  try {
    render(ASSESSMENT)
    if (!render(ADMISSION)) console.log('入院時情報提供書の PDF（forms/templates/admission/base.pdf）がないので、画像は作りません')
  } catch (e) {
    console.error(`画像を作れませんでした。pdftoppm（poppler）を入れてください: ${e.message}`)
    process.exit(1)
  }
}
