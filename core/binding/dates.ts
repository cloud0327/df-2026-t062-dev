
import type { EraShort } from './types.ts'
import { toHalf } from './values.ts'

// ---------- 日付 ----------

export const ERAS: { name: string, short: EraShort, one: string, start: string }[] = [
  { name: '令和', short: 'R', one: '令', start: '2019-05-01' },
  { name: '平成', short: 'H', one: '平', start: '1989-01-08' },
  { name: '昭和', short: 'S', one: '昭', start: '1926-12-25' },
  { name: '大正', short: 'T', one: '大', start: '1912-07-30' },
  { name: '明治', short: 'M', one: '明', start: '1868-01-25' },
]

const DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/

export interface Ymd { y: number, m?: number, d?: number }

export function parseIso(v: unknown): Ymd | null {
  const m = typeof v === 'string' ? DATE.exec(v) : null
  return m ? { y: +m[1], m: m[2] ? +m[2] : undefined, d: m[3] ? +m[3] : undefined } : null
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

export function toIso(p: Ymd): string {
  return p.m === undefined ? pad(p.y, 4) : p.d === undefined ? `${pad(p.y, 4)}-${pad(p.m)}` : `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}`
}

/** 年だけ・年月だけのときは、その年（月）の終わりの元号 */
export function eraOf(p: Ymd) {
  const iso = `${pad(p.y, 4)}-${pad(p.m ?? 12)}-${pad(p.d ?? 31)}`
  return ERAS.find((e) => iso >= e.start) ?? ERAS[ERAS.length - 1]
}

export const eraYear = (p: Ymd) => p.y - Number(eraOf(p).start.slice(0, 4)) + 1

/** 「R3」「令和3」「平成元」「S5」「2021」→ 西暦の年。元号がなければ era を使う */
export function parseYear(text: string, era?: EraShort): number | null {
  const t = toHalf(text).toUpperCase().replace(/年$/, '')
  const m = /^(明治|大正|昭和|平成|令和|[明大昭平令]|[MTSHR])?\s*(元|\d{1,4})$/.exec(t)
  if (!m) return null
  const n = m[2] === '元' ? 1 : Number(m[2])
  if (!m[1] && n >= 1868) return n
  const e = m[1] ? ERAS.find((x) => x.name === m[1] || x.one === m[1] || x.short === m[1]) : ERAS.find((x) => x.short === era)
  return e ? Number(e.start.slice(0, 4)) + n - 1 : null
}

export function onCalendar(p: Ymd): boolean {
  if (p.m !== undefined && (p.m < 1 || p.m > 12)) return false
  if (p.d !== undefined) {
    const dt = new Date(Date.UTC(p.y, (p.m ?? 1) - 1, p.d))
    if (dt.getUTCMonth() !== (p.m ?? 1) - 1 || dt.getUTCDate() !== p.d) return false
  }
  return true
}

export function yearText(p: Ymd, style: 'short' | 'number' | 'nameUnlessMTS'): string {
  const e = eraOf(p)
  const n = eraYear(p)
  if (style === 'number') return String(n)
  if (style === 'nameUnlessMTS') return ['M', 'T', 'S'].includes(e.short) ? String(n) : `${e.name}${n}`
  return `${e.short}${n}`
}

export function ageAt(birth: unknown, at: unknown): string {
  const b = parseIso(birth)
  const r = parseIso(at)
  if (!b || !r || b.d === undefined || r.d === undefined || b.m === undefined || r.m === undefined) return ''
  let a = r.y - b.y
  if (r.m < b.m || (r.m === b.m && r.d < b.d)) a -= 1
  return String(a)
}
