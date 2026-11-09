// 移しかえの道具: 前の手書きの変換（templates/<様式>/…の toInputs）の表示を、データの組ごとに固定のデータとして残す。
// test/binding.test.ts が、新しい共通の変換（core/binding.ts）の表示と全部の印字欄で比べる。2026-11-09 に 1 回使った。
//
//   node forms/tools/capture-render.mjs
// データの組: 空、見本・正解の全体、欄ごとの見本の値（fields.json の requires で前提を足す）、元号の境目・行の印などの組み合わせ。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadForm } from './scripts/forms.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const FIELDS = read('../../core/fields.json');
const BYKEY = new Map(FIELDS.fields.filter((f) => f.key).map((f) => [f.key, f]));
const choicesOf = (spec) => (typeof spec.choices === 'string' ? FIELDS.choiceSets[spec.choices] : spec.choices) ?? [];
const subsOf = (spec) => spec.fields ?? FIELDS.types[spec.of]?.fields ?? [];
const asValue = (spec, v) => (spec?.type === 'multi' ? [v] : v);
function contextsOf(requires, specOf) {
  if (!requires) return [{}];
  const out = [];
  for (const [k, values] of Object.entries(requires)) for (const v of values) out.push({ [k]: asValue(specOf(k), v) });
  return out.length ? out : [{}];
}

const DATES = ['1999-02-03', '1931-02-03', '1920-02-03', '1905-02-03', '2021-01-20', '1989-01-07', '1989-01-08', '2019-04-30', '2019-05-01'];
function samples(spec) {
  switch (spec.type) {
    case 'enum': return choicesOf(spec);
    case 'multi': return [...choicesOf(spec).map((c) => [c]), choicesOf(spec).slice(0, 2)];
    case 'bool': return [true, false];
    case 'text': case 'longtext': return ['ZQ7'];
    case 'number': return [4321, 1, 2, 0];
    case 'date': return DATES;
    default: return [];
  }
}

function probeCases(usesKeys) {
  const out = [];
  const add = (id, data) => out.push({ id, data });
  for (const key of usesKeys) {
    const spec = BYKEY.get(key);
    if (!spec) continue;
    for (const [ci, ctx] of contextsOf(spec.requires, (k) => BYKEY.get(k)).entries()) {
      const top = (v) => ({ ...ctx, [key]: v });
      if (!['object', 'list'].includes(spec.type)) {
        samples(spec).forEach((v, i) => add(`${key}#${ci}=${i}`, top(v)));
      } else if (spec.type === 'object') {
        const subs = subsOf(spec);
        for (const sub of subs) {
          for (const [si, sctx] of contextsOf(sub.requires, (k) => subs.find((x) => x.key === k)).entries()) {
            samples(sub).forEach((v, i) => add(`${key}#${ci}.${sub.key}#${si}=${i}`, top({ ...sctx, [sub.key]: v })));
          }
        }
      } else {
        const subs = subsOf(spec);
        const rk = spec.rowKey && spec.rowKey !== 'order' ? subs.find((s) => s.key === spec.rowKey) : null;
        const rowSets = rk && rk.type === 'enum'
          ? choicesOf(rk).map((c) => ({ id: `${rk.key}=${c}`, wrap: (row) => [{ [rk.key]: c, ...row }] }))
          : Array.from({ length: 6 }, (_, i) => ({ id: `[${i}]`, wrap: (row) => [...Array.from({ length: i }, () => ({ note: `R${i}` })), row] }));
        for (const rs of rowSets) {
          for (const sub of subs) {
            if (rk && sub === rk) continue;
            for (const [si, sctx] of contextsOf(sub.requires, (k) => subs.find((x) => x.key === k)).entries()) {
              samples(sub).forEach((v, i) => add(`${key}#${ci}${rs.id}.${sub.key}#${si}=${i}`, top(rs.wrap({ ...sctx, [sub.key]: v }))));
            }
          }
          if (rk) add(`${key}#${ci}${rs.id}`, top(rs.wrap({})));
        }
      }
    }
  }
  return out;
}

