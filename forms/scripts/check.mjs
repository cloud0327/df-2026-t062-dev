// 様式（template.json）・対応（forms/seed/<様式>/bindings.json）・fields.json の食い違いを探す。全部の様式を調べる。
// 使い方: node forms/scripts/check.mjs（npm run forms:check）
import { FORMS } from '../index.ts';
import { checkBindings, renderAll } from '../../core/binding.ts';
import { FIELD_LIST } from '../../core/fields.ts';
import { ROOT, loadJson } from './lib.mjs';

const FIELDS_FORM = { assessment: 'assess', admission: 'adm' };
const defined = new Map(FIELD_LIST.map((f) => [f.key, f]));
const sample = loadJson(new URL('samples/見本_花子.json', ROOT));
let failed = false;

for (const form of Object.values(FORMS)) {
  const problems = [];
  const slots = form.template.schemas.flat().map((s) => s.name);

  // 1. テンプレートの印字欄と、対応が一致するか。対応の中身（key・項目・丸の直し）が正しいか
  for (const n of slots) if (!form.bindings[n]) problems.push(`対応のない印字欄: ${n}`);
  for (const n of Object.keys(form.bindings)) if (!slots.includes(n)) problems.push(`印字欄のない対応: ${n}`);
  problems.push(...checkBindings(form.bindings));

  // 2. 対応が読む key と、fields.json の forms（その様式に入る欄）が一致するか。図は人が描くので印字欄がない
  const fk = FIELDS_FORM[form.id];
  const listed = new Set(FIELD_LIST.filter((f) => f.forms?.[fk] && f.type !== 'image').map((f) => f.key));
  for (const k of form.keys) if (!listed.has(k)) problems.push(`対応が読むのに、fields.json の forms.${fk} にない: ${k}`);
  for (const k of listed) if (!form.keys.includes(k)) problems.push(`fields.json の forms.${fk} にあるのに、対応が読まない: ${k}（${defined.get(k)?.label}）`);

  // 3. 見本データで、全部の印字欄が文字になるか
  for (const [k, v] of Object.entries(renderAll(form.bindings, sample))) if (typeof v !== 'string') problems.push(`欄 ${k} の値が文字列でない: ${JSON.stringify(v)}`);

  console.log(`[${form.id}] ${form.label}: 印字欄 ${slots.length} 個、読む key ${form.keys.length} 個`);
  for (const p of problems) console.log(`  問題: ${p}`);
  if (problems.length) failed = true;
}

// 4. 見本データの key が fields.json にあるか
for (const k of Object.keys(sample)) if (!k.startsWith('_') && !defined.has(k)) {
  console.log(`  問題: 見本データの key が fields.json にない: ${k}`);
  failed = true;
}

if (failed) process.exit(1);
console.log('OK: 食い違いはありません');
