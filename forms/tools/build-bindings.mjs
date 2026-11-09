// 移しかえの道具: 前の対応表（templates/<様式>/slotmap.json）と、手で書いた対応から、
// forms/seed/<様式>/bindings.json（印字欄 → 対応）を作る。2026-11-09 に 1 回使った。
// これからは bindings.json が本体。直すときは bindings.json を直す（この道具は、どう移したかの記録として残す）。
//
//   node forms/tools/build-bindings.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const PT = 0.3528;

/** 印刷済みの □ の上に置いた ✓ の欄か（前の forms/index.ts の isCheckSlot と同じ見分け方） */
const isCheck = (s) => s.type === 'text' && Math.abs(s.width - s.height) <= 0.2 && s.width < 5 && s.alignment === 'center' && s.verticalAlignment === 'middle';
const isArea = (s) => s.height >= (s.fontSize ?? 9) * PT * (s.lineHeight ?? 1.1) * 1.8;
const textUi = (s) => (isArea(s) ? 'area' : 'text');
const optionUi = (s) => (s.type === 'circleMark' ? 'circle' : 'check');

const step = (x) => (x && typeof x === 'object' ? { match: x } : x);
const refOf = (e) => (e.path?.length ? { key: e.key, path: e.path.map(step) } : { key: e.key });
const at = (key, ...path) => (path.length ? { key, path } : { key });

/** 前の対応（slotmap の 1 行）→ 対応 */
function fromSlotmap(name, e, s, form) {
  const ref = refOf(e);
  switch (e.kind) {
    case 'enum': return { op: 'option@1', ui: optionUi(s), ref, is: { eq: e.value } };
    case 'bool': return { op: 'option@1', ui: optionUi(s), ref, is: { eq: e.value } };
    case 'multi': return { op: 'option@1', ui: optionUi(s), ref, is: { has: e.value } };
    case 'row': return { op: 'option@1', ui: optionUi(s), ref: { key: e.key }, is: { rowWhere: { [e.keySub]: { eq: e.value } } } };
    case 'text': case 'number': return { op: 'text@1', ui: textUi(s), ref };
    case 'date': {
      const b = { op: 'date@1', ui: 'text', ref, part: e.part };
      if (e.part === 'y' && /生年月日_年$/.test(name)) b.year = form === 'admission' ? 'nameUnlessMTS' : 'number';
      return b;
    }
    case 'era': return { op: 'era@1', ui: 'circle', ref, era: e.value };
    case 'choiceText':
      if (s.type === 'circleMark' || isCheck(s)) {
        if (e.options.length !== 1) throw new Error(`${name}: 丸・✓ の欄に選択肢が ${e.options.length} つ`);
        return { op: 'option@1', ui: optionUi(s), ref, is: { eq: e.options[0].value } };
      }
      return { op: 'symbol@1', ui: e.options.every((o) => o.text.length <= 1) ? 'cell' : 'text', ref, options: e.options };
    default: return null;
  }
}

// ---------- 手で書く対応 ----------
const refuse = (r) => ({ refuse: r });
const set = (...items) => ({ set: items });
const clear = set({ value: null });

const PENSION_OLD = ['国民年金（老齢基礎）', '厚生年金（老齢）', '共済年金（老齢）'];
const PENSION_LABEL = { '国民年金（老齢基礎）': '国民年金', '厚生年金（老齢）': '厚生年金', '共済年金（老齢）': '共済年金', 遺族年金: '遺族年金', 寡婦年金: '寡婦年金' };
const NOT_YET = ['新規申請中', '区分変更申請中', '更新申請中', '未申請'];
const ZERO = [0];

