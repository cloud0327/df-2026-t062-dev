// 見本データから様式の PDF を作る。
// 使い方: node scripts/generate.mjs [--form admission|assessment] [--layout] [--out PDF] [データの JSON]
//   --form    様式（省略時は admission = 入院時情報提供書）
//   --layout  全部の欄に印を入れた「位置確認用」の PDF を作る
//   --out     書き出す PDF（省略時は out/<様式>_見本.pdf か out/<様式>_位置確認.pdf）
//   データの JSON を省略すると samples/見本_花子.json
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { generate } from '@pdfme/generator';
import { ROOT, plugins, loadFont, loadTemplate, loadJson } from './lib.mjs';
import { loadForm } from './forms.mjs';
import { FORMS } from '../index.ts';
import { renderAll } from '../../core/binding.ts';

const args = process.argv.slice(2);
const option = (name) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : undefined);
const formId = option('--form') ?? 'admission';
const outPath = option('--out');
const layoutMode = args.includes('--layout');
const dataPath = args.find((a, i) => !a.startsWith('--') && !['--form', '--out'].includes(args[i - 1])) ?? 'samples/見本_花子.json';

const form = await loadForm(formId);
const template = loadTemplate(formId);

/** 位置確認用: 丸は全部 true、✓ の欄は ✓、狭い欄は数字、広い欄は欄の名前 */
export function layoutInputs(schemas) {
  const inputs = {};
  for (const s of schemas.flat()) {
    if (s.type === 'circleMark') inputs[s.name] = 'true';
    else if (s.width < 4) inputs[s.name] = s.width < 3.6 ? '✓' : '9';
    else if (s.width < 12) inputs[s.name] = '12';
    else inputs[s.name] = s.name;
  }
  return inputs;
}

const inputs = layoutMode ? layoutInputs(template.schemas) : renderAll(FORMS[form.id].bindings, loadJson(new URL(dataPath, ROOT)));
const pdf = await generate({ template, inputs: [inputs], plugins, options: { font: loadFont() } });
const out = outPath
  ? pathToFileURL(resolve(outPath))
  : new URL(`out/${form.label}_${layoutMode ? '位置確認' : '見本'}.pdf`, ROOT);
mkdirSync(new URL('./', out), { recursive: true });
writeFileSync(out, pdf);
console.log('書き出しました:', fileURLToPath(out));
