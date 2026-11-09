// 長い文章の欄の「文ごとの差分」（キャンバスの部品 DiffField と同じ作り方）。
// 前の文（保存した文）と今の文を「。」で区切って比べ、続けて変わった文を 1 か所にまとめる。
// 書き換えた文は、同じ頭の部分と最後の「。」を外して、変わった言葉だけを印にする。

export interface Hunk {
  /** 今の文の中の位置 [s, e) */
  s: number
  e: number
  /** 前の文にあった部分 */
  del: string
  /** 今の文の部分 */
  ins: string
  /** ① ② … */
  n: string
  kind: '文を足した' | '文を消した' | '文を書き換え'
}

export function splitSentences(t: string): string[] {
  return t ? (t.match(/[^。]*。|[^。]+$/g) ?? []) : []
}

const NO = '①②③④⑤⑥⑦⑧⑨⑩'

export function sentenceDiff(before: string, after: string): Hunk[] {
  const a = splitSentences(before), b = splitSentences(after)
  const n = a.length, m = b.length
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out: { s: number, e: number, del: string, ins: string }[] = []
  let i = 0, j = 0, pos = 0
  let cur: { s: number, e: number, del: string, ins: string } | null = null
  const flush = () => { if (cur) { out.push(cur); cur = null } }
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { flush(); pos += b[j].length; i++; j++ }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) {
      cur ??= { s: pos, e: pos, del: '', ins: '' }
      cur.ins += b[j]; pos += b[j].length; cur.e = pos; j++
    } else {
      cur ??= { s: pos, e: pos, del: '', ins: '' }
      cur.del += a[i]; i++
    }
  }
  flush()
  return out.map((h0, k) => {
    let h = h0
    if (h.del && h.ins) {
      let pre = 0
      while (pre < h.del.length && pre < h.ins.length && h.del[pre] === h.ins[pre]) pre++
      const suf = h.del.length > pre && h.ins.length > pre && h.del.endsWith('。') && h.ins.endsWith('。') ? 1 : 0
      h = { s: h.s + pre, e: h.e - suf, del: h.del.slice(pre, h.del.length - suf), ins: h.ins.slice(pre, h.ins.length - suf) }
    }
    return { ...h, n: NO[k] ?? String(k + 1), kind: !h.del ? '文を足した' : !h.ins ? '文を消した' : '文を書き換え' }
  })
}

/** 1 か所だけを前の文に戻した、今の文 */
export function revertHunk(current: string, h: Pick<Hunk, 's' | 'e' | 'del'>): string {
  return current.slice(0, h.s) + h.del + current.slice(h.e)
}

/**
 * 1 か所だけを保存したときの「保存した文」: 今の文から、ほかの変わったところを前の文に戻したもの。
 * 前の文と今の文から計算するので、画面から保存後の文を受け取らない。
 */
export function saveOneHunk(saved: string, current: string, index: number): string {
  const hunks = sentenceDiff(saved, current)
  if (index < 0 || index >= hunks.length) return saved
  let text = current
  for (let k = hunks.length - 1; k >= 0; k--) if (k !== index) text = revertHunk(text, hunks[k])
  return text
}
