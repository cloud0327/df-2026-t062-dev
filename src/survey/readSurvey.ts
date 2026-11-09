import { getDocument, GlobalWorkerOptions, type PDFPageProxy } from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { choicesOf, spec } from '../../core/fields.ts'
import { SURVEY_IMPORT_KEYS, surveyChoice, surveyPage, type SurveyImportKey, type SurveySelection } from '../../core/survey-import.ts'
import { readBoxMarks } from './marks.ts'
import { HIROSHIMA_BOXES } from './hiroshima.ts'

GlobalWorkerOptions.workerSrc = pdfWorker

const MAX_BYTES = 10 * 1024 * 1024
const SCALE = 3
const compact = (text: string) => text.normalize('NFKC').replace(/\s/g, '')

interface Candidate {
  key: SurveyImportKey
  choice: SurveySelection | null
  page: 1 | 2
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
  if (page.rotate !== 0 || Math.abs(viewport.width / SCALE - 595.32) > 0.75 ||
      Math.abs(viewport.height / SCALE - 841.92) > 0.75) {
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
    const canvases = await Promise.all([render(first), render(second)])
    const identity = crop(canvases[0], 0, 0, canvases[0].width, canvases[0].height * 0.31)
    const images = canvases.map((canvas) => canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height))

    const notes = pdf.numPages >= 3 ? await textOn(await pdf.getPage(3)) : []
    const candidates = SURVEY_IMPORT_KEYS.map((key): Candidate => {
      const field = spec(key)
      const boxes = HIROSHIMA_BOXES[key]
      if (!field || choicesOf(field).length !== boxes.length) throw new Error(`選択肢の定義が一致しません: ${key}`)
      const page = surveyPage(key)
      const [width, height] = page === 1 ? [13.8, 16.3] : [11, 13.5]
      const marks = readBoxMarks(images[page - 1], boxes, SCALE, width, height)
      const marked = marks.flatMap((mark, index) => mark !== 'empty' ? [index + 1] : [])
      const selection = field.type === 'multi' ? marked : marked[0]
      const valid = surveyChoice(key, selection) !== undefined && (field.type === 'multi' || marked.length === 1)
      const faint = marks.includes('faint')
      const choice = valid && !faint ? selection : null
      const reason = choice !== null ? null : !marked.length ? '印を確認できません'
        : faint ? '印が薄く、選択肢を確定できません'
          : field.type === 'multi' ? '「ない」と他の選択肢の両方に印があります' : '複数の印があります'
      const top = Math.min(...boxes.map(([, y]) => y))
      const bottom = Math.max(...boxes.map(([, y]) => y)) + height
      const left = boxes[0][0] < 300 ? 21 : 310
      const row = crop(canvases[page - 1], left * SCALE, (top - 2) * SCALE, (left === 21 ? 282 : 264) * SCALE, (bottom - top + 6) * SCALE)
      const item = key.slice('survey.'.length).replace('_', '-')
      const noteAnchor = notes.filter((t) => compact(t.text) === item)
      // Show a literal line only when the item and its same-line text are identifiable.
      const note = noteAnchor.length === 1 ? notes.filter((t) =>
        t.x > noteAnchor[0].x + 25 && t.x < 450 && Math.abs(t.top - noteAnchor[0].top) < 1,
      ).map((t) => t.text).join('').trim() : ''
      return { key, choice, reason, page, note: note || undefined, preview: row }
    })
    return { fileName: file.name, sha256, identity, candidates }
  } finally {
    await task.destroy()
  }
}
