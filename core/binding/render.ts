
import type { Values, Binding, Bindings } from './types.ts'
import { getRef, isEmpty, str } from './values.ts'
import { specOf, test, holdsCond, conflicts } from './conditions.ts'
import { parseIso, eraOf, yearText, ageAt } from './dates.ts'




// ---------- 表示 ----------

export const RHYTHM_MARK = (choice: string) => choice.charAt(0)

export function labelOf(row: Record<string, unknown>, label: NonNullable<Extract<Binding, { op: 'join@1' }>['label']>): string {
  const v = str(row[label.of])
  if (label.map) return label.map[v] ?? ''
  if (label.strip) return v.replace(new RegExp(label.strip), '')
  return v
}

function joinRows(values: Values, b: Extract<Binding, { op: 'join@1' }>): Record<string, unknown>[] {
  const rows = getRef(values, b.ref)
  return (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === 'object' && Object.entries(b.where).every(([k, t]) => test((r as Record<string, unknown>)[k], t)))
}
export const joinToken = (row: Record<string, unknown>, b: Extract<Binding, { op: 'join@1' }>) => (b.show ? str(row[b.show]) : '') || (b.label ? labelOf(row, b.label) : '')
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
