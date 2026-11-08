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
 * 書類をまたいで 1 つの値として持つ基本情報（AI基盤の設計 4.4）。どの書類で直しても、全部の書類に入る。
 * キャンバスの決めごとに合わせて、性別も同じ値にする。
 */
export const SHARED_KEYS = new Set([
  'person.name', 'person.sex', 'person.birthDate', 'person.age',
  'person.postalCode', 'person.address', 'person.phone',
])

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