function assessmentManual(ui) {
  const m = {};
  m['p1_緊急連絡先_続柄'] = { op: 'text@1', ui: 'text', ref: at('emergencyContact', 'relationship') };
  m['p1_相談者_続柄'] = { op: 'text@1', ui: 'text', ref: at('consulter', 'relationship') };
  m['p1_要介護認定_未'] = { op: 'option@1', ui: 'circle', ref: at('cert.status'), is: { in: NOT_YET }, edit: { on: set({ value: '新規申請中' }), off: clear } };
  m['p1_本人_年齢'] = { op: 'ageAt@1', ui: 'text', ref: at('person.age'), birth: at('person.birthDate'), at: [at('assessment.updateDate'), at('assessment.initialDate')] };
  for (let i = 0; i < 5; i++) {
    m[`p2_家族${i + 1}_氏名`] = { op: 'text@1', ui: 'text', ref: at('family.members', i, 'name'), prefix: { text: '※', flag: 'isMainCaregiver' } };
    m[`p2_家族${i + 1}_続柄`] = { op: 'text@1', ui: 'text', ref: at('family.members', i, 'relationship') };
  }
  // 住宅改修は「あり・なし」。行があって量が 0 のときが「なし」
  const reform = { match: { kind: '住宅改修' } };
  const reformOn = { rowWhere: { kind: { eq: '住宅改修' }, amount: { not: { in: ZERO } } } };
  for (const n of ['p2_住宅改修_チェック', 'p2_住宅改修_あり']) {
    m[n] = { op: 'option@1', ui: ui(n), ref: at('services.used'), is: reformOn, edit: { on: set({ ref: at('services.used', reform), value: { kind: '住宅改修' } }), off: set({ ref: at('services.used', reform), value: null }) } };
  }
  m['p2_住宅改修_なし'] = { op: 'option@1', ui: ui('p2_住宅改修_なし'), ref: at('services.used'), is: { rowWhere: { kind: { eq: '住宅改修' }, amount: { in: ZERO } } }, edit: { on: set({ ref: at('services.used', reform), value: { kind: '住宅改修', amount: 0 } }), off: set({ ref: at('services.used', reform), value: null }) } };
  for (const kind of ['身障／補装具・日常生活用具', '市町村特別給付']) {
    const row = { match: { kind } };
    m[`p3_${kind}_内容`] = { op: 'text@1', ui: 'text', ref: at('services.used', row, 'name'), or: [{ concat: [at('services.used', row, 'amount'), at('services.used', row, 'unit')] }] };
  }
  for (let i = 0; i < 2; i++) {
    const row = { match: { kind: 'その他' }, nth: i };
    m[`p3_その他${i + 1}_チェック`] = { op: 'option@1', ui: 'check', ref: at('services.used', row), is: { nonEmpty: true }, edit: { on: refuse('名称を書くと ✓ が付きます'), off: set({ value: null }) } };
    m[`p3_その他${i + 1}_名称`] = { op: 'text@1', ui: 'text', ref: at('services.used', row, 'name') };
    m[`p3_その他${i + 1}_量`] = { op: 'text@1', ui: 'text', ref: at('services.used', row, 'amount') };
  }
  m['p3_年金_老齢関係'] = { op: 'option@1', ui: 'check', ref: at('pensions'), is: { rowWhere: { kind: { in: PENSION_OLD } } }, edit: { on: refuse('右の（ ）に、国民年金・厚生年金・共済年金のどれかを書くと ✓ が付きます'), off: refuse('右の（ ）を消すと ✓ が外れます') } };
  m['p3_年金_遺族・寡婦'] = { op: 'option@1', ui: 'check', ref: at('pensions'), is: { rowWhere: { kind: { in: ['遺族年金', '寡婦年金'] } } }, edit: { on: refuse('右の（ ）に、遺族年金・寡婦年金のどちらかを書くと ✓ が付きます'), off: refuse('右の（ ）を消すと ✓ が外れます') } };
  m['p3_年金_老齢関係_内容'] = { op: 'join@1', ui: 'text', ref: at('pensions'), where: { kind: { in: PENSION_OLD } }, show: 'detail', label: { of: 'kind', map: PENSION_LABEL }, sep: '、' };
  m['p3_年金_遺族・寡婦_内容'] = { op: 'join@1', ui: 'text', ref: at('pensions'), where: { kind: { in: ['遺族年金', '寡婦年金'] } }, show: 'detail', label: { of: 'kind', map: PENSION_LABEL }, sep: '、' };
  for (let i = 0; i < 3; i++) {
    m[`p3_制度その他${i + 1}_チェック`] = { op: 'option@1', ui: 'check', ref: at('welfare.others', i), is: { nonEmpty: true }, edit: { on: refuse('制度の名前を書くと ✓ が付きます'), off: set({ value: null }) } };
  }
  m['p3_居室_1階'] = { op: 'option@1', ui: 'check', ref: at('housing.roomFloor'), is: { eq: 1 } };
  m['p3_居室_2階'] = { op: 'option@1', ui: 'check', ref: at('housing.roomFloor'), is: { eq: 2 } };
  m['p3_居室_その他の階'] = { op: 'option@1', ui: 'check', ref: at('housing.roomFloor'), is: { notIn: [1, 2] }, edit: { on: refuse('右に階の数字を書いてください'), off: clear } };
  m['p3_居室_階の数字'] = { op: 'text@1', ui: 'text', ref: at('housing.roomFloor'), when: { is: { notIn: [1, 2] } } };
  for (const [place, key] of [['室外', 'housing.mobilityAidsOutdoor'], ['室内', 'housing.mobilityAidsIndoor']]) {
    m[`p3_移動手段_${place}_使用している`] = { op: 'option@1', ui: 'check', ref: at(key), is: { hasOther: ['使用していない'] }, edit: { on: refuse('使っている福祉機器に ✓ を付けてください'), off: refuse('福祉機器の ✓ を外してください') } };
  }
  for (const [label, key] of [['往診可能な医療機関', 'health.homeVisitInstitution'], ['緊急入院できる医療機関', 'health.emergencyInstitution'], ['かかりつけ薬局', 'health.pharmacy']]) {
    m[`p4_${label}_有`] = {
      op: 'option@1', ui: 'check', ref: at(key, 'has'),
      if: { any: [{ is: { eq: true } }, { all: [{ is: { empty: true } }, { ref: at(key, 'name'), is: { nonEmpty: true } }] }] },
      edit: { on: set({ value: true }), off: clear },
    };
  }
  m['p6_咀嚼_問題あり'] = { op: 'option@1', ui: 'check', ref: at('meal.chewing'), is: { notIn: ['問題なし'] }, edit: { on: refuse('噛みにくい・時々噛みにくい・とても噛みにくい のどれかに ✓ を付けてください'), off: clear } };
  for (const [key, label] of [['bloodPressure', '血圧'], ['eating', '摂食'], ['swallowing', '嚥下'], ['moving', '移動'], ['exercise', '運動'], ['other', 'その他']]) {
    m[`p9_医師_留意事項_${label}`] = { op: 'option@1', ui: 'check', ref: at('doctor.serviceCautions', key), is: { nonEmpty: true }, edit: { on: refuse('右に内容を書くと ✓ が付きます'), off: refuse('内容を消すと ✓ が外れます') } };
  }
  return m;
}

