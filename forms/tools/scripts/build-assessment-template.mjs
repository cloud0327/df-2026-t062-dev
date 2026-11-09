// アセスメント用紙の pdfme テンプレート（forms/seed/assessment/template.json）を作る。
// 欄の位置は templates/assessment/pages/*.mjs が、layout.json の文字の座標を目印にして決める。
//
// 注意: これを実行すると template.json を上書きする。
// Designer で位置を直したあとは、ページのファイルの方を直してから実行するか、実行しないこと。
// 使い方: node scripts/build-assessment-template.mjs
import { writeFileSync } from 'node:fs';
import { loadLayout } from './load-layout.mjs';
import { alignSchemas, printReport } from './align.mjs';
import { buildSchemas } from '../templates/assessment/index.mjs';

const layout = loadLayout('assessment');
// ページのファイルが置いた欄を、書類の □・文字・罫線にぴったり合わせる（scripts/align.mjs）
const { schemas, report } = alignSchemas(buildSchemas(layout), layout);
const names = schemas.flat().map((s) => s.name);
const dup = names.filter((n, i) => names.indexOf(n) !== i);
if (dup.length) throw new Error(`欄の名前が重複: ${[...new Set(dup)].join(', ')}`);

writeFileSync(new URL('../../seed/assessment/template.json', import.meta.url), JSON.stringify({ basePdf: 'base.pdf', schemas }, null, 1));
console.log(`template.json を書き出しました（欄 ${names.length} 個）`);
console.log(schemas.map((p, i) => `PDF ${i + 1} ページ: ${p.length}`).join('、'));
console.log('位置をそろえた結果:');
console.log(printReport(report));
