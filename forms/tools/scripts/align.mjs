// 欄の位置を、書類の印刷に合わせてそろえる（テンプレートを作るときの最後の仕上げ）。
//
// pdfme が文字をどの高さに描くかは、欄の大きさ・文字の大きさ・フォントの寸法から決まった計算で出る。
// その計算を使って、印字のインクや基準線が、書類の □・文字・罫線にぴったり合うように欄を動かす。
//
//   ✓（□ の上に置く欄） … ✓ のインクの中心を、□ のインクの中心に合わせる
//   丸                     … 丸の中心を、囲む文字のインクの中心に合わせる
//   罫線の枠               … 各行の基準線を、罫線の GAP_RULED mm 上に合わせる（行の間隔も罫線に合わせる）
//   1 行の文字             … 基準線を、同じ行の書類の文字（「年」「歳）」など）の基準線に合わせる
//   マスの中央             … そろえる相手の文字がない 1 行の欄は、1 行分の高さの表のマスの上下中央に合わせる
//
// 書類の文字の基準線とインクの範囲は layout.json（scripts/extract_layout.py が測る）の b と ink。

const PT = 25.4 / 72; // 1pt = 0.3528mm

// BIZ UDP ゴシックの寸法（fontTools で読んだ値）
const UPM = 2048;
const ASC = 1802;
const DESC = -246;
const GLYPH = {
  '✓': { adv: 2048, xMin: 467, xMax: 1798, yMin: 111, yMax: 1489 },
  '○': { adv: 2048, xMin: 106, xMax: 1941, yMin: -139, yMax: 1696 },
  '△': { adv: 2048, xMin: 135, xMax: 1913, yMin: -41, yMax: 1665 },
};

/** 罫線と、その上に書く文字の基準線の間（mm） */
export const GAP_RULED = 1.2;
/** 丸で囲むときに、中心の計算から外す文字 */
const PUNCT = new Set(['・', '、', '。', '（', '）', '(', ')', '：', ':', '□', '〔', '〕', '［', '］']);

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * pdfme が 1 行目の基準線を描く高さ（欄の上端から、mm）。
 * @pdfme/schemas の text の描画（verticalAlignment ごとの yOffset）と同じ計算。
 */
export function baselineFromTop(slot, nLines = 1, fontSize = slot.fontSize) {
  const fs = fontSize;
  const H = slot.height / PT;
  const lh = slot.lineHeight ?? 1;
  const asc = (ASC / UPM) * fs; // heightOfFontAtSize
  const desc = (DESC / UPM) * fs; // getFontDescentInPt（負の値）
  const va = slot.verticalAlignment ?? 'top';
  let y;
  if (va === 'top') y = asc + ((lh - 1) * fs) / 2;
  else {
    const other = lh * fs * (nLines - 1);
    if (va === 'bottom') y = H - other + desc - ((lh - 1) * fs) / 2;
    else y = (H - other - asc + desc) / 2 + asc;
  }
  return y * PT;
}

/** 記号 1 文字（✓ など）を描いたときの、インクの中心（ページ上の mm） */
export function markInkCenter(slot, ch) {
  const g = GLYPH[ch];
  const em = slot.fontSize * PT;
  const textW = (g.adv / UPM) * em;
  const x0 = slot.alignment === 'center' ? slot.position.x + (slot.width - textW) / 2 : slot.alignment === 'right' ? slot.position.x + slot.width - textW : slot.position.x;
  const base = slot.position.y + baselineFromTop(slot);
  return { x: x0 + ((g.xMin + g.xMax) / 2 / UPM) * em, y: base - ((g.yMin + g.yMax) / 2 / UPM) * em };
}

const inkCenter = (c) => ({ x: (c.ink[0] + c.ink[2]) / 2, y: (c.ink[1] + c.ink[3]) / 2 });
const inRect = (p, x, y, w, h, m = 0) => p.x >= x - m && p.x <= x + w + m && p.y >= y - m && p.y <= y + h + m;

/** 2 つの x の間に、高さ y を通る縦の罫線があるか（別のマスか） */
function ruleBetween(P, xa, xb, y) {
  const [lo, hi] = xa < xb ? [xa, xb] : [xb, xa];
  return P.vlines.some((v) => v[0] > lo + 0.15 && v[0] < hi - 0.15 && v[1] <= y && v[2] >= y - 0.5);
}

function alignCheck(slot, P) {
  const c = { x: slot.position.x + slot.width / 2, y: slot.position.y + slot.height / 2 };
  const boxes = P.chars.filter((ch) => ch.t === '□' && ch.ink && inRect(inkCenter(ch), slot.position.x, slot.position.y, slot.width, slot.height, 0.6));
  if (!boxes.length) return null;
  const box = boxes.reduce((a, b) => (Math.hypot(inkCenter(a).x - c.x, inkCenter(a).y - c.y) <= Math.hypot(inkCenter(b).x - c.x, inkCenter(b).y - c.y) ? a : b));
  const want = inkCenter(box);
  const now = markInkCenter(slot, '✓');
  return { dx: want.x - now.x, dy: want.y - now.y };
}

