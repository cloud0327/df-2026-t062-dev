// fields.json から作る値の型の確かめ（zod）。AI が書いた値と、画面からの直しの両方に使う。
import { z } from 'zod'
import { BY_KEY, choicesOf, subFieldsOf, type FieldSpec } from './fields.ts'

const DATE = /^\d{4}-\d{2}-\d{2}$/

function scalar(f: FieldSpec): z.ZodType {
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
    case 'date': return z.string().regex(DATE)
    case 'text': case 'longtext': return z.string()
    case 'object': return z.object(Object.fromEntries(subFieldsOf(f).map((s) => [s.key, scalar(s).nullish()]))).strict()
    case 'list': return z.array(z.object(Object.fromEntries(subFieldsOf(f).map((s) => [s.key, scalar(s).nullish()]))).strict())
    default: return z.never()
  }
}

const cache = new Map<string, z.ZodType>()

/** key の値の型。fields.json にない key は undefined */
export function valueSchema(key: string): z.ZodType | undefined {
  const f = BY_KEY.get(key)
  if (!f) return undefined
  let s = cache.get(key)
  if (!s) { s = scalar(f); cache.set(key, s) }
  return s
}

/** 値が型どおりか。null は「消す」なので通す */
export function validValue(key: string, value: unknown): boolean {
  if (value === null) return true
  if (key.startsWith('slot:')) return typeof value === 'string'
  const s = valueSchema(key)
  return !!s && s.safeParse(value).success
}
