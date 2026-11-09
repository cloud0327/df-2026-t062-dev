// fields.json から作る値の型の確かめ（zod）。AI が書いた値と、画面からの直しの両方に使う。
import { z } from 'zod'
import { BY_KEY, choicesOf, subFieldsOf, type FieldSpec } from './fields.ts'

const DATE = /^\d{4}-\d{2}-\d{2}$/
/** ケアマネの直しでは、年だけ・年月だけの日付も持てる（手帳の交付日など、用紙に年月しかない欄もある） */
const PARTIAL_DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/

/** 暦にある日付か（2021-02-30 は通さない） */
function onCalendar(v: string): boolean {
  const [y, m, d] = v.split('-').map(Number)
  if (m !== undefined && (m < 1 || m > 12)) return false
  if (d !== undefined) {
    const dt = new Date(Date.UTC(y, m - 1, d))
    if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false
  }
  return true
}

export interface SchemaOptions {
  /** true なら日付は年月日そろったものだけ（AI が書く値） */
  strictDates?: boolean
}

function scalar(f: FieldSpec, o: SchemaOptions = {}): z.ZodType {
  switch (f.type) {
    case 'enum': {
      const c = choicesOf(f)
      return c.length ? z.enum(c as [string, ...string[]]) : z.string()
    }
    case 'multi': {
      const c = choicesOf(f)
      return z.array(c.length ? z.enum(c as [string, ...string[]]) : z.string())
    }
    case 'bool': return z.boolean()
    case 'number': return z.number()
    case 'date': return z.string().regex(o.strictDates ? DATE : PARTIAL_DATE).refine(onCalendar, '暦にない日付です')
    case 'text': case 'longtext': return z.string()
    case 'object': return z.object(Object.fromEntries(subFieldsOf(f).map((s) => [s.key, scalar(s, o).nullish()]))).strict()
    case 'list': return z.array(z.object(Object.fromEntries(subFieldsOf(f).map((s) => [s.key, scalar(s, o).nullish()]))).strict())
    default: return z.never()
  }
}

const cache = new Map<string, z.ZodType>()

/** key の値の型。fields.json にない key は undefined */
export function valueSchema(key: string, o: SchemaOptions = {}): z.ZodType | undefined {
  const f = BY_KEY.get(key)
  if (!f) return undefined
  const ck = `${o.strictDates ? 'S' : 'L'}:${key}`
  let s = cache.get(ck)
  if (!s) { s = scalar(f, o); cache.set(ck, s) }
  return s
}

/** 値が型どおりか。null は「消す」なので通す。AI が書いた値は strictDates で確かめる */
export function validValue(key: string, value: unknown, o: SchemaOptions = {}): boolean {
  if (value === null) return true
  const s = valueSchema(key, o)
  return !!s && s.safeParse(value).success
}
