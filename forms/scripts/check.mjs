// テンプレートと変換プログラムと fields.json の食い違いを探す。全部の様式を調べる。
// 使い方: node scripts/check.mjs
import { existsSync } from 'node:fs';
import { ROOT, loadJson, loadTemplate } from './lib.mjs';
import { FORMS, loadForm } from './forms.mjs';

const fields = loadJson(new URL('../core/fields.json', ROOT));
const defined = new Map(fields.fields.filter((f) => f.key).map((f) => [f.key, f]));
const sample = loadJson(new URL('samples/見本_花子.json', ROOT));
let failed = false;

for (const id of Object.keys(FORMS)) {
  if (!existsSync(new URL(`templates/${id}/template.json`, ROOT))) {
    console.log(`[${id}] template.json がまだありません`);
    continue;
  }
  const form = await loadForm(id);
  const problems = [];
  const warnings = [];

  // 1. テンプレートの欄と、変換プログラムが出す欄が一致するか
  const template = loadTemplate(id);
  const slots = new Set(template.schemas.flat().map((s) => s.name));
  const produced = new Set(Object.keys(form.toInputs({})));
  for (const n of slots) if (!produced.has(n)) problems.push(`テンプレートにあるが、変換プログラムが値を出さない欄: ${n}`);
  for (const n of produced) if (!slots.has(n)) problems.push(`変換プログラムが値を出すが、テンプレートにない欄: ${n}`);

  // 2. 変換プログラムが読む key が fields.json にあるか
  for (const k of form.usesKeys) if (!defined.has(k)) problems.push(`fields.json にない key を読んでいる: ${k}`);

  // 3. fields.json でこの様式に入ると書いた欄を、変換プログラムが読んでいるか
  for (const [k, f] of defined) {
    // 図（家族構成図・人体図・見取図）は人が描くので、印字する欄はない
    if (f.forms?.[form.fieldsForm] && f.type !== 'image' && !form.usesKeys.includes(k)) warnings.push(`fields.json ではこの様式に入るとあるが、変換プログラムが読んでいない: ${k}（${f.label}）`);
  }

  // 4. 見本データで変換したとき、値が文字列でない欄がないか
  const out = form.toInputs(sample);
  for (const [k, v] of Object.entries(out)) if (typeof v !== 'string') problems.push(`欄 ${k} の値が文字列でない: ${JSON.stringify(v)}`);

  console.log(`[${id}] ${form.label}: テンプレートの欄 ${slots.size} 個、読む key ${form.usesKeys.length} 個`);
  for (const w of warnings) console.log(`  注意: ${w}`);
  for (const p of problems) console.log(`  問題: ${p}`);
  if (problems.length) failed = true;
}

// 5. 見本データの key が fields.json にあるか
for (const k of Object.keys(sample)) if (!k.startsWith('_') && !defined.has(k)) {
  console.log(`  問題: 見本データの key が fields.json にない: ${k}`);
  failed = true;
}

if (failed) process.exit(1);
console.log('OK: 食い違いはありません');
