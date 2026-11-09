// 様式のページごとの欄の並び（位置・種類）。キャンバスと同じく、用紙の画像の上に % の位置で重ねる。
import type { Binding } from '../../core/binding.ts'
import type { FormDef, FormPage } from '../../core/form.ts'

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
  binding?: Binding
  /** 表のマス（○ △ を選ぶ）の選択肢。1 つなら押すと付け外し */
  cellOptions?: { text: string, label: string }[]
  label: string
}

export interface PageLayout extends FormPage {
  slots: SlotView[]
}

const LABELS: Record<string, string> = {
  '○': '実施している', '△': '時々実施している', '✓': '要援助と判断した',
}

/** 印字欄の見せ方は、対応の ui で決める（丸・✓・表のマス・1 行の文字・文章） */
function classify(binding: Binding | undefined): Omit<SlotView, 'name' | 'x' | 'y' | 'w' | 'h' | 'pt' | 'lh' | 'align' | 'label'> {
  if (!binding) return { kind: 'text' }
  if (binding.ui === 'circle' || binding.ui === 'check') return { kind: binding.ui, binding }
  if (binding.op === 'symbol@1' && binding.ui === 'cell') {
    const opts = binding.options.map((o) => ({
      text: o.text,
      label: typeof o.value === 'string' ? o.value.replace(/^[○△✓]（(.*)）$/, '$1') || LABELS[o.text] || o.text : LABELS[o.text] ?? '実施している',
    }))
    return { kind: 'cell', binding, cellOptions: opts }
  }
  return { kind: binding.ui === 'area' ? 'area' : 'text', binding }
}

/** 様式の版ごとに覚える（版の中身は変わらない） */
const cache = new Map<string, PageLayout[]>()

export function pagesOf(form: FormDef): PageLayout[] {
  const hit = cache.get(form.id)
  if (hit) return hit
  const out = form.pages.map((p) => ({
    ...p,
    slots: (form.schemas[p.pdfIndex] ?? []).map((s): SlotView => ({
      name: s.name,
      x: s.position.x,
      y: s.position.y,
      w: s.width,
      h: s.height,
      pt: s.fontSize ?? 9,
      lh: s.lineHeight ?? 1.1,
      align: s.alignment ?? 'left',
      label: s.name.replace(/^p\d+_/, '').replace(/_/g, ' '),
      ...classify(form.bindings[s.name]),
    })),
  }))
  cache.set(form.id, out)
  return out
}
