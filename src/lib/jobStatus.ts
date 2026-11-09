import { BY_KEY } from '../../core/fields.ts'

/** fields.json の key を、用紙を確認する人が読める名前にする。 */
export function incompleteFieldNames(keys: string[]): string[] {
  return [...new Set(keys.map((key) => BY_KEY.get(key)?.label ?? key))]
}
