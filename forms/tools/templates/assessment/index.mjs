// アセスメント用紙: pages/ のページのファイルをまとめる。
// ページのファイルの書き方は pages/p1.mjs の先頭を見る。
// ブラウザでも動くように、ページは静的に import する（ページを足したらここにも足す）。
import * as p1 from './pages/p1.mjs';
import * as p2 from './pages/p2.mjs';
import * as p3 from './pages/p3.mjs';
import * as p4 from './pages/p4.mjs';
import * as p5 from './pages/p5.mjs';
import * as p6 from './pages/p6.mjs';
import * as p7 from './pages/p7.mjs';
import * as p8 from './pages/p8.mjs';
import * as p9 from './pages/p9.mjs';
import * as p10 from './pages/p10.mjs';
import * as p11 from './pages/p11.mjs';

export const pages = [p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11];

export const PDF_PAGES = 12;

export const usesKeys = [...new Set(pages.flatMap((p) => p.usesKeys))];

/** layout（scripts/layout.mjs の loadLayout の戻り値）から、ページごとの欄の配列を作る */
export function buildSchemas(layout) {
  const schemas = Array.from({ length: PDF_PAGES }, () => []);
  for (const p of pages) schemas[p.pdfPage - 1].push(...p.slots(layout.page(p.pdfPage)));
  return schemas;
}

export function toInputs(data) {
  return Object.assign({}, ...pages.map((p) => p.inputs(data)));
}
