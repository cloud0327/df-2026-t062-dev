// 印字欄 → 欄の値（fields.json の key）の対応表（slotmap.json）を作る。
//
// 画面で用紙の上の欄（丸・✓・文字）を直したとき、どの key のどの値を変えるかを、この表で決める。
// 作り方: key ごとに見本の値を 1 つずつ入れて toInputs() を動かし、変わった印字欄を記録する（AI は使わない）。
//   - 1 つの印字欄が 2 つ以上の値で変わる（親の □ など）、計算で出る、文字に飾りが付く欄は「derived」。
//   - どの見本でも変わらない欄は表に入れない。
//   画面ではどちらも、直した文字をその印字欄の値（slot:<名前>）として持つ。
//
//   node forms/scripts/build-slotmap.mjs            … 全部の様式の slotmap.json を書く
//   node forms/scripts/build-slotmap.mjs --check    … 書き出さずに、今のファイルと同じかだけ確かめる
import { readFileSync, writeFileSync } from 'node:fs';
import { loadForm, FORMS } from './forms.mjs';

const FIELDS = JSON.parse(readFileSync(new URL('../../core/fields.json', import.meta.url), 'utf8'));
const BYKEY = new Map(FIELDS.fields.filter((f) => f.key).map((f) => [f.key, f]));
const choicesOf = (spec) => (typeof spec.choices === 'string' ? FIELDS.choiceSets[spec.choices] : spec.choices) ?? [];
const subsOf = (spec) => spec.fields ?? FIELDS.types[spec.of]?.fields ?? [];

// 条件つきで出る欄の、見本を入れるときの前提（例: 要介護度は「認定済」のときだけ出る）
const CONTEXT = {
  'cert.careLevel': [{ 'cert.status': '認定済' }],
  'cert.expectedCareLevel': [{ 'cert.status': '新規申請中' }, { 'cert.status': '未申請' }],
  'cert.applicationDate': [{ 'cert.status': '新規申請中' }, { 'cert.status': '区分変更申請中' }],
  'household.typeOther': [{ 'household.type': 'その他' }],
  'meal.diet.diabetesKcal': [{ 'meal.diet': '糖尿食' }],
};

const MARK = 'ZQ7';
const DATES = [
  { v: '1999-02-03', m: '2', d: '3' },
  { v: '1931-02-03', m: '2', d: '3' },
  { v: '1920-02-03', m: '2', d: '3' },
  { v: '1905-02-03', m: '2', d: '3' },
];
const ERA_OF = { '1931-02-03': 'S', '1920-02-03': 'T', '1905-02-03': 'M' };

/** 型ごとの見本: [値, 対応の中身（kind・value）] の配列。日付は別に扱う */
function samples(spec) {
  switch (spec.type) {
    case 'enum': return choicesOf(spec).map((c) => [c, { kind: 'enum', value: c }]);
    case 'multi': return choicesOf(spec).map((c) => [[c], { kind: 'multi', value: c }]);
    case 'bool': return [[true, { kind: 'bool', value: true }], [false, { kind: 'bool', value: false }]];
    case 'text': case 'longtext': return [[MARK, { kind: 'text' }]];
    case 'number': return [[4321, { kind: 'number' }]];
    default: return [];
  }
}