function admissionManual() {
  const m = {};
  const main = { flag: 'isMainCaregiver' };
  const keyp = { flag: 'isKeyPerson' };
  m['1_年齢'] = { op: 'ageAt@1', ui: 'text', ref: at('person.age'), birth: at('person.birthDate'), at: [at('admission.recordDate'), at('admission.date')] };
  m['1_要支援'] = { op: 'option@1', ui: 'check', ref: at('cert.careLevel'), is: { startsWith: '要支援' }, edit: { on: refuse('右に要支援の数字を書いてください'), off: clear } };
  m['1_要介護'] = { op: 'option@1', ui: 'check', ref: at('cert.careLevel'), is: { startsWith: '要介護' }, edit: { on: refuse('右に要介護の数字を書いてください'), off: clear } };
  m['1_申請中'] = { op: 'option@1', ui: 'check', ref: at('cert.status'), is: { in: ['新規申請中', '更新申請中'] }, edit: { on: set({ value: '新規申請中' }), off: clear } };
  const yearFrom = [at('admission.recordDate'), at('admission.date')];
  for (const part of ['m', 'd']) {
    const p = part === 'm' ? '月' : '日';
    m[`1_申請中_申請日_${p}`] = { op: 'date@1', ui: 'text', ref: at('cert.applicationDate'), part, yearFrom, when: { ref: at('cert.status'), is: { in: ['新規申請中', '更新申請中'] } } };
    m[`1_区分変更_申請日_${p}`] = { op: 'date@1', ui: 'text', ref: at('cert.applicationDate'), part, yearFrom, when: { ref: at('cert.status'), is: { eq: '区分変更申請中' } } };
  }
  const judged = (j) => ({ any: [{ ref: at('independence.physical', 'judgedBy'), is: j }, { ref: at('independence.dementia', 'judgedBy'), is: j }] });
  const setJudge = (v) => set({ ref: at('independence.physical', 'judgedBy'), value: v }, { ref: at('independence.dementia', 'judgedBy'), value: v });
  m['1_自立度_医師の判断'] = { op: 'option@1', ui: 'check', ref: at('independence.physical', 'judgedBy'), if: judged({ startsWith: '医師' }), edit: { on: setJudge('医師（主治医意見書）'), off: setJudge(null) } };
  m['1_自立度_ケアマネの判断'] = { op: 'option@1', ui: 'check', ref: at('independence.physical', 'judgedBy'), if: judged({ eq: 'ケアマネ' }), edit: { on: setJudge('ケアマネ'), off: setJudge(null) } };
  const RATES = ['1割', '2割', '3割'];
  m['1_自己負担割合'] = { op: 'option@1', ui: 'check', ref: at('insurance.careCopayRate'), is: { in: RATES }, edit: { on: refuse('右に割合の数字を書いてください'), off: clear } };
  m['1_自己負担割合_不明'] = { op: 'option@1', ui: 'check', ref: at('insurance.careCopayRate'), is: { not: { in: RATES } }, edit: { on: clear, off: refuse('左に割合の数字を書いてください') } };
  // 障害など認定: 「障害など認定」の欄（disabilityCertificateSummary）があればそれ、なければ 3 つの手帳の有無から
  const sum = at('disabilityCertificateSummary');
  const books = { 身体: 'handbook.physical', 精神: 'handbook.mental', 知的: 'handbook.rehabilitation' };
  for (const [label, key] of Object.entries(books)) {
    m[`1_障害など認定_${label}`] = {
      op: 'option@1', ui: 'circle', ref: at(key, 'has'),
      if: { any: [{ ref: sum, is: { has: label } }, { all: [{ ref: sum, is: { empty: true } }, { is: { eq: true } }] }] },
      edit: { on: set({ value: true }), off: clear },
    };
  }
  const anyBook = Object.values(books).map((k) => ({ ref: at(k, 'has'), is: { eq: true } }));
  m['1_障害など認定_あり'] = { op: 'option@1', ui: 'check', ref: sum, if: { any: [{ ref: sum, is: { nonEmpty: true } }, ...anyBook] }, edit: { on: refuse('身体・精神・知的のどれかに丸を付けてください'), off: refuse('身体・精神・知的の丸を外してください') } };
  m['1_障害など認定_なし'] = { op: 'option@1', ui: 'check', ref: sum, if: { all: [{ ref: sum, is: { empty: true } }, ...Object.values(books).map((k) => ({ ref: at(k, 'has'), is: { not: { eq: true } } }))] }, edit: { on: set(...Object.values(books).map((k) => ({ ref: at(k, 'has'), value: false }))), off: refuse('身体・精神・知的のどれかに丸を付けてください') } };
  const MAIN3 = ['国民年金（老齢基礎）', '厚生年金（老齢）', '障害年金'];
  for (const [label, kind] of [['国民年金', MAIN3[0]], ['厚生年金', MAIN3[1]], ['障害年金', MAIN3[2]]]) {
    m[`1_年金_${label}`] = { op: 'option@1', ui: 'check', ref: at('pensions'), is: { rowWhere: { kind: { eq: kind } } } };
  }
  m['1_年金_その他'] = { op: 'option@1', ui: 'check', ref: at('pensions'), is: { rowWhere: { kind: { notIn: MAIN3 } } }, edit: { on: refuse('右の（ ）に年金の種類を書くと ✓ が付きます'), off: refuse('右の（ ）を消すと ✓ が外れます') } };
  m['1_年金_その他の内容'] = { op: 'join@1', ui: 'text', ref: at('pensions'), where: { kind: { notIn: MAIN3 } }, label: { of: 'kind', strip: '（.*?）' }, sep: '、' };
  for (const [who, flag] of [['主介護者', main], ['キーパーソン', keyp]]) {
    m[`2_${who}_氏名`] = { op: 'text@1', ui: 'text', ref: at('family.members', flag, 'name') };
    m[`2_${who}_続柄`] = { op: 'text@1', ui: 'text', ref: at('family.members', flag, 'relationship') };
    m[`2_${who}_年齢`] = { op: 'text@1', ui: 'text', ref: at('family.members', flag, 'age') };
  }
  m['2_主介護者_同居'] = { op: 'option@1', ui: 'circle', ref: at('family.members', main, 'livingTogether'), is: { eq: '同居' } };
  m['2_主介護者_別居'] = { op: 'option@1', ui: 'circle', ref: at('family.members', main, 'livingTogether'), is: { eq: '別居' } };
  m['2_主介護者_TEL'] = { op: 'text@1', ui: 'text', ref: at('family.members', main, 'phone') };
  m['2_キーパーソン_TEL'] = { op: 'text@1', ui: 'text', ref: at('family.members', keyp, 'phone'), or: [at('family.members', keyp, 'mobile')] };
  m['2_キーパーソン_TEL_狭い欄'] = { op: 'text@1', ui: 'text', ref: at('family.members', keyp, 'mobile'), when: { ref: at('family.members', keyp, 'phone'), is: { nonEmpty: true } } };
  m['4_その他を同封'] = { op: 'option@1', ui: 'check', ref: at('admission.enclosedOther'), is: { nonEmpty: true }, edit: { on: refuse('右に同封した書類の名前を書くと ✓ が付きます'), off: refuse('書類の名前を消すと ✓ が外れます') } };
  m['5_退院後の世帯_家族構成員数'] = { op: 'text@1', ui: 'text', ref: at('outlook.household', 'memberCount'), when: { ref: at('outlook.household', 'type'), is: { eq: '子と同居' } } };
  m['5_介護力_見込める'] = { op: 'option@1', ui: 'check', ref: at('outlook.careCapacity'), is: { startsWith: '介護力が見込める' }, edit: { on: refuse('十分・一部のどちらかに ✓ を付けてください'), off: clear } };
  return m;
}

