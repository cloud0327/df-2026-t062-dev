// アセスメント用紙の 1 ページ分だけを、見本データと位置確認用の 2 通りで PDF と PNG にする。
// template.json は書き換えない（何人かで同時に作業しても大丈夫）。
// 使い方: node scripts/preview-page.mjs p2
// 出力: out/preview/p2_見本.png、out/preview/p2_位置確認.png（と同じ名前の .pdf）
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { generate } from '@pdfme/generator';
import { ROOT, FORMS_DIR, plugins, loadFont, loadJson } from './lib.mjs';
import { loadLayout } from './load-layout.mjs';
import { alignSchemas, printReport } from './align.mjs';
import { readFileSync } from 'node:fs';

const id = process.argv[2];
if (!/^p\d+$/.test(id ?? '')) throw new Error('使い方: node scripts/preview-page.mjs p2');
const mod = await import(new URL(`../templates/assessment/pages/${id}.mjs`, import.meta.url));
const layout = loadLayout('assessment');
const raw = Array.from({ length: 12 }, (_, i) => (i === mod.pdfPage - 1 ? mod.slots(layout.page(mod.pdfPage)) : []));
const aligned = alignSchemas(raw, layout);
const slots = aligned.schemas[mod.pdfPage - 1];

const names = slots.map((s) => s.name);
const dup = names.filter((n, i) => names.indexOf(n) !== i);
if (dup.length) throw new Error(`欄の名前が重複: ${[...new Set(dup)].join(', ')}`);
const sample = loadJson(new URL('samples/見本_花子.json', FORMS_DIR));
const values = mod.inputs(sample);
const empty = mod.inputs({});
const missing = names.filter((n) => !(n in empty));
const extra = Object.keys(empty).filter((n) => !names.includes(n));
if (missing.length) console.log('問題: inputs が値を出さない欄:', missing.join(', '));
if (extra.length) console.log('問題: inputs が出すが slots にない欄:', extra.join(', '));
for (const [k, v] of Object.entries(values)) if (typeof v !== 'string') console.log(`問題: 欄 ${k} の値が文字列でない`);
const fields = loadJson(new URL('../core/fields.json', FORMS_DIR));
const keys = new Set(fields.fields.filter((f) => f.key).map((f) => f.key));
for (const k of mod.usesKeys) if (!keys.has(k)) console.log(`問題: fields.json にない key: ${k}`);

const layoutValues = {};
for (const s of slots) {
  if (s.type === 'circleMark') layoutValues[s.name] = 'true';
  else if (s.width < 4) layoutValues[s.name] = s.width < 3.6 ? '✓' : '9';
  else if (s.width < 12) layoutValues[s.name] = '12';
  else layoutValues[s.name] = s.name;
}

const base = new Uint8Array(readFileSync(new URL('templates/assessment/base.pdf', ROOT)));
const schemas = Array.from({ length: 12 }, (_, i) => (i === mod.pdfPage - 1 ? slots : []));
const outDir = new URL('out/preview/', ROOT);
mkdirSync(outDir, { recursive: true });
for (const [label, inputs] of [['見本', values], ['位置確認', layoutValues]]) {
  const pdf = await generate({ template: { basePdf: base, schemas }, inputs: [inputs], plugins, options: { font: loadFont() } });
  const pdfPath = decodeURIComponent(new URL(`${id}_${label}.pdf`, outDir).pathname);
  writeFileSync(pdfPath, pdf);
  const pngBase = pdfPath.replace(/\.pdf$/, '');
  execFileSync('pdftoppm', ['-r', '110', '-png', '-singlefile', '-f', String(mod.pdfPage), '-l', String(mod.pdfPage), pdfPath, pngBase], { stdio: 'ignore' });
  console.log('書き出しました:', `${pngBase}.png`);
}
console.log(`欄 ${slots.length} 個`);
console.log(printReport(aligned.report));
