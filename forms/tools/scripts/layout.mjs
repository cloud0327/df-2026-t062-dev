// layout.json（scripts/extract_layout.py の出力）を読み、書類の文字を目印にして欄の位置を探す道具。
// ブラウザでも読めるように node:fs は使わない（layout.json を読むのは scripts/load-layout.mjs）。
// 単位は mm、各ページの左上が原点。

/** 同じ行とみなす縦のずれ（mm） */
const LINE_TOL = 0.9;

function groupLines(chars) {
  const sorted = [...chars].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lines = [];
  for (const c of sorted) {
    const yc = (c.y0 + c.y1) / 2;
    let line = lines.find((l) => Math.abs(l.yc - yc) <= LINE_TOL);
    if (!line) {
      line = { yc, chars: [] };
      lines.push(line);
    }
    line.chars.push(c);
  }
  for (const l of lines) {
    l.chars.sort((a, b) => a.x0 - b.x0);
    l.text = l.chars.map((c) => c.t).join('');
  }
  return lines.sort((a, b) => a.yc - b.yc);
}

const inside = (b, r) => !r || (b.x0 >= r.x0 - 0.01 && b.x1 <= r.x1 + 0.01 && b.y0 >= r.y0 - 0.01 && b.y1 <= r.y1 + 0.01);

function bboxOf(chars) {
  return {
    x0: Math.min(...chars.map((c) => c.x0)),
    y0: Math.min(...chars.map((c) => c.y0)),
    x1: Math.max(...chars.map((c) => c.x1)),
    y1: Math.max(...chars.map((c) => c.y1)),
  };
}

export class LayoutPage {
  constructor(page) {
    this.n = page.page;
    this.width = page.width;
    this.height = page.height;
    this.chars = page.chars; // 文字ごとの枠・基準線 b・大きさ s・インクの範囲 ink（scripts/align.mjs が使う）
    this.lines = groupLines(page.chars);
    this.hlines = page.hlines;
    this.vlines = page.vlines;
  }

  /**
   * 文字列 text が書かれている場所を全部返す（上から下、左から右の順）。
   * 1 行の中で文字をつなげて探す（行をまたぐ文字列は探せない）。
   * opts.in: { x0, y0, x1, y1 } の範囲の中だけを探す
   */
  findAll(text, opts = {}) {
    const hits = [];
    for (const line of this.lines) {
      let from = 0;
      for (;;) {
        const i = line.text.indexOf(text, from);
        if (i < 0) break;
        const chars = line.chars.slice(i, i + text.length);
        const b = { ...bboxOf(chars), chars, line };
        if (inside(b, opts.in)) hits.push(b);
        from = i + 1;
      }
    }
    return hits;
  }

  /** text の場所。opts.nth 番目（0 から）。見つからなければエラー */
  find(text, opts = {}) {
    const hits = this.findAll(text, opts);
    const nth = opts.nth ?? 0;
    if (!hits[nth]) {
      const where = opts.in ? ` 範囲 ${JSON.stringify(opts.in)}` : '';
      throw new Error(`p${this.n}: 「${text}」が見つかりません（${nth} 番目${where}、見つかった数 ${hits.length}）`);
    }
    return hits[nth];
  }

  /** text の直前にある「□」の場所（同じ行で、text の左 4mm 以内） */
  boxBefore(text, opts = {}) {
    const hit = this.find(text, opts);
    const idx = hit.line.chars.indexOf(hit.chars[0]);
    for (let i = idx - 1; i >= 0; i--) {
      const c = hit.line.chars[i];
      if (hit.chars[0].x0 - c.x1 > 4) break;
      if (c.t === '□') return { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 };
    }
    throw new Error(`p${this.n}: 「${text}」の前に □ がありません`);
  }

  /** 「□」の場所を全部返す（opts.in で範囲を絞れる） */
  boxes(opts = {}) {
    return this.findAll('□', opts);
  }
}

