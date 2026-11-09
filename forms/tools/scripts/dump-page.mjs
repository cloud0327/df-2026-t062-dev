// layout.json の 1 ページ分を、人が読める形で出す（欄の位置を決めるときの下調べ用）。
// 使い方: node scripts/dump-page.mjs <PDF のページ番号> [lines]
//   行（同じ高さの文字をつなげたもの）と、その左端・上端・右端・下端（mm）を出す。
//   lines を付けると、長さ 5mm 以上の罫線も出す。
import { loadLayout } from './load-layout.mjs';

const n = Number(process.argv[2]);
const P = loadLayout('assessment').page(n);
for (const l of P.lines) {
  const x0 = Math.min(...l.chars.map((c) => c.x0));
  const x1 = Math.max(...l.chars.map((c) => c.x1));
  const y0 = Math.min(...l.chars.map((c) => c.y0));
  const y1 = Math.max(...l.chars.map((c) => c.y1));
  console.log(`${x0.toFixed(1).padStart(6)} ${y0.toFixed(1).padStart(6)} ${x1.toFixed(1).padStart(6)} ${y1.toFixed(1).padStart(6)}  ${l.text}`);
}
if (process.argv[3] === 'lines') {
  console.log('--- 横線 [y, x0, x1]');
  for (const h of P.hlines) if (h[2] - h[1] >= 5) console.log(h.join(' '));
  console.log('--- 縦線 [x, y0, y1]');
  for (const v of P.vlines) if (v[2] - v[1] >= 5) console.log(v.join(' '));
}
