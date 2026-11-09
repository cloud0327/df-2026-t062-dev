import { FIELDS } from '../../core/fields.ts'

const names = new Map<number, string>((FIELDS.item23 as { no: number, name: string }[]).map((x) => [x.no, x.name]))
names.set(0, '全体のまとめ')

/** Worker の失敗グループ番号を、用紙を確認する人が読める名前にする。 */
export function failedTopicNames(groups: string[]): string[] {
  return [...new Set(groups.map((g) => {
    const n = Number(g.replace(/^check:/, ''))
    return Number.isInteger(n) && names.has(n) ? names.get(n)! : '項目不明'
  }))]
}
