// 印字欄の対応（bindings）と、共通の変換。様式ごとの手書きのコードを使わず、対応のデータだけで動く。
//   renderAll … 欄の値 → 印字欄の文字（PDF・画面の表示）
//   editSlot  … 印字欄を直した文字 → 欄の値の変更、または断る理由
//   keysOf    … その印字欄が読む key（印・保存の範囲）
//
// 対応は「印字欄の名前 → Binding」の JSON（forms/seed/<様式>/bindings.json）。op は名前に版を付け、一度出した動きは変えない。
// 前提（fields.json の requires）と詳しい欄（detail）は fields.json から読むので、対応には書かない。



import { ERAS, parseIso, toIso, eraOf, eraYear, parseYear, onCalendar, yearText, ageAt } from './binding/dates.ts'

import type { Ymd } from './binding/dates.ts'
export { parseYear } from './binding/dates.ts'


import { BY_KEY, choicesOf, subFieldsOf, type FieldSpec } from './fields.ts'
import { validValue } from './schema.ts'
import type { Values, Change, Scalar, Step, Ref, Test, Cond, Action, EraShort, Binding, Bindings, EditResult } from './binding/types.ts'
export type { Values, Change, Scalar, Step, Ref, Test, Cond, Action, EraShort, Binding, Bindings, EditResult } from './binding/types.ts'

import { isEmpty, str, toHalf, same, getRef, Misplaced, Draft } from './binding/values.ts'
export { isEmpty, getRef } from './binding/values.ts'



// ---------- fields.json の型と前提 ----------

