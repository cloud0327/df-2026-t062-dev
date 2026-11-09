import { getDocument, GlobalWorkerOptions, type PDFPageProxy } from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { choicesOf, spec } from '../../core/fields.ts'
import { SURVEY_IMPORT_KEYS, type SurveyImportKey } from '../../core/survey-import.ts'
import { readRowMarks } from './marks.ts'

GlobalWorkerOptions.workerSrc = pdfWorker

const MAX_BYTES = 10 * 1024 * 1024
const SCALE = 3
// 裏面（p.2 生活機能）の第2群の行の印字文言。compact() で正規化した PDF のテキストと比較する。
const rowLabels: Record<SurveyImportKey, string> = {
  'survey.2_1': '1.移乗',
  'survey.2_2': '2.移動',
  'survey.2_3': '3.えん下',
  'survey.2_4': '4.食事摂取',
  'survey.2_5': '5.排尿',
  'survey.2_6': '6.排便',
  'survey.2_7': '7.口腔清潔',
  'survey.2_8': '8.洗顔',
  'survey.2_9': '9.整髪',
  'survey.2_10': '10.上衣の着脱',
  'survey.2_11': '11.ズボン等の着脱',
  'survey.2_12': '12.外出頻度',
}
const compact = (text: string) => text.normalize('NFKC').replace(/\s/g, '')

interface Candidate {
  key: SurveyImportKey
  choice: number | null
  reason: string | null
  preview: string
  note?: string
}

export interface SurveyPreview {
  fileName: string
  sha256: string
  identity: string
  candidates: Candidate[]
}

async function textOn(page: PDFPageProxy) {
  const { items } = await page.getTextContent()
  const viewport = page.getViewport({ scale: 1 })
  return items.flatMap((item) => 'str' in item ? [{
    text: item.str, x: item.transform[4], top: viewport.height - item.transform[5],
  }] : [])
}

async function render(page: PDFPageProxy) {
  const viewport = page.getViewport({ scale: SCALE })
  if (page.rotate !== 0 || viewport.width > 1900 || viewport.height > 2700 ||
      Math.abs(viewport.width / viewport.height - 0.707) > 0.01) {
    throw new Error('広島市版のA4縦のPDFを選んでください。')
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvas, viewport }).promise
  return canvas
}

function crop(canvas: HTMLCanvasElement, x: number, y: number, w: number, h: number) {
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  out.getContext('2d')!.drawImage(canvas, x, y, w, h, 0, 0, w, h)
  return out.toDataURL('image/png')
}

export async function readSurvey(file: File): Promise<SurveyPreview> {
  if (file.size > MAX_BYTES) throw new Error('10 MB以下のPDFを選んでください。')
  const data = new Uint8Array(await file.arrayBuffer())
  if (new TextDecoder().decode(data.subarray(0, 5)) !== '%PDF-') throw new Error('PDFを選んでください。')
  const digest = await crypto.subtle.digest('SHA-256', data)
  const sha256 = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('')
  const task = getDocument({ data, useSystemFonts: true, maxImageSize: 10_000_000 })
  try {
    const pdf = await task.promise
    if (pdf.numPages < 2 || pdf.numPages > 5) throw new Error('表面と裏面を含む広島市版の認定調査票PDFを選んでください。')
    const [first, second] = await Promise.all([pdf.getPage(1), pdf.getPage(2)])
    const [firstText, secondText] = await Promise.all([textOn(first), textOn(second)])
    if (!compact(firstText.map((item) => item.text).join('')).includes('広島市介護保険認定調査票') ||
        !secondText.some((item) => compact(item.text) === '2生活機能')) {
      throw new Error('広島市版のテキスト付きPDFに対応しています。スキャン画像や別の様式は確認できません。')
    }
    const firstPage = await render(first)
    const identity = crop(firstPage, 0, 0, firstPage.width, firstPage.height * 0.31)
    const canvas = await render(second)
    const context = canvas.getContext('2d')!
    const image = context.getImageData(0, 0, canvas.width, canvas.height)

    const notes = pdf.numPages >= 3 ? await textOn(await pdf.getPage(3)) : []
    const candidates = SURVEY_IMPORT_KEYS.map((key): Candidate => {
      const field = spec(key)
      const choices = field ? choicesOf(field) : []
      if (choices.length === 0) throw new Error(`選択肢が未定義の項目があります: ${key}`)
      const anchors = secondText.filter((t) => t.x > 12 && t.x < 65 && t.top > 60 && t.top < 350 && compact(t.text) === rowLabels[key])
      if (anchors.length !== 1) throw new Error('生活機能の欄を確認できませんでした。')
      const y = anchors[0].top * SCALE
      const marks = readRowMarks(image, y, SCALE, choices.length)
      const marked = marks.flatMap((m, index) => m !== 'empty' ? [index + 1] : [])
      const choice = marked.length === 1 && marks[marked[0] - 1] === 'clear' ? marked[0] : null
      const reason = choice !== null ? null : marked.length > 1 ? '複数の印があります'
        : marked.length === 1 ? '印が薄く、選択肢を確定できません' : '印を確認できません'
      const item = key.slice('survey.'.length).replace('_', '-')
      const noteAnchor = notes.filter((t) => compact(t.text) === item)
      // Show a literal line only when the item and its same-line text are identifiable.
      const note = noteAnchor.length === 1 ? notes.filter((t) =>
        t.x > noteAnchor[0].x + 25 && t.x < 450 && Math.abs(t.top - noteAnchor[0].top) < 1,
      ).map((t) => t.text).join('').trim() : ''
      return { key, choice, reason, note: note || undefined, preview: crop(canvas, 0, y - 13 * SCALE, canvas.width / 2.1, 17 * SCALE) }
    })
    return { fileName: file.name, sha256, identity, candidates }
  } finally {
    await task.destroy()
  }
}
