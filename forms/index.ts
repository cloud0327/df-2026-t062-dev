// 様式の一覧。画面・api（PDF）・worker で共通に使う。
//   template … pdfme のテンプレート（印字欄の位置。basePdf はファイル名）
//   bindings … 印字欄 → 欄の値（fields.json の key）の対応（forms/seed/<様式>/bindings.json）。変換は core/binding.ts の共通の仕組み
//   keys     … 様式が読む key（bindings から作る）
import { formKeys, type Bindings } from '../core/binding.ts'
import assessmentTemplate from './templates/assessment/template.json' with { type: 'json' }
import admissionTemplate from './templates/admission/template.json' with { type: 'json' }
import assessmentBindings from './seed/assessment/bindings.json' with { type: 'json' }
import admissionBindings from './seed/admission/bindings.json' with { type: 'json' }

export type FormId = 'assessment' | 'admission'

export interface TemplateSlot {
  name: string
  type: 'text' | 'circleMark'
  position: { x: number, y: number }
  width: number
  height: number
  fontSize?: number
  lineHeight?: number
  alignment?: 'left' | 'center' | 'right'
  verticalAlignment?: 'top' | 'middle' | 'bottom'
  dynamicFontSize?: { min: number, max: number, fit: string }
}

export interface Template {
  basePdf: string
  schemas: TemplateSlot[][]
}

export interface PageDef {
  /** 用紙に印刷されたページ番号（1 から） */
  no: number
  /** template.schemas の何番目か */
  pdfIndex: number
  title: string
  /** 画面の背景にするページの画像（public/ の中） */
  image: string
}

export interface FormDef {
  id: FormId
  label: string
  template: Template
  bindings: Bindings
  keys: string[]
  pages: PageDef[]
}

const ASSESSMENT_TITLES = [
  'フェースシート', '家族状況・支援', 'サービス利用・住居', '健康状態・受診', '6-① 基本動作', '6-② 生活機能',
  '6-③④ 認知・行動', '6-⑤ 社会生活', '6-⑥ 医療・健康', '7 全体のまとめ', '1 日のスケジュール',
]

function form(id: FormId, label: string, template: unknown, bindings: unknown, pages: PageDef[]): FormDef {
  const b = bindings as Bindings
  return { id, label, template: template as Template, bindings: b, keys: formKeys(b), pages }
}

export const FORMS: Record<FormId, FormDef> = {
  // PDF の 1 ページ目は表紙なので、画面には出さない
  assessment: form('assessment', 'アセスメント', assessmentTemplate, assessmentBindings,
    ASSESSMENT_TITLES.map((title, i) => ({ no: i + 1, pdfIndex: i + 1, title, image: `/forms/assessment/p${i + 1}.png` }))),
  admission: form('admission', '入院時情報提供書', admissionTemplate, admissionBindings,
    [{ no: 1, pdfIndex: 0, title: '入院時情報提供書', image: '/forms/admission/p1.png' }]),
}

/** 印字欄の名前 → ページ（画面のページ番号） */
export function slotPages(form: FormDef): Map<string, number> {
  const out = new Map<string, number>()
  for (const p of form.pages) for (const s of form.template.schemas[p.pdfIndex] ?? []) out.set(s.name, p.no)
  return out
}