/** 規則的な欄: 医療の具体的内容（p.9）と 1 日のスケジュール（p.11） */
function assessmentRegular(names, ui) {
  const m = {};
  const fj = read('../../core/fields.json');
  const items = fj.fields.find((f) => f.key === 'medical.careDetails').fields.find((s) => s.key === 'item').choices;
  for (const item of items) {
    for (const [col, sub] of [['現状', 'current'], ['計画', 'plan']]) {
      const n = `p9_具体的内容_${item}_${col}`;
      if (names.has(n)) m[n] = { op: 'option@1', ui: 'check', ref: at('medical.careDetails', { match: { item } }, sub), is: { eq: true } };
    }
  }
  for (let h = 0; h < 24; h++) {
    const row = { match: { time: String(h) } };
    m[`p11_${h}時_生活リズム`] = { op: 'rhythm@1', ui: 'text', ref: at('dailySchedule', row), marks: 'rhythmMark', text: 'rhythm' };
    m[`p11_${h}時_本人の活動`] = { op: 'text@1', ui: ui(`p11_${h}時_本人の活動`), ref: at('dailySchedule', row, 'selfOrWish') };
    m[`p11_${h}時_家族実施`] = { op: 'text@1', ui: ui(`p11_${h}時_家族実施`), ref: at('dailySchedule', row, 'family') };
    m[`p11_${h}時_サービス実施`] = { op: 'text@1', ui: ui(`p11_${h}時_サービス実施`), ref: at('dailySchedule', row, 'service') };
    m[`p11_${h}時_計画`] = { op: 'symbol@1', ui: 'cell', ref: at('dailySchedule', row, 'plan'), options: [{ text: '✓', value: '✓' }, { text: '○', value: '○' }] };
  }
  return m;
}