function alignCircle(slot, P) {
  const { x, y } = slot.position;
  let under = P.chars.filter((ch) => ch.ink && !PUNCT.has(ch.t) && inRect(inkCenter(ch), x, y, slot.width, slot.height));
  if (!under.length) under = P.chars.filter((ch) => ch.ink && inRect(inkCenter(ch), x, y, slot.width, slot.height));
  if (!under.length) return null;
  const ink = [Math.min(...under.map((c) => c.ink[0])), Math.min(...under.map((c) => c.ink[1])), Math.max(...under.map((c) => c.ink[2])), Math.max(...under.map((c) => c.ink[3]))];
  const want = { x: (ink[0] + ink[2]) / 2, y: (ink[1] + ink[3]) / 2 };
  return { dx: want.x - (x + slot.width / 2), dy: want.y - (y + slot.height / 2) };
}

/** 罫線の枠なら、欄の中の罫線（高さの一覧）を返す */
function ruledLines(slot, P) {
  if (slot.verticalAlignment !== 'top') return null;
  const em = slot.fontSize * PT;
  const { x, y } = slot.position;
  const ys = [...new Set(P.hlines.filter((l) => l[0] > y + 0.6 * em && l[0] <= y + slot.height + em && Math.min(l[2], x + slot.width) - Math.max(l[1], x) >= 0.6 * slot.width).map((l) => Math.round(l[0] * 10) / 10))].sort((a, b) => a - b);
  const merged = ys.filter((v, i) => i === 0 || v - ys[i - 1] > 1.0);
  if (merged.length < 2) return null;
  const diffs = merged.slice(1).map((v, i) => v - merged[i]);
  const d = diffs.slice().sort((a, b) => a - b)[Math.floor(diffs.length / 2)];
  if (d < 1.4 * em || d > 4 * em) return null;
  if (diffs.some((v) => Math.abs(v - d) > 0.35)) return null;
  return { first: merged[0], last: merged[merged.length - 1], spacing: d };
}

function alignRuled(slot, P) {
  const rl = ruledLines(slot, P);
  if (!rl) return null;
  const lineHeight = rl.spacing / (slot.fontSize * PT);
  const tmp = { ...slot, lineHeight };
  const newY = rl.first - GAP_RULED - baselineFromTop(tmp, 1);
  // 枠の下端は、最後の罫線の少し下（全部の行が入るように）
  return { dy: newY - slot.position.y, lineHeight, height: rl.last + 0.5 - newY };
}

function alignInline(slot, P) {
  const em = slot.fontSize * PT;
  if (slot.height > 2.4 * em) return null; // 複数行の枠
  const { x, y } = slot.position;
  const w = slot.width;
  const h = slot.height;
  const cands = [];
  for (const c of P.chars) {
    if (c.b === undefined) continue;
    // 欄の文字と大きさが違いすぎる文字（2 行分の大きな括弧など）は、そろえる相手にしない
    if (c.s > 1.6 * em || c.s < 0.55 * em) continue;
    if (c.b < y + 0.15 * h || c.b > y + h + Math.max(0.8, 0.25 * em)) continue;
    let gap = null;
    if (c.x1 <= x + 0.6 && c.x1 >= x - 5) gap = x - c.x1;
    else if (c.x0 >= x + w - 0.6 && c.x0 <= x + w + 5) gap = c.x0 - (x + w);
    if (gap === null) continue;
    const xa = c.x1 <= x + 0.6 ? c.x1 : c.x0;
    const xb = c.x1 <= x + 0.6 ? x + 0.3 : x + w - 0.3;
    if (ruleBetween(P, xa, xb, c.b - 0.3 * c.s)) continue;
    // 間に大きな括弧などがあれば、別の段とみなす（例: 「□（　　）」の □ と、括弧の中の欄）
    const [lo, hi] = xa < xb ? [xa, xb] : [xb, xa];
    if (P.chars.some((t) => t.s > 1.6 * em && t.x1 > lo && t.x0 < hi && t.y0 < y + h && t.y1 > y)) continue;
    cands.push({ c, gap: Math.abs(gap) });
  }
  if (!cands.length) return null;
  const { c } = cands.reduce((a, b) => (a.gap <= b.gap ? a : b));
  // 文字が長くて自動で小さくなる欄は、下そろえにする。上下中央だと、小さくなったぶん基準線が上に浮く
  // （1pt 小さくなるごとに、上下中央は 0.38pt、下そろえは 0.17pt 動く）
  const va = slot.dynamicFontSize ? 'bottom' : slot.verticalAlignment;
  const nowBase = y + baselineFromTop({ ...slot, verticalAlignment: va });
  const dy = c.b - nowBase;
  if (Math.abs(dy) > 2.5) return { skipped: `基準線の差が大きい（${dy.toFixed(2)}mm、${c.t}）` };
  return { dy, verticalAlignment: va };
}

