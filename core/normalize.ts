// AI が書いた値を、fields.json の形にそろえる（型の確かめの前に通す）。
//   1 日のスケジュール: 時刻を "0"〜"23" の時にし、同じ時の行は 1 行にまとめる（fields.json の決め: 1 時間 1 行）
type Row = Record<string, unknown>

const TEXT_SUBS = ['rhythm', 'selfOrWish', 'family', 'service']

function hourOf(t: unknown): string | null {
  const n = Number.parseInt(String(t ?? '').normalize('NFKC'), 10)
  return Number.isInteger(n) && n >= 0 && n <= 23 ? String(n) : null
}

function mergeSchedule(rows: Row[]): Row[] {
  const byHour = new Map<string, Row>()
  const rest: Row[] = []
  for (const r of rows) {
    const h = hourOf(r.time)
    if (h === null) { rest.push({ ...r, time: null }); continue }
    const cur = byHour.get(h)
    if (!cur) { byHour.set(h, { ...r, time: h }); continue }
    for (const k of TEXT_SUBS) {
      const a = typeof cur[k] === 'string' ? (cur[k] as string) : ''
      const b = typeof r[k] === 'string' ? (r[k] as string) : ''
      cur[k] = [a, b].filter(Boolean).join('／') || null
    }
    const marks = [...new Set([...(Array.isArray(cur.rhythmMark) ? cur.rhythmMark : []), ...(Array.isArray(r.rhythmMark) ? r.rhythmMark : [])])]
    cur.rhythmMark = marks.length ? marks : null
    cur.plan = cur.plan ?? r.plan ?? null
  }
  return [...[...byHour.values()].sort((a, b) => Number(a.time) - Number(b.time)), ...rest]
}

export function normalizeValue(key: string, value: unknown): unknown {
  if (key === 'dailySchedule' && Array.isArray(value)) return mergeSchedule(value as Row[])
  return value
}

const isBlank = (v: unknown) => v === null || v === undefined || v === ''

/** まとまりの欄（object・list）の空の項目（null・undefined・空文字）を落とす。表の行そのものは落とさない */
export function compactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => !isBlank(v)).map(([k, v]) => [k, compactValue(v)]))
  }
  return value
}
