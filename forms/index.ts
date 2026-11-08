// 様式の一覧。画面・api（PDF）・worker で共通に使う。
//   toInputs … 欄の値（fields.json の key）→ 印字欄の値
//   template … pdfme のテンプレート（欄の位置。basePdf はファイル名）
//   slotmap  … 印字欄 → 欄の値（scripts/build-slotmap.mjs が作る）
import * as assessmentModule from './templates/assessment/index.mjs'
import * as admissionModule from './templates/admission/mapping.mjs'
import assessmentTemplate from './templates/assessment/template.json' with { type: 'json' }
import admissionTemplate from './templates/admission/template.json' with { type: 'json' }
import assessmentSlotmap from './templates/assessment/slotmap.json' with { type: 'json' }
import admissionSlotmap from './templates/admission/slotmap.json' with { type: 'json' }

export type FormId = 'assessment' | 'admission'

export type PathStep = string | number | Record<string, string>

export type SlotEntry =
  | { kind: 'enum' | 'multi', key: string, path: PathStep[], value: string }
  | { kind: 'bool', key: string, path: PathStep[], value: boolean }
  | { kind: 'text' | 'number', key: string, path: PathStep[] }
  | { kind: 'date', key: string, path: PathStep[], part: 'y' | 'm' | 'd' }
  | { kind: 'era', key: string, path: PathStep[], value: 'M' | 'T' | 'S' }
  | { kind: 'row', key: string, path: PathStep[], keySub: string, value: string }
  | { kind: 'choiceText', key: string, path: PathStep[], options: { text: string, value: string | boolean }[] }
  | { kind: 'derived', keys: string[] }

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
  toInputs: (data: Record<string, unknown>) => Record<string, string>
  usesKeys: string[]
  template: Template
  slotmap: Record<string, SlotEntry>
  pages: PageDef[]
}

const ASSESSMENT_TITLES = [
  'フェースシート', '家族状況・支援', 'サービス利用・住居', '健康状態・受診', '6-① 基本動作', '6-② 生活機能',
  '6-③④ 認知・行動', '6-⑤ 社会生活', '6-⑥ 医療・健康', '7 全体のまとめ', '1 日のスケジュール',
]

export const FORMS: Record<FormId, FormDef> = {
  assessment: {
    id: 'assessment',
    label: 'アセスメント',
    toInputs: assessmentModule.toInputs as FormDef['toInputs'],
    usesKeys: assessmentModule.usesKeys as string[],
    template: assessmentTemplate as unknown as Template,
    slotmap: assessmentSlotmap as unknown as Record<string, SlotEntry>,
    // PDF の 1 ページ目は表紙なので、画面には出さない
    pages: ASSESSMENT_TITLES.map((title, i) => ({ no: i + 1, pdfIndex: i + 1, title, image: `/forms/assessment/p${i + 1}.png` })),
  },
  admission: {
    id: 'admission',
    label: '入院時情報提供書',
    toInputs: admissionModule.toInputs as FormDef['toInputs'],
    usesKeys: admissionModule.usesKeys as string[],
    template: admissionTemplate as unknown as Template,
    slotmap: admissionSlotmap as unknown as Record<string, SlotEntry>,
    pages: [{ no: 1, pdfIndex: 0, title: '入院時情報提供書', image: '/forms/admission/p1.png' }],
  },
}

/** 印字欄の名前 → ページ（画面のページ番号） */
export function slotPages(form: FormDef): Map<string, number> {
  const out = new Map<string, number>()
  for (const p of form.pages) for (const s of form.template.schemas[p.pdfIndex] ?? []) out.set(s.name, p.no)
  return out
}

/** 印刷済みの □ の上に置いた ✓ の欄か（pdfme の試作 designer/form.js と同じ見分け方） */
export function isCheckSlot(s: TemplateSlot): boolean {
  return s.type === 'text' && Math.abs(s.width - s.height) <= 0.2 && s.width < 5 && s.alignment === 'center' && s.verticalAlignment === 'middle'
}