/**
 * 1 行分の高さの表のマスなら、文字（全角の字の枠）がマスの上下中央に来るように動かす。
 * 全角の字の枠は、基準線の 0.88em 上から 0.12em 下まで。その中央は基準線の 0.38em 上。
 */
function alignCell(slot, P) {
  const em = slot.fontSize * PT;
  // 上下中央で書く 1 行の欄だけ（上寄せの枠は、2 行以上になることがあるので動かさない）
  if (slot.height > 2.4 * em || slot.verticalAlignment !== 'middle') return null;
  const cx = slot.position.x + slot.width / 2;
  const cy = slot.position.y + slot.height / 2;
  const spans = (l) => l[1] <= cx && l[2] >= cx;
  const above = P.hlines.filter((l) => spans(l) && l[0] <= cy).map((l) => l[0]);
  const below = P.hlines.filter((l) => spans(l) && l[0] >= cy).map((l) => l[0]);
  if (!above.length || !below.length) return null;
  const top = Math.max(...above);
  const bottom = Math.min(...below);
  // 1 行分の高さのマスだけ（2 段で書くマスや、大きな枠の中の欄は動かさない）
  if (bottom - top > 2.6 * em + 0.5 || bottom - top < 0.9 * em) return null;
  // 同じマスの中に、欄の上や下に書類の文字がある（2 段で書くマス。例: 「〒」の行の下の住所）なら動かさない
  const { x, y } = slot.position;
  const otherRow = P.chars.some((c) => {
    if (!c.ink) return false;
    const p = inkCenter(c);
    return p.x >= x && p.x <= x + slot.width && p.y > top && p.y < bottom && (p.y < y || p.y > y + slot.height);
  });
  if (otherRow) return null;
  const wantBaseline = (top + bottom) / 2 + 0.38 * em;
  const dy = wantBaseline - (slot.position.y + baselineFromTop(slot));
  if (Math.abs(dy) < 0.05) return null;
  return { dy };
}

/**
 * schemas（ページごとの欄の配列）を、layout（scripts/layout.mjs の loadLayout）に合わせて動かす。
 * schemas は書き換えずに新しい配列を返す。report に、種類ごとの数と大きく動いた欄を入れる。
 */
export function alignSchemas(schemas, layout, { pageOffset = 0 } = {}) {
  const report = { '✓': [], 丸: [], 罫線の枠: [], '1 行の文字': [], マスの中央: [], そのまま: 0, 見送り: [] };
  const out = schemas.map((slots, i) => {
    if (!slots.length) return slots;
    const P = layout.page(i + 1 + pageOffset);
    return slots.map((s0) => {
      const s = structuredClone(s0);
      let res = null;
      let kind = null;
      if (s.type === 'circleMark') {
        res = alignCircle(s, P);
        kind = '丸';
      } else if (s.type === 'text') {
        if (s.width <= 6 && s.alignment === 'center' && Math.abs(s.width - s.height) < 0.6) {
          res = alignCheck(s, P);
          kind = '✓';
        }
        if (!res) {
          res = alignRuled(s, P);
          kind = '罫線の枠';
        }
        if (!res) {
          res = alignInline(s, P);
          kind = '1 行の文字';
        }
        if (!res) {
          res = alignCell(s, P);
          kind = 'マスの中央';
        }
      }
      if (!res) {
        report.そのまま++;
        return s;
      }
      if (res.skipped) {
        report.見送り.push(`${s.name}: ${res.skipped}`);
        return s;
      }
      const dx = res.dx ?? 0;
      const dy = res.dy ?? 0;
      s.position = { x: r2(s.position.x + dx), y: r2(s.position.y + dy) };
      if (res.height) s.height = r2(res.height);
      if (res.lineHeight) s.lineHeight = Math.round(res.lineHeight * 10000) / 10000;
      if (res.verticalAlignment) s.verticalAlignment = res.verticalAlignment;
      report[kind].push({ name: s.name, d: Math.hypot(dx, dy) });
      return s;
    });
  });
  return { schemas: out, report };
}

export function printReport(report) {
  const lines = [];
  for (const k of ['✓', '丸', '罫線の枠', '1 行の文字', 'マスの中央']) {
    const v = report[k];
    if (!v.length) continue;
    const big = v.filter((e) => e.d > 1.0);
    const max = Math.max(...v.map((e) => e.d));
    lines.push(`  ${k}: ${v.length} 個をそろえた（動かした量の最大 ${max.toFixed(2)}mm）${big.length ? `。1mm 以上: ${big.map((e) => `${e.name} ${e.d.toFixed(2)}`).slice(0, 8).join('、')}` : ''}`);
  }
  lines.push(`  そろえる相手がなく、そのままの欄: ${report.そのまま} 個`);
  for (const m of report.見送り) lines.push(`  見送り: ${m}`);
  return lines.join('\n');
}
