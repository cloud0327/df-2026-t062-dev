// アセスメント用紙 p.11（PDF の 12 ページ目）: 1日のスケジュール（0〜24 時）
// （PDF の 11・12 ページ目は横 2 倍の 1 枚を左右に分けたもの。この右半分が p.11）
import { textSlot as T, s } from '../../../scripts/layout.mjs';

export const pdfPage = 12;

export const usesKeys = ['dailySchedule'];

// 表の列の x（左端, 右端）。罫線の座標
const COL = {
  生活リズム: [26.9, 67.4],
  本人の活動: [67.4, 107.9],
  家族実施: [107.9, 131.9],
  サービス実施: [131.9, 155.9],
  計画: [155.9, 180.1],
};
const HOURS = Array.from({ length: 24 }, (_, i) => i); // 0〜23 時（24 は表の下端の目盛り）

/** 表の行の罫線（上から順の y）。0 時の行の上端から、24 時の下端まで */
function rowLines(P) {
  const ys = [...new Set(P.hlines.filter(([y, a, b]) => y > 34 && y < 277 && a <= 28 && b >= 178).map(([y]) => Math.round(y * 10) / 10))].sort((a, b) => a - b);
  // 近すぎる線（同じ罫線の二重描き）は 1 本にまとめる
  const lines = [];
  for (const y of ys) if (!lines.length || y - lines[lines.length - 1] > 3) lines.push(y);
  if (lines.length !== 25) throw new Error(`p11: 表の横罫線が ${lines.length} 本（25 本のはず）`);
  return lines;
}

export function slots(P) {
  const out = [];
  const lines = rowLines(P);
  for (const h of HOURS) {
    const y0 = lines[h];
    const hh = lines[h + 1] - y0;
    const cell = (col, opts) => {
      const [x0, x1] = COL[col];
      return T(`p11_${h}時_${col}`, x0 + 0.6, y0 + 0.4, x1 - x0 - 1.2, hh - 0.8, opts);
    };
    out.push(
      cell('生活リズム', { size: 8.5, fit: 'vertical', minSize: 5, lineHeight: 1.15 }),
      cell('本人の活動', { size: 8.5, fit: 'vertical', minSize: 5, lineHeight: 1.15 }),
      cell('家族実施', { size: 8, fit: 'vertical', minSize: 5, lineHeight: 1.15 }),
      cell('サービス実施', { size: 8, fit: 'vertical', minSize: 5, lineHeight: 1.15 }),
      cell('計画', { size: 11, align: 'center' }),
    );
  }
  return out;
}

// ---------- データ → 欄の値 ----------
export function inputs(data) {
  const o = {};
  const rows = Array.isArray(data.dailySchedule) ? data.dailySchedule : [];
  for (const h of HOURS) {
    const hit = rows.filter((r) => Number.parseInt(s(r?.time), 10) === h);
    const join = (f) => hit.map(f).filter((x) => x !== '').join('／');
    // 記号（◎排便 など）は先頭の 1 文字だけを、生活リズムの欄の頭に付ける
    const rhythm = join((r) => {
      const marks = (Array.isArray(r.rhythmMark) ? r.rhythmMark : []).map((m) => s(m)[0]).join('');
      return [marks, s(r.rhythm)].filter((x) => x !== '').join(' ');
    });
    o[`p11_${h}時_生活リズム`] = rhythm;
    o[`p11_${h}時_本人の活動`] = join((r) => s(r.selfOrWish));
    o[`p11_${h}時_家族実施`] = join((r) => s(r.family));
    o[`p11_${h}時_サービス実施`] = join((r) => s(r.service));
    o[`p11_${h}時_計画`] = hit.map((r) => s(r.plan)).find((x) => x !== '') ?? '';
  }
  return o;
}
