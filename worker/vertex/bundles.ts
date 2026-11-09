// 23 項目のまとまり。Gemini の 1 回の呼び出しで、書く・読み直す・直す範囲。
// 項目ごとに呼ぶと、同じ記録を 20 回以上送ることになる。関係の近い項目をまとめて、記録を送る回数を減らす。
// 答えの形（JSON Schema）が大きいと、Gemini が 400（Request contains an invalid argument）で断る。
// 2026-11-10 に gemini-3.8-flash で確かめた境目: 形の中の項目（properties、入れ子も数える）が 157 までは通り、161 からは断られた。
// まとまりは、欄の値・2 回目の直しのどちらの形も 157 以下にする（test/vertex-writer.test.ts で確かめる）。
// 置き場所を取り違えやすい項目（生活状況と社会との関わり、主訴と介護力など）は、同じまとまりに入れる。
import type { Spec } from './common.ts'

export interface Bundle {
  id: string
  /** 23 項目の番号（0 は番号のない欄。全体のまとめなど） */
  items: number[]
}

export const BUNDLES: Bundle[] = [
  { id: 'basic', items: [1, 3, 5, 6, 8] },         // 基本と制度（基本情報・被保険者情報・自立度・認定情報）
  { id: 'life', items: [2, 14, 15, 23] },          // 暮らしと人との関わり（生活状況・コミュニケーション・社会との関わり・特別な状況）
  { id: 'care', items: [7, 13, 20, 21] },          // 思いと介護（主訴・認知・問題行動・介護力）
  { id: 'health', items: [10, 17, 18] },           // 体と健康（健康状態・じょく瘡・口腔衛生）
  { id: 'adl', items: [11] },                      // 動作（ADL）
  { id: 'intake', items: [16, 19] },               // 排泄と食事（排尿・排便・食事摂取）
  { id: 'home', items: [4, 12, 22] },              // サービスと住まい（利用中のサービス・IADL・居住環境）
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