/** 1 行 1 欄の JSON（差分を読みやすくする） */
function write(id, bindings, order) {
  const lines = order.filter((n) => bindings[n]).map((n) => `  ${JSON.stringify(n)}: ${JSON.stringify(bindings[n])}`);
  const dir = new URL(`../seed/${id}/`, import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL('bindings.json', dir), `{\n${lines.join(',\n')}\n}\n`);
}

for (const id of ['assessment', 'admission']) {
  const template = read(`../templates/${id}/template.json`);
  const slotmap = read(`../templates/${id}/slotmap.json`);
  const slots = template.schemas.flat();
  const byName = new Map(slots.map((s) => [s.name, s]));
  const ui = (n) => {
    const s = byName.get(n);
    return s.type === 'circleMark' ? 'circle' : isCheck(s) ? 'check' : textUi(s);
  };
  const out = {};
  for (const s of slots) {
    const e = slotmap[s.name];
    if (e && e.kind !== 'derived') out[s.name] = fromSlotmap(s.name, e, s, id);
  }
  // アセスメントの「済」の行の要介護度は、認定済のときだけ（区分変更・更新の申請中は「未（見込み）」の行に書く）
  for (const n of Object.keys(out)) if (/^p1_要介護認定_済_/.test(n)) out[n].when = { ref: { key: 'cert.status' }, is: { eq: '認定済' } };
  const names = new Set(slots.map((s) => s.name));
  const manual = id === 'assessment' ? { ...assessmentRegular(names, ui), ...assessmentManual(ui) } : admissionManual();
  for (const [n, b] of Object.entries(manual)) {
    if (!names.has(n)) throw new Error(`${id}: ${n} という印字欄はない`);
    out[n] = b;
  }
  const missing = slots.map((s) => s.name).filter((n) => !out[n]);
  write(id, out, slots.map((s) => s.name));
  console.log(`[${id}] 対応 ${Object.keys(out).length} / 印字欄 ${slots.length}${missing.length ? `、対応なし: ${missing.join(', ')}` : ''}`);
}