// ---------- 欄を作る関数（入院時情報提供書と同じ見た目） ----------
export const FONT = 'BIZUDPGothic';
export const INK = '#1a3fa0';
const r2 = (n) => Math.round(n * 100) / 100;

/** 文字の欄 */
export function textSlot(name, x, y, w, h, opts = {}) {
  return {
    name,
    type: 'text',
    content: '',
    position: { x: r2(x), y: r2(y) },
    width: r2(w),
    height: r2(h),
    fontName: FONT,
    fontSize: opts.size ?? 9,
    alignment: opts.align ?? 'left',
    verticalAlignment: opts.valign ?? 'middle',
    lineHeight: opts.lineHeight ?? 1.1,
    characterSpacing: 0,
    fontColor: INK,
    ...(opts.fit ? { dynamicFontSize: { min: opts.minSize ?? 5, max: opts.size ?? 9, fit: opts.fit } } : {}),
  };
}

/** 印刷済みの「□」（box は boxBefore などの戻り値）の上に ✓ を置く欄 */
export function checkSlot(name, box) {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const size = Math.max(w, h) + 0.3;
  return {
    name,
    type: 'text',
    content: '',
    position: { x: r2(box.x0 + w / 2 - size / 2), y: r2(box.y0 + h / 2 - size / 2) },
    width: r2(size),
    height: r2(size),
    fontName: FONT,
    fontSize: Math.min(10, Math.round(size * 3.4 * 10) / 10),
    alignment: 'center',
    verticalAlignment: 'middle',
    lineHeight: 1,
    characterSpacing: 0,
    fontColor: INK,
  };
}

/** 印刷済みの文字（hit は find の戻り値）を丸で囲む欄。pad は文字の周りの余白（mm） */
export function circleSlot(name, hit, pad = 0.6) {
  const w = hit.x1 - hit.x0 + pad * 2;
  const h = Math.max(hit.y1 - hit.y0 + pad, w > 6 ? 3.6 : 0);
  const cx = (hit.x0 + hit.x1) / 2;
  const cy = (hit.y0 + hit.y1) / 2;
  const hh = Math.max(h, 3.4);
  return {
    name,
    type: 'circleMark',
    content: 'false',
    position: { x: r2(cx - w / 2), y: r2(cy - hh / 2) },
    width: r2(w),
    height: r2(hh),
    rotate: 0,
    opacity: 1,
    color: INK,
    borderWidth: 0.3,
  };
}

// ---------- 値を作る小さな関数（変換で使う） ----------
export const CHECK = '✓';
export const ck = (b) => (b ? CHECK : '');
export const mark = (b) => (b ? 'true' : 'false');
export const s = (v) => (v === undefined || v === null ? '' : String(v));

const ERAS = [
  { name: '令和', short: 'R', start: '2019-05-01' },
  { name: '平成', short: 'H', start: '1989-01-08' },
  { name: '昭和', short: 'S', start: '1926-12-25' },
  { name: '大正', short: 'T', start: '1912-07-30' },
  { name: '明治', short: 'M', start: '1868-01-25' },
];
export function parseDate(v) {
  const m = v && /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? { y: +m[1], m: +m[2], d: +m[3], iso: m[0] } : null;
}
export function wareki(dt) {
  const era = ERAS.find((e) => dt.iso >= e.start);
  return { era, year: dt.y - +era.start.slice(0, 4) + 1 };
}
/** 和暦の略号つきの年（R8）、月、日 */
export function ymdParts(v) {
  const dt = parseDate(v);
  if (!dt) return { y: '', m: '', d: '' };
  const w = wareki(dt);
  return { y: `${w.era.short}${w.year}`, m: String(dt.m), d: String(dt.d) };
}
export function ageAt(birth, ref) {
  const b = parseDate(birth);
  const r = parseDate(ref);
  if (!b || !r) return '';
  let a = r.y - b.y;
  if (r.m < b.m || (r.m === b.m && r.d < b.d)) a -= 1;
  return String(a);
}
