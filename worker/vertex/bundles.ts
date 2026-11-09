// 23 項目のまとまり。Gemini の 1 回の呼び出しで、書く・読み直す・直す範囲。
// 項目ごとに呼ぶと、同じ記録を 20 回以上送ることになる。関係の近い項目をまとめて、記録を送る回数を減らす。
// 1 つのまとまりの欄は 45 くらいまでにする（答えの形（JSON Schema）が大きいと、Gemini が受け付けないことがある）。
import type { Spec } from './common.ts'

export interface Bundle {
  id: string
  /** 23 項目の番号（0 は番号のない欄。全体のまとめなど） */
  items: number[]
}

export const BUNDLES: Bundle[] = [
  { id: 'basic', items: [1, 3, 4, 5, 6, 8] },      // 基本と制度（基本情報・被保険者情報・利用中のサービス・自立度・認定情報）
  { id: 'life', items: [2, 7, 14, 15, 21, 23] },   // 暮らしと人との関わり（生活状況・主訴・コミュニケーション・社会との関わり・介護力・特別な状況）
  { id: 'health', items: [10, 17, 18, 19] },       // 体と健康（健康状態・じょく瘡・口腔衛生・食事摂取）
  { id: 'body', items: [11, 16] },                 // 動作と排泄（ADL・排尿・排便）
  { id: 'home', items: [12, 22] },                 // 家事と住まい（IADL・居住環境）
  { id: 'mind', items: [13, 20] },                 // 認知と行動（認知・問題行動）
]

/** 番号のない欄（全体のまとめなど）。1 回目は、ほかの欄を書いて読み直したあとに書く */
export const SUMMARY: Bundle = { id: 'summary', items: [0] }

const ALL = [...BUNDLES, SUMMARY]

/** 欄が入るまとまり。どのまとまりにも入らない項目があれば、気づけるように止める */
export function bundleOf(spec: Spec): Bundle {
  const no = spec.item23 || 0
  const b = ALL.find((x) => x.items.includes(no))
  if (!b) throw new Error(`23 項目の ${no} が、どのまとまりにも入っていない（worker/vertex/bundles.ts）`)
  return b
}

/** まとまりの id → 欄（BUNDLES の順、最後に SUMMARY）。欄のないまとまりは入れない */
export function groupByBundle(specs: Spec[]): Map<string, Spec[]> {
  const byId = new Map<string, Spec[]>()
  for (const s of specs) {
    const id = bundleOf(s).id
    byId.set(id, [...(byId.get(id) ?? []), s])
  }
  return new Map(ALL.filter((b) => byId.has(b.id)).map((b) => [b.id, byId.get(b.id)!]))
}

/** まとまりの id → 23 項目の番号 */
export const bundleItems = (id: string): number[] => ALL.find((b) => b.id === id)?.items ?? []
