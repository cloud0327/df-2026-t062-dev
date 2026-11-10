
import { BY_KEY, subFieldsOf, type FieldSpec } from '../fields.ts'
import type { Values, Scalar, Step, Ref, Test, Cond } from './types.ts'
import { isEmpty, str, same, getRef, Draft } from './values.ts'



// ---------- fields.json の型と前提 ----------

/** ref の場所の欄・項目の定義と、その項目が入っているまとまり（前提を見る相手）の場所 */

export function specsAlong(ref: Ref): { spec: FieldSpec, parent: Step[] | null }[] {

  const top = BY_KEY.get(ref.key)
  if (!top) return []
  const out: { spec: FieldSpec, parent: Step[] | null }[] = [{ spec: top, parent: null }]
  let cur = top
  const path = ref.path ?? []
  for (let i = 0; i < path.length; i++) {
    const step = path[i]
    if (typeof step !== 'string') continue // 行の番号・行の引き方は型を変えない
    const sub = subFieldsOf(cur).find((s) => s.key === step)
    if (!sub) break
    out.push({ spec: sub, parent: path.slice(0, i) })
    cur = sub
  }
  return out
}

export const specOf = (ref: Ref): FieldSpec | undefined => specsAlong(ref).at(-1)?.spec

const holds = (v: unknown, allowed: unknown[]) => (Array.isArray(v) ? v.some((x) => allowed.includes(x)) : allowed.includes(v))

interface Need { ref: Ref, allowed: unknown[], multi: boolean, label: string }

/** ref の欄に意味があるための前提（fields.json の requires）で、満たされていないもの */
function unmetRequires(values: Values, ref: Ref): Need[] {
  const out: Need[] = []
  for (const { spec, parent } of specsAlong(ref)) {
    for (const [k, allowed] of Object.entries(spec.requires ?? {})) {
      const target: Ref = parent === null ? { key: k } : { key: ref.key, path: [...parent, k] }
      const tspec = specOf(target)
      if (!holds(getRef(values, target), allowed)) out.push({ ref: target, allowed, multi: tspec?.type === 'multi', label: tspec?.label ?? k })
    }
  }
  return out
}

// ---------- 条件 ----------

export function test(v: unknown, t: Test): boolean {
  if ('eq' in t) return v === t.eq
  if ('in' in t) return t.in.includes(v as Scalar)
  if ('notIn' in t) return !isEmpty(v) && !t.notIn.includes(v as Scalar)
  if ('has' in t) return Array.isArray(v) && v.includes(t.has)
  if ('hasOther' in t) return Array.isArray(v) && v.some((x) => !t.hasOther.includes(x))
  if ('nonEmpty' in t) return !isEmpty(v)
  if ('empty' in t) return isEmpty(v)
  if ('startsWith' in t) return typeof v === 'string' && v.startsWith(t.startsWith)
  if ('rowWhere' in t) return Array.isArray(v) && v.some((r) => !!r && typeof r === 'object' && Object.entries(t.rowWhere).every(([k, tt]) => test((r as Record<string, unknown>)[k], tt)))
  if ('not' in t) return !test(v, t.not)
  return false
}

export function holdsCond(values: Values, c: Cond, own: Ref): boolean {
  if ('all' in c) return c.all.every((x) => holdsCond(values, x, own))
  if ('any' in c) return c.any.some((x) => holdsCond(values, x, own))
  return test(getRef(values, c.ref ?? own), c.is)
}

/** 表示で隠す前提: 前提の欄に別の値が入っているもの（空なら隠さない。AI が前提を書かなかった値も見えるように） */
export const conflicts = (values: Values, ref: Ref) => unmetRequires(values, ref).filter((n) => !isEmpty(getRef(values, n.ref)))

/**
 * 前提を満たすための直し。前提の欄が空なら、値が 1 つに決まるときは一緒に入れる。ほかの値が入っていれば理由を返す。
 * strict（対応の when）のときは、空で値が決まらなければ理由を返す（when は空でも隠すので）。
 */
function satisfy(d: Draft, needs: Need[], strict = false): string | null {
  for (const n of needs) {
    const cur = d.get(n.ref)
    if (!isEmpty(cur) && !n.multi) return `「${n.label}」が「${str(cur)}」なので書けません。先に「${n.label}」を直してください`
    if (n.allowed.length !== 1) {
      if (strict || !isEmpty(cur)) return `先に「${n.label}」を選んでください（${n.allowed.map(String).join('・')}）`
      continue
    }
    d.set(n.ref, n.multi ? [...(Array.isArray(cur) ? cur : []), n.allowed[0]] : n.allowed[0])
  }
  return null
}

/** when（strict）と前提（requires）の両方を満たす直しを下書きに入れる。だめなら理由 */
export function prepare(d: Draft, values: Values, when: Cond | undefined, ref: Ref): string | null {
  const w = whenNeeds(values, when, ref)
  if (typeof w === 'string') return w
  return satisfy(d, w, true) ?? satisfy(d, unmetRequires(values, ref))
}

/** 対応の when を、前提と同じ形（ref が 1 つ、値の一覧）にできれば直す。できなければ理由 */
function whenNeeds(values: Values, c: Cond | undefined, own: Ref): Need[] | string {
  if (!c || holdsCond(values, c, own)) return []
  if ('is' in c && c.ref && !same(c.ref, own)) {
    const allowed = 'eq' in c.is ? [c.is.eq] : 'in' in c.is ? c.is.in : 'has' in c.is ? [c.is.has] : null
    const s = specOf(c.ref)
    if (allowed) return [{ ref: c.ref, allowed, multi: s?.type === 'multi', label: s?.label ?? c.ref.key }]
  }
  return 'この欄は、いまの値では書けません'
}