function build(form) {
  // 変換が前提にしない形（空の行など）は、見本として使わない
  const inputsOf = (data) => {
    try {
      return form.toInputs(data);
    } catch {
      return null;
    }
  };
  const empty = form.toInputs({});
  const found = new Map(); // 印字欄 → 対応の候補（JSON 文字列の集合）

  const note = (slot, entry) => {
    const s = found.get(slot) ?? new Set();
    s.add(JSON.stringify(entry));
    found.set(slot, s);
  };

  /** data を入れて、空のとき（または前提だけのとき）から変わった印字欄を返す */
  const changed = (data, base) => {
    const out = inputsOf(data);
    if (!out || !base) return [];
    return Object.keys(out).filter((k) => (out[k] ?? '') !== (base[k] ?? '')).map((k) => [k, out[k]]);
  };

  const probeValue = (key, path, spec, wrap, base) => {
    if (spec.type === 'date') {
      for (const { v, m, d } of DATES) {
        for (const [slot, val] of changed(wrap(v), base)) {
          if (form.circles.has(slot)) {
            if (ERA_OF[v]) note(slot, { key, path, kind: 'era', value: ERA_OF[v] });
            continue;
          }
          const part = val === m ? 'm' : val === d ? 'd' : 'y';
          note(slot, { key, path, kind: 'date', part });
        }
      }
      return;
    }
    for (const [value, meta] of samples(spec)) {
      for (const [slot, val] of changed(wrap(value), base)) {
        if (meta.kind === 'text' && val !== MARK) { note(slot, { key, path, kind: 'derived' }); continue; }
        if (meta.kind === 'number' && val !== '4321') { note(slot, { key, path, kind: 'derived' }); continue; }
        // 文字の欄に選択肢の記号や名前が印字されるとき（援助の表の ○ △、続柄など）は、印字された文字も残す
        note(slot, form.circles.has(slot) || !['enum', 'bool'].includes(meta.kind) ? { key, path, ...meta } : { key, path, ...meta, text: val });
      }
    }
  };

  for (const key of form.usesKeys) {
    const spec = BYKEY.get(key);
    if (!spec) continue;
    for (const ctx of CONTEXT[key] ?? [{}]) {
      const base = inputsOf(ctx);
      const top = (v) => ({ ...ctx, [key]: v });
      if (['enum', 'multi', 'bool', 'text', 'longtext', 'number', 'date'].includes(spec.type)) {
        probeValue(key, [], spec, top, base);
      } else if (spec.type === 'object') {
        for (const sub of subsOf(spec)) probeValue(key, [sub.key], sub, (v) => top({ [sub.key]: v }), base);
      } else if (spec.type === 'list') {
        const subs = subsOf(spec);
        // 行を「種類」で引く表（services.used の kind など）か: 1 行目と 2 行目に同じ値を入れて、同じ欄が変わるか
        const keySub = subs.find((s) => s.type === 'enum' && choicesOf(s).length > 1 && (() => {
          const c = choicesOf(s)[0];
          const a = changed(top([{ [s.key]: c }]), base).map(([k]) => k).sort().join();
          const b = changed(top([{}, { [s.key]: c }]), base).map(([k]) => k).sort().join();
          return a !== '' && a === b;
        })());
        if (keySub) {
          for (const c of choicesOf(keySub)) {
            for (const [slot] of changed(top([{ [keySub.key]: c }]), base)) note(slot, { key, path: [{ [keySub.key]: c }], kind: 'row', keySub: keySub.key, value: c });
            const rowBase = inputsOf(top([{ [keySub.key]: c }]));
            for (const sub of subs) {
              if (sub === keySub) continue;
              probeValue(key, [{ [keySub.key]: c }, sub.key], sub, (v) => top([{ [keySub.key]: c, [sub.key]: v }]), rowBase);
            }
          }
        } else {
          for (let i = 0; i < 8; i++) {
            const rows = (row) => top([...Array.from({ length: i }, () => ({})), row]);
            const rowBase = inputsOf(rows({}));
            for (const sub of subs) probeValue(key, [i, sub.key], sub, (v) => rows({ [sub.key]: v }), rowBase);
          }
        }
      }
    }
  }

  const map = {};
  for (const name of Object.keys(empty).sort()) {
    const c = found.get(name);
    if (!c) continue;
    const entries = [...c].map((e) => JSON.parse(e));
    const same = entries.every((e) => e.key === entries[0].key && JSON.stringify(e.path) === JSON.stringify(entries[0].path));
    const texts = entries.map((e) => e.text);
    if (entries.length === 1 && entries[0].kind !== 'derived' && entries[0].text === undefined) map[name] = entries[0];
    // 文字の欄に、選んだものの記号・名前が出る欄。打った文字が選択肢の文字と同じなら、その値にする
    else if (same && texts.every((t) => t !== undefined) && new Set(texts).size === texts.length) {
      const { key, path } = entries[0];
      map[name] = { key, path, kind: 'choiceText', options: entries.map((e) => ({ text: e.text, value: e.value })) };
    }
    // 日付の年は前提ごとに同じ欄が出るので、1 つにまとまる。元号の丸は値ごとに 1 つ
    else if (entries.every((e) => e.kind === 'date' && e.part === entries[0].part && e.key === entries[0].key)) map[name] = entries[0];
    else map[name] = { kind: 'derived', keys: [...new Set(entries.map((e) => e.key))] };
  }
  return map;
}

const check = process.argv.includes('--check');
let ok = true;
for (const id of Object.keys(FORMS)) {
  const f = await loadForm(id);
  const template = JSON.parse(readFileSync(new URL(`../templates/${id}/template.json`, import.meta.url), 'utf8'));
  const all = template.schemas.flat();
  const form = { ...f, circles: new Set(all.filter((s) => s.type === 'circleMark').map((s) => s.name)) };
  const map = build(form);
  const json = JSON.stringify(map, null, 1) + '\n';
  const path = new URL(`../templates/${id}/slotmap.json`, import.meta.url);
  const mapped = Object.values(map).filter((e) => e.kind !== 'derived').length;
  const derived = Object.values(map).length - mapped;
  console.log(`[${id}] 印字欄 ${all.length} 個: 対応あり ${mapped}、derived ${derived}、対応なし ${all.length - mapped - derived}`);
  if (check) {
    let cur = '';
    try { cur = readFileSync(path, 'utf8'); } catch { /* ない */ }
    if (cur !== json) { ok = false; console.error(`  ${id}/slotmap.json が古い。node forms/scripts/build-slotmap.mjs で作り直す`); }
  } else {
    writeFileSync(path, json);
  }
}
if (!ok) process.exit(1);
