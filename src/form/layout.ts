// 様式のページごとの欄の並び（位置・種類）。キャンバスと同じく、用紙の画像の上に % の位置で重ねる。
import { FORMS, isCheckSlot, type FormDef, type FormId, type PageDef, type SlotEntry, type TemplateSlot } from '../../forms/index.ts'

export const W = 210
export const H = 297
const PT = 0.3528

export const pc = (v: number, t: number) => `${(v / t * 100).toFixed(3)}%`
export const pos = (x: number, y: number, w: number, h: number): React.CSSProperties => ({ left: pc(x, W), top: pc(y, H), width: pc(w, W), height: pc(h, H) })
/** pt の文字の大きさを、用紙の幅に対する cqw にする（キャンバスの fsz と同じ） */
export const fsz = (pt: number) => `${(pt * PT / W * 100).toFixed(3)}cqw`

export type SlotKind = 'text' | 'area' | 'circle' | 'check' | 'cell'

export interface SlotView {
  name: string
  kind: SlotKind
  x: number
  y: number
  w: number
  h: number
  pt: number
  lh: number
  align: 'left' | 'center' | 'right'
  entry?: SlotEntry
  /** 表のマス（○ △ を選ぶ）の選択肢。1 つなら押すと付け外し */
  cellOptions?: { text: string, label: string }[]
  label: string
}

export interface PageLayout extends PageDef {
  slots: SlotView[]
}

const LABELS: Record<string, string> = {
  '○': '実施している', '△': '時々実施している', '✓': '要援助と判断した',
}

function classify(s: TemplateSlot, entry: SlotEntry | undefined): Omit<SlotView, 'name' | 'x' | 'y' | 'w' | 'h' | 'pt' | 'lh' | 'align' | 'label'> {
  if (s.type === 'circleMark') return { kind: 'circle', entry }
  if (isCheckSlot(s)) return { kind: 'check', entry }
  if (entry?.kind === 'choiceText' && entry.options.every((o) => o.text.length <= 1)) {
    const opts = entry.options.map((o) => ({
      text: o.text,
      label: typeof o.value === 'string' ? o.value.replace(/^[○△✓]（(.*)）$/, '$1') || LABELS[o.text] || o.text : LABELS[o.text] ?? '実施している',
    }))
    return { kind: 'cell', entry, cellOptions: opts }
  }
  const pt = s.fontSize ?? 9
  const lh = s.lineHeight ?? 1.1
  return { kind: s.height >= pt * PT * lh * 1.8 ? 'area' : 'text', entry }
}

const cache = new Map<FormId, PageLayout[]>()

export function pagesOf(formId: FormId): PageLayout[] {
  const hit = cache.get(formId)
  if (hit) return hit
  const form: FormDef = FORMS[formId]
  const out = form.pages.map((p) => ({
    ...p,
    slots: (form.template.schemas[p.pdfIndex] ?? []).map((s): SlotView => ({
      name: s.name,
      x: s.position.x,
      y: s.position.y,
      w: s.width,
      h: s.height,
      pt: s.fontSize ?? 9,
      lh: s.lineHeight ?? 1.1,
      align: s.alignment ?? 'left',
      label: s.name.replace(/^p\d+_/, '').replace(/_/g, ' '),
      ...classify(s, form.slotmap[s.name]),
    })),
  }))
  cache.set(formId, out)
  return out
}
