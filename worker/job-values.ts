import { normalizeValue } from '../core/normalize.ts'
import { validValue } from '../core/schema.ts'
import type { ProposedValue } from './types.ts'

/** 書類に反映できる提案と、値の形式が合わず反映できない欄を分ける。 */
export function prepareWriterValues(values: Record<string, ProposedValue>): {
  proposed: Record<string, ProposedValue>
  droppedFields: string[]
} {
  const proposed: Record<string, ProposedValue> = {}
  const droppedFields: string[] = []
  for (const [key, proposal] of Object.entries(values)) {
    const value = normalizeValue(key, proposal.value)
    if (validValue(key, value, { strictDates: true })) proposed[key] = { ...proposal, value }
    else droppedFields.push(key)
  }
  return { proposed, droppedFields }
}

/** API と PDF プレビューで使う、重複のない未反映欄キー。 */
export function incompleteFieldKeys(writerIncompleteFields: string[], droppedFields: string[]): string[] {
  return [...new Set([...writerIncompleteFields, ...droppedFields])]
}