/** 前提の組み合わせ・行の印・元号の境目など、欄 1 つずつの見本では出ない組 */
function extraCases(id) {
  const c = [];
  const add = (name, data) => c.push({ id: `extra:${name}`, data });
  for (const d of DATES) add(`birth=${d}`, { 'person.birthDate': d, 'assessment.initialDate': '2026-11-09', 'admission.recordDate': '2026-11-09' });
  add('age-own', { 'person.age': 88, 'person.birthDate': '1931-02-03', 'assessment.initialDate': '2026-11-09' });
  add('age-update', { 'person.birthDate': '1931-02-03', 'assessment.initialDate': '2020-01-01', 'assessment.updateDate': '2026-11-09' });
  add('family', { 'family.members': [{ name: '一郎', relationship: '子', relationshipDetail: '長男', isMainCaregiver: true, livingTogether: '同居', phone: '000-1', age: 60 }, { name: '花子', relationship: '子の配偶者', isKeyPerson: true, mobile: '090-2', age: 58 }, { name: '次郎', relationship: '子', phone: '000-3', mobile: '090-3', isKeyPerson: false }] });
  add('family-key-both', { 'family.members': [{ name: '花子', relationship: '子', isKeyPerson: true, phone: '000-9', mobile: '090-9', isMainCaregiver: true, livingTogether: '別居' }] });
  add('reform-none', { 'services.used': [{ kind: '住宅改修', amount: 0 }] });
  add('reform-yes', { 'services.used': [{ kind: '住宅改修' }] });
  add('others', { 'services.used': [{ kind: 'その他', name: 'A', amount: 2 }, { kind: '配食サービス', amount: 8 }, { kind: 'その他', name: 'B', amount: 3 }, { kind: '身障／補装具・日常生活用具', amount: 2, unit: '品目' }] });
  for (const f of [1, 2, 3]) add(`floor=${f}`, { 'housing.roomFloor': f });
  add('pensions', { pensions: [{ kind: '国民年金（老齢基礎）' }, { kind: '厚生年金（老齢）', detail: '月10万' }, { kind: '遺族年金' }, { kind: '寡婦年金', detail: '寡婦' }, { kind: '恩給' }, { kind: 'その他', detail: 'x' }] });
  add('welfare-others', { 'welfare.others': [{ name: 'A' }, { name: 'B' }, { name: 'C' }] });
  add('aids', { 'housing.mobilityAidsOutdoor': ['杖', '使用していない'], 'housing.mobilityAidsIndoor': ['使用していない'] });
  add('institution-name-only', { 'health.homeVisitInstitution': { name: 'X' }, 'health.pharmacy': { has: false, name: 'Y' } });
  add('judge', { 'independence.physical': { level: 'A1', judgedBy: '医師（主治医意見書）' }, 'independence.dementia': { level: 'IIa', judgedBy: 'ケアマネ' } });
  for (const st of ['新規申請中', '区分変更申請中', '更新申請中', '未申請', '認定済']) add(`status=${st}`, { 'cert.status': st, 'cert.applicationDate': '2026-10-01', 'cert.expectedCareLevel': '要介護1', 'cert.careLevel': '要支援2' });
  add('disability-books', { 'handbook.physical': { has: true }, 'handbook.mental': { has: false } });
  add('disability-summary', { disabilityCertificateSummary: ['知的'], 'handbook.physical': { has: true } });
  add('schedule', { dailySchedule: [{ time: '7', rhythm: '起床', rhythmMark: ['□起床', '○排尿'], selfOrWish: '着替え', family: '見守り', service: '', plan: '✓' }, { time: '12', rhythmMark: ['△食事'], plan: '○' }] });
  add('assist', { 'assist.eating': { family: '△（時々実施）', service: true, wish: true, plan: '○（計画した）' } });
  add('copay-none', {});
  if (id === 'admission') add('caregiver-undefined', { 'outlook.caregiver': { name: 'X', relationship: '子', age: 50 } });
  return c;
}

function full() {
  const strip = (o) => { delete o._comment; return o; };
  return [
    { id: 'gold-v1', data: strip(read('../../eval/scenario/gold/用紙/アセスメント_v1.json')) },
    { id: 'gold-v2', data: strip(read('../../eval/scenario/gold/用紙/アセスメント_v2.json')) },
    { id: 'sample-hanako', data: strip(read('../samples/見本_花子.json')) },
  ];
}

mkdirSync(new URL('../../test/fixtures/render/', import.meta.url), { recursive: true });
for (const id of ['assessment', 'admission']) {
  const form = await loadForm(id);
  const empty = form.toInputs({});
  const cases = [];
  const seen = new Set();
  for (const { id: cid, data } of [...full(), ...extraCases(id), ...probeCases(form.usesKeys)]) {
    let out;
    try { out = form.toInputs(data); } catch { continue; } // 前の変換が前提にしない形は使わない
    const diff = Object.fromEntries(Object.entries(out).filter(([k, v]) => (v ?? '') !== (empty[k] ?? '')));
    const sig = JSON.stringify(data);
    if (seen.has(sig)) continue;
    seen.add(sig);
    cases.push({ id: cid, data, diff });
  }
  const file = new URL(`../../test/fixtures/render/${id}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify({ _about: 'forms/tools/capture-render.mjs が作る。前の手書きの変換の表示（空の表示 empty と、組ごとの違い diff）', empty, cases }) + '\n');
  console.log(`[${id}] ${cases.length} 組`);
}
