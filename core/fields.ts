// fields.json（欄の一覧の本体）を読む。画面・api・worker で共通に使う。
import FIELDS_JSON from './fields.json' with { type: 'json' }

export type FieldType =
  | 'text' | 'longtext' | 'date' | 'number' | 'bool' | 'enum' | 'multi' | 'image' | 'object' | 'list'

export interface FieldSpec {
  key: string
  label: string
  type: FieldType
  choices?: string[] | string
  of?: string
  fields?: FieldSpec[]
  item23?: number | null
  source?: string[]
  forms?: Record<string, string>
  note?: string
  /** 書類をまたいで同じ値（基本情報） */
  shared?: boolean
  /** この欄に意味があるときの前提。欄なら欄の key、中の項目なら同じまとまりの中の項目の key → 値の一覧 */
  requires?: Record<string, (string | boolean | number)[]>
  /** 選択肢にない言い方を入れる詳しい欄（同じまとまりの中の項目の key） */
  detail?: string
  /** list の行を見分ける項目の key。"order" は行の並びの順で見分ける */
  rowKey?: string
}

interface FieldsFile {
  meta: unknown
  item23: unknown
  forms: unknown
  required: { assess: { keys: (string | string[])[] } }
  choiceSets: Record<string, string[]>
  types: Record<string, { label: string, fields: FieldSpec[] }>
  fields: (FieldSpec | { group: string })[]
}

export const FIELDS = FIELDS_JSON as unknown as FieldsFile

export const FIELD_LIST: FieldSpec[] = FIELDS.fields.filter((f): f is FieldSpec => 'key' in f && !!f.key)

export const BY_KEY = new Map(FIELD_LIST.map((f) => [f.key, f]))

export function spec(key: string): FieldSpec | undefined {
  return BY_KEY.get(key)
}

export function choicesOf(f: Pick<FieldSpec, 'choices'>): string[] {
  if (!f.choices) return []
  return typeof f.choices === 'string' ? FIELDS.choiceSets[f.choices] ?? [] : f.choices
}

export function subFieldsOf(f: FieldSpec): FieldSpec[] {
  return f.fields ?? (f.of ? FIELDS.types[f.of]?.fields ?? [] : [])
}

/**
 * 書類をまたいで 1 つの値として持つ基本情報（fields.json の shared）。どの書類で直しても、全部の書類に入る。
 */
export const SHARED_KEYS = new Set(FIELD_LIST.filter((f) => f.shared).map((f) => f.key))

export const isShared = (key: string) => SHARED_KEYS.has(key)

/** アセスメントの必須の欄（配列の要素は「どれか 1 つに値があればよい」組） */
export const REQUIRED_ASSESS: (string | string[])[] = FIELDS.required.assess.keys

/** AI が書かない欄（出どころがケアマネの判断・事業所の設定・その場で聞くことだけの欄） */
export function aiMayWrite(key: string): boolean {
  const f = BY_KEY.get(key)
  if (!f) return false
  const src = f.source ?? []
  if (src.length === 0) return true
  return src.some((s) => s === 'talk' || s.startsWith('doc:') || s === 'draft' || s === 'derived')
}