/** ref の場所の欄・項目の定義と、その項目が入っているまとまり（前提を見る相手）の場所 */
function specsAlong(ref: Ref): { spec: FieldSpec, parent: Step[] | null }[] {
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
const conflicts = (values: Values, ref: Ref) => unmetRequires(values, ref).filter((n) => !isEmpty(getRef(values, n.ref)))

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
function prepare(d: Draft, values: Values, when: Cond | undefined, ref: Ref): string | null {
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


// ---------- 表示 ----------

const RHYTHM_MARK = (choice: string) => choice.charAt(0)

function labelOf(row: Record<string, unknown>, label: NonNullable<Extract<Binding, { op: 'join@1' }>['label']>): string {
  const v = str(row[label.of])
  if (label.map) return label.map[v] ?? ''
  if (label.strip) return v.replace(new RegExp(label.strip), '')
  return v
}

function joinRows(values: Values, b: Extract<Binding, { op: 'join@1' }>): Record<string, unknown>[] {
  const rows = getRef(values, b.ref)
  return (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === 'object' && Object.entries(b.where).every(([k, t]) => test((r as Record<string, unknown>)[k], t)))
}
const joinToken = (row: Record<string, unknown>, b: Extract<Binding, { op: 'join@1' }>) => (b.show ? str(row[b.show]) : '') || (b.label ? labelOf(row, b.label) : '')

/** 1 つの印字欄の文字。丸は 'true'/'false'、✓ の欄は '✓'/'' */
export function renderSlot(b: Binding, values: Values): string {
  const off = b.op === 'option@1' || b.op === 'era@1' ? (b.ui === 'circle' ? 'false' : '') : ''
  if ('when' in b && b.when && !holdsCond(values, b.when, b.ref)) return off
  if (b.op !== 'option@1' && b.op !== 'join@1' && conflicts(values, b.ref).length) return off
  switch (b.op) {
    case 'text@1': {
      const spec = specOf(b.ref)
      let t = ''
      if (spec?.detail) {
        const parent = b.ref.path?.slice(0, -1) ?? []
        t = str(getRef(values, { key: b.ref.key, path: [...parent, spec.detail] }))
      }
      t ||= str(getRef(values, b.ref))
      for (const alt of b.or ?? []) {
        if (t) break
        t = 'concat' in alt ? (str(getRef(values, alt.concat[0])) ? alt.concat.map((r) => str(getRef(values, r))).join('') : '') : str(getRef(values, alt))
      }
      if (b.prefix) {
        const row = getRef(values, { key: b.ref.key, path: b.ref.path?.slice(0, -1) }) as Record<string, unknown> | undefined
        if (row?.[b.prefix.flag] === true) t = b.prefix.text + t
      }
      return t
    }
    case 'option@1': {
      if (!b.is && !b.if) return off
      const on = b.if ? holdsCond(values, b.if, b.ref) : test(getRef(values, b.ref), b.is!) && !conflicts(values, b.ref).length
      return on ? (b.ui === 'circle' ? 'true' : '✓') : off
    }
    case 'symbol@1': {
      const v = getRef(values, b.ref)
      return b.options.find((o) => o.value === v)?.text ?? ''
    }
    case 'date@1': {
      const p = parseIso(getRef(values, b.ref))
      if (!p) return ''
      if (b.part === 'y') return yearText(p, b.year ?? 'short')
      if (b.part === 'm') return p.m === undefined ? '' : String(p.m)
      return p.d === undefined ? '' : String(p.d)
    }
    case 'era@1': {
      const p = parseIso(getRef(values, b.ref))
      return p && eraOf(p).short === b.era ? 'true' : 'false'
    }
    case 'rhythm@1': {
      const row = getRef(values, b.ref) as Record<string, unknown> | undefined
      if (!row) return ''
      const marks = (Array.isArray(row[b.marks]) ? (row[b.marks] as unknown[]) : []).map((m) => RHYTHM_MARK(str(m))).join('')
      return [marks, str(row[b.text])].filter((x) => x !== '').join(' ')
    }
    case 'ageAt@1': {
      const own = str(getRef(values, b.ref))
      if (own) return own
      const at = b.at.map((r) => getRef(values, r)).find((x) => !isEmpty(x))
      return ageAt(getRef(values, b.birth), at)
    }
    case 'join@1':
      return joinRows(values, b).map((r) => joinToken(r, b)).filter(Boolean).join(b.sep)
  }
}

export function renderAll(bindings: Bindings, values: Values): Record<string, string> {
  return Object.fromEntries(Object.entries(bindings).map(([slot, b]) => [slot, renderSlot(b, values)]))
}

// ---------- 直し ----------

const refuse = (reason: string): EditResult => ({ reason })
const done = (d: Draft): EditResult => ({ changes: d.changes() })

/** 型どおりか（直した結果を確かめる）。日付はケアマネの直しなので、年だけ・年月だけも通す */
function badValues(d: Draft): string | null {
  for (const c of d.changes()) if (c.value !== null && !validValue(c.key, c.value)) return `「${BY_KEY.get(c.key)?.label ?? c.key}」の値になりません`
  return null
}

function editText(b: Extract<Binding, { op: 'text@1' }>, values: Values, text: string): EditResult {
  const d = new Draft(values)
  const spec = specOf(b.ref)
  let t = text.trim()
  const path = b.ref.path ?? []
  const rowPath = path.slice(0, -1)
  const last = path.at(-1)
  const flagStep = rowPath.at(-1)

  // 印の付いた行の名前: 同じ名前の家族に印を移すか、新しい家族を足す
  if (flagStep && typeof flagStep === 'object' && 'flag' in flagStep && last === 'name') {
    const rows = Array.isArray(values[b.ref.key]) ? [...(values[b.ref.key] as Record<string, unknown>[])] : []
    const parentPath = rowPath.slice(0, -1)
    if (parentPath.length) return refuse('この欄は直せません')
    const unflag = rows.map((r) => {
      if (r?.[flagStep.flag] !== true) return r
      const { [flagStep.flag]: _drop, ...rest } = r
      return rest
    })
    if (t === '') { d.set({ key: b.ref.key }, unflag); return done(d) }
    const i = unflag.findIndex((r) => str(r?.name) === t)
    if (i >= 0) unflag[i] = { ...unflag[i], [flagStep.flag]: true }
    else unflag.push({ name: t, [flagStep.flag]: true })
    d.set({ key: b.ref.key }, unflag)
    return done(d)
  }

  if (t !== '') {
    const why = prepare(d, values, b.when, b.ref)
    if (why) return refuse(why)
  }

  if (b.prefix) {
    const flagRef: Ref = { key: b.ref.key, path: [...rowPath, b.prefix.flag] }
    if (t.startsWith(b.prefix.text)) { t = t.slice(b.prefix.text.length).trim(); d.set(flagRef, true) } else if (d.get(flagRef) === true) d.set(flagRef, null)
  }

  if (spec?.detail) {
    const detailRef: Ref = { key: b.ref.key, path: [...rowPath, spec.detail] }
    if (t === '' || choicesOf(spec).includes(t)) { d.set(b.ref, t === '' ? null : t); d.set(detailRef, null) } else d.set(detailRef, t)
    return badValues(d) ? refuse(badValues(d)!) : done(d)
  }

  if (spec?.type === 'number') {
    const n = toHalf(t)
    if (n === '') d.set(b.ref, null)
    else if (/^-?\d+(\.\d+)?$/.test(n)) d.set(b.ref, Number(n))
    else return refuse('数字で書いてください')
  } else if (spec?.type === 'enum') {
    if (t !== '' && !choicesOf(spec).includes(t)) return refuse(`${choicesOf(spec).join('・')} のどれかを書いてください`)
    d.set(b.ref, t === '' ? null : t)
  } else d.set(b.ref, t === '' ? null : t)
  const bad = badValues(d)
  return bad ? refuse(bad) : done(d)
}

function canToggle(t: Test | undefined): boolean {
  if (!t) return false
  if ('eq' in t || 'has' in t) return true
  if ('rowWhere' in t) {
    const e = Object.values(t.rowWhere)
    return e.length === 1 && ('eq' in e[0] || ('in' in e[0] && e[0].in.length === 1))
  }
  return false
}

function editOption(b: Extract<Binding, { op: 'option@1' }>, values: Values, on: boolean): EditResult {
  const now = renderSlot(b, values) === (b.ui === 'circle' ? 'true' : '✓')
  if (now === on) return { changes: [] }
  const d = new Draft(values)
  if (b.edit) {
    const a = on ? b.edit.on : b.edit.off
    if ('refuse' in a) return refuse(a.refuse)
    if (on) {
      const why = prepare(d, values, b.when, b.ref)
      if (why) return refuse(why)
    }
    for (const s of a.set) d.set(s.ref ?? b.ref, s.value)
    return done(d)
  }
  const t = b.is
  if (!t || !canToggle(t)) return refuse('この欄は直せません')
  if (on) {
    const why = prepare(d, values, b.when, b.ref)
    if (why) return refuse(why)
  }
  const cur = d.get(b.ref)
  if ('eq' in t) d.set(b.ref, on ? t.eq : null)
  else if ('has' in t) {
    const arr = Array.isArray(cur) ? cur.filter((x) => x !== t.has) : []
    d.set(b.ref, on ? [...arr, t.has] : arr)
  } else if ('rowWhere' in t) {
    const [[sub, tt]] = Object.entries(t.rowWhere)
    const v = 'eq' in tt ? tt.eq : (tt as { in: Scalar[] }).in[0]
    const rows = Array.isArray(cur) ? cur : []
    d.set(b.ref, on ? [...rows, { [sub]: v }] : rows.filter((r) => !(r && typeof r === 'object' && test((r as Record<string, unknown>)[sub], tt))))
  }
  return done(d)
}

function editSymbol(b: Extract<Binding, { op: 'symbol@1' }>, values: Values, text: string): EditResult {
  const t = toHalf(text)
  const d = new Draft(values)
  const cur = getRef(values, b.ref)
  if (t === '') {
    if (b.options.some((o) => o.value === cur)) d.set(b.ref, null)
    return done(d)
  }
  const opt = b.options.find((o) => o.text === t) ?? (b.options.length === 1 && (t === 'true' || t === '✓') ? b.options[0] : undefined)
  if (!opt) return refuse(`${b.options.map((o) => `「${o.text}」`).join('か')}を書いてください`)
  const why = prepare(d, values, b.when, b.ref)
  if (why) return refuse(why)
  d.set(b.ref, opt.value)
  return done(d)
}

function editDate(b: Extract<Binding, { op: 'date@1' }>, values: Values, text: string): EditResult {
  const d = new Draft(values)
  const cur = parseIso(getRef(values, b.ref))
  const t = toHalf(text)
  let next: Ymd | null
  if (b.part === 'y') {
    if (t === '') next = null
    else {
      const y = parseYear(t, cur && b.year === 'number' ? eraOf(cur).short : undefined)
      if (y === null) return refuse(b.year === 'number' ? '元号に丸を付けてから年を書くか、S5 のように書いてください' : 'R3・平成5・2021 のように書いてください')
      next = { y, m: cur?.m, d: cur?.d }
    }
  } else {
    let base = cur
    if (!base) {
      const from = (b.yearFrom ?? []).map((r) => parseIso(getRef(values, r))).find(Boolean)
      if (from) base = { y: from.y }
    }
    if (t === '') next = cur ? (b.part === 'm' ? { y: cur.y } : { y: cur.y, m: cur.m }) : null
    else {
      const n = Number(t)
      if (!/^\d{1,2}$/.test(t)) return refuse('数字で書いてください')
      if (!base) return refuse('先に年を書いてください')
      if (b.part === 'm') next = { y: base.y, m: n, d: base.d }
      else {
        if (base.m === undefined) return refuse('先に月を書いてください')
        next = { y: base.y, m: base.m, d: n }
      }
    }
  }
  if (next && !onCalendar(next)) return refuse('暦にない日付です')
  if (next) {
    const why = prepare(d, values, b.when, b.ref)
    if (why) return refuse(why)
  }
  d.set(b.ref, next ? toIso(next) : null)
  return done(d)
}

function editEra(b: Extract<Binding, { op: 'era@1' }>, values: Values, on: boolean): EditResult {
  const cur = parseIso(getRef(values, b.ref))
  if (!on) return cur && eraOf(cur).short === b.era ? refuse('別の元号に丸を付けてください') : { changes: [] }
  if (!cur) return refuse('先に年を書いてください（S5 のように元号と一緒に書けます）')
  const e = ERAS.find((x) => x.short === b.era)!
  const y = Number(e.start.slice(0, 4)) + eraYear(cur) - 1
  const next = { ...cur, y }
  if (!onCalendar(next)) return refuse('暦にない日付です')
  const d = new Draft(values)
  d.set(b.ref, toIso(next))
  return done(d)
}

function editRhythm(b: Extract<Binding, { op: 'rhythm@1' }>, values: Values, text: string): EditResult {
  const spec = specOf({ key: b.ref.key, path: [...(b.ref.path ?? []), b.marks] })
  const choices = spec ? choicesOf(spec) : []
  let t = text.trim()
  const marks: string[] = []
  while (t) {
    const c = choices.find((x) => RHYTHM_MARK(x) === t.charAt(0))
    if (!c) break
    if (!marks.includes(c)) marks.push(c)
    t = t.slice(1)
  }
  const d = new Draft(values)
  d.set({ key: b.ref.key, path: [...(b.ref.path ?? []), b.marks] }, marks.length ? marks : null)
  d.set({ key: b.ref.key, path: [...(b.ref.path ?? []), b.text] }, t.trim() || null)
  return done(d)
}

function editAge(b: Extract<Binding, { op: 'ageAt@1' }>, values: Values, text: string): EditResult {
  const birth = parseIso(getRef(values, b.birth))
  if (birth?.d !== undefined && b.at.some((r) => !isEmpty(getRef(values, r)))) return refuse('生年月日から計算しています。生年月日を直してください')
  const t = toHalf(text)
  const d = new Draft(values)
  if (t === '') d.set(b.ref, null)
  else if (/^\d{1,3}$/.test(t)) d.set(b.ref, Number(t))
  else return refuse('数字で書いてください')
  return done(d)
}

function editJoin(b: Extract<Binding, { op: 'join@1' }>, values: Values, text: string): EditResult {
  const list = getRef(values, b.ref)
  const rows = (Array.isArray(list) ? list : []) as Record<string, unknown>[]
  const inGroup = (r: Record<string, unknown>) => Object.entries(b.where).every(([k, t]) => test(r?.[k], t))
  const keep = rows.filter((r) => !inGroup(r))
  const pool = rows.filter(inGroup)
  const kindSub = b.label?.of
  const spec = kindSub ? specOf({ key: b.ref.key, path: [...(b.ref.path ?? []), 0, kindSub] }) : undefined
  const kinds = spec ? choicesOf(spec).filter((k) => Object.entries(b.where).every(([s, t]) => s !== kindSub || test(k, t))) : []
  const out: Record<string, unknown>[] = []
  for (const token of text.split(/[、,，]/).map((x) => x.trim()).filter(Boolean)) {
    const i = pool.findIndex((r) => joinToken(r, b) === token)
    if (i >= 0) { out.push(pool.splice(i, 1)[0]); continue }
    const k = kindSub && b.label ? kinds.find((x) => token.startsWith(labelOf({ [kindSub]: x }, b.label!)) && labelOf({ [kindSub]: x }, b.label!) !== '') : undefined
    if (!k || !kindSub) return refuse(`${kinds.map((x) => labelOf({ [kindSub!]: x }, b.label!)).filter(Boolean).join('・')} のどれかで始めてください`)
    const label = labelOf({ [kindSub]: k }, b.label!)
    out.push(b.show && token !== label ? { [kindSub]: k, [b.show]: token } : { [kindSub]: k })
  }
  const d = new Draft(values)
  d.set(b.ref, [...keep, ...out])
  const bad = badValues(d)
  return bad ? refuse(bad) : done(d)
}

/**
 * 印字欄 slot を text にしたときの、欄の値の変更（または断る理由）。
 * text は、丸なら 'true'/'false'、✓ の欄なら '✓'/''、文字の欄なら打った文字。
 * 今の表示と同じ文字を打ち直したときは、何も変えない。
 */
export function editSlot(bindings: Bindings, values: Values, slot: string, text: string): EditResult {
  const b = bindings[slot]
  if (!b) return refuse('この欄は直せません')
  if (renderSlot(b, values) === text) return { changes: [] }
  try {
    return editBy(b, values, text)
  } catch (e) {
    if (e instanceof Misplaced) return refuse('上の行から順に書いてください')
    throw e
  }
}

function editBy(b: Binding, values: Values, text: string): EditResult {
  const on = text === 'true' || text === '✓'
  switch (b.op) {
    case 'text@1': return editText(b, values, text)
    case 'option@1': return editOption(b, values, on)
    case 'symbol@1': return editSymbol(b, values, text)
    case 'date@1': return editDate(b, values, text)
    case 'era@1': return editEra(b, values, on)
    case 'rhythm@1': return editRhythm(b, values, text)
    case 'ageAt@1': return editAge(b, values, text)
    case 'join@1': return editJoin(b, values, text)
  }
}

// ---------- 読む key ----------

function condKeys(c: Cond | undefined, own: Ref, out: Set<string>) {
  if (!c) return
  if ('all' in c) c.all.forEach((x) => condKeys(x, own, out))
  else if ('any' in c) c.any.forEach((x) => condKeys(x, own, out))
  else out.add((c.ref ?? own).key)
}

/** その印字欄の表示が読む key（前提の欄も含む） */
export function keysOf(b: Binding): string[] {
  const out = new Set<string>([b.ref.key])
  if ('when' in b) condKeys(b.when, b.ref, out)
  if (b.op === 'option@1') {
    condKeys(b.if, b.ref, out)
    for (const a of [b.edit?.on, b.edit?.off]) if (a && 'set' in a) for (const s of a.set) out.add((s.ref ?? b.ref).key)
  }
  if (b.op === 'text@1') for (const alt of b.or ?? []) for (const r of 'concat' in alt ? alt.concat : [alt]) out.add(r.key)
  if (b.op === 'date@1') for (const r of b.yearFrom ?? []) out.add(r.key)
  if (b.op === 'ageAt@1') { out.add(b.birth.key); b.at.forEach((r) => out.add(r.key)) }
  for (const k of Object.keys(BY_KEY.get(b.ref.key)?.requires ?? {})) out.add(k)
  return [...out]
}

/** 様式が読む key の全部 */
export function formKeys(bindings: Bindings): string[] {
  const out = new Set<string>()
  for (const b of Object.values(bindings)) for (const k of keysOf(b)) out.add(k)
  return [...out].sort()
}

/** 対応の確かめ（読み込むときと CI）。key・項目が fields.json にあるか、丸・✓ の直しが決まっているか */
export function checkBindings(bindings: Bindings): string[] {
  const errors: string[] = []
  const refOk = (slot: string, r: Ref) => {
    if (!BY_KEY.has(r.key)) errors.push(`${slot}: fields.json にない key ${r.key}`)
    else {
      const names = (r.path ?? []).filter((s): s is string => typeof s === 'string')
      if (specsAlong(r).length !== names.length + 1) errors.push(`${slot}: ${r.key} に項目 ${names.join('.')} がない`)
    }
  }
  for (const [slot, b] of Object.entries(bindings)) {
    refOk(slot, b.ref)
    if (b.op === 'option@1' && !b.edit && !canToggle(b.is)) errors.push(`${slot}: 丸・✓ を付け外ししたときの動き（edit）が決まっていない`)
    if (b.op === 'option@1' && !b.is && !b.if) errors.push(`${slot}: 丸・✓ を付ける条件がない`)
    if (b.op === 'text@1') for (const alt of b.or ?? []) for (const r of 'concat' in alt ? alt.concat : [alt]) refOk(slot, r)
    if (b.op === 'ageAt@1') { refOk(slot, b.birth); b.at.forEach((r) => refOk(slot, r)) }
  }
  return errors
}
