// アセスメント用紙 p.6（PDF の 7 ページ目）: 6-② 生活機能（食事・排泄等）
// 共通の道具は ../lib-p567.mjs
import { textSlot as T, checkSlot as C, ck, s } from '../../../scripts/layout.mjs';
import {
  choiceSet, surveySlots, surveyInputs, assistSlots, assistInputs, levelSlots, levelInputs, pickSlots, pickInputs, freeText, parenSlot,
} from '../lib-p567.mjs';

export const pdfPage = 7;
const PG = 'p6';

const SURVEY = [];
for (let n = 1; n <= 13; n++) SURVEY.push([`2-${n}`, `survey.2_${n}`]);

// [欄の名前, key, 行の名前の文字]
const ASSIST_MEAL = [
  ['食事_移乗介助', 'assist.mealTransfer', '1）移乗介助'],
  ['食事_移動介助', 'assist.mealMove', '2）移動介助'],
  ['食事_摂取介助', 'assist.eating', '3）摂取介助'],
];
const ASSIST_TOILET = [
  ['排泄等_準備後始末', 'assist.toiletPrep', '1）準備・後始末'],
  ['排泄等_移乗移動介助', 'assist.toiletTransfer', '2）移乗移動介助'],
  ['排泄等_排尿介助', 'assist.urination', '3）排尿介助'],
  ['排泄等_排便介助', 'assist.defecation', '4）排便介助'],
  ['排泄等_口腔清潔介助', 'assist.oralCare', '5）口腔清潔介助'],
  ['排泄等_洗面介助', 'assist.faceWash', '6）洗面介助'],
  ['排泄等_整容介助', 'assist.grooming', '7）整容介助'],
  ['排泄等_更衣介助', 'assist.dressing', '8）更衣介助'],
];
const ASSIST_OUT = [['外出_移送外出介助', 'assist.outing', '1）移送・外出介助']];

export const usesKeys = [
  ...SURVEY.map(([, k]) => k),
  ...[...ASSIST_MEAL, ...ASSIST_TOILET, ...ASSIST_OUT].map(([, k]) => k),
  'meal.staple', 'meal.side', 'meal.eatingAssistLevel',
  'meal.place', 'meal.stepToDining', 'meal.chewing', 'meal.diet', 'notes.meal',
  'excretion.urination', 'excretion.defecation', 'excretion.urgeUrine', 'excretion.urgeStool', 'notes.excretion',
  'notes.outing',
];

const COLS = [95.93, 107.93, 119.93, 131.93, 143.93];
const STAPLE = choiceSet('主食');
const SIDE = choiceSet('副食');
const URINE = choiceSet('排泄方法_尿');
const STOOL = choiceSet('排泄方法_便');
const PLACE = ['食堂', '居室ベッド上', '布団上', 'その他居室内', 'その他'];
const CHEW = ['問題なし', '噛みにくい', '時々噛みにくい', 'とても噛みにくい'];
const DIETS = ['一般食', '糖尿食', '高血圧食', '抗潰瘍食', 'その他'];
const URGE = ['ある', 'ときどきある', 'ない'];

// 現状の列（x 149〜174）と計画の列（x 174〜200）
const curCol = (y0, y1) => ({ x0: 149, x1: 174, y0, y1 });
const planCol = (y0, y1) => ({ x0: 174, x1: 200, y0, y1 });
const wide = (y0, y1) => ({ x0: 148, x1: 207, y0, y1 });
const left = (y0, y1) => ({ x0: 13, x1: 96, y0, y1 });

export function slots(P) {
  const out = [];
  const add = (...a) => out.push(...a.flat());

  add(surveySlots(P, PG, SURVEY, { labelX: 20.4, xMax: 72 }));

  // ---------- 援助の現状の表 ----------
  const lab = { x0: 75, x1: 95.9 };
  add(assistSlots(P, PG, { cols: COLS, labelIn: { ...lab, y0: 17, y1: 51.5 }, rows: ASSIST_MEAL.map(([n, , l]) => [n, l]) }));
  add(assistSlots(P, PG, { cols: COLS, labelIn: { ...lab, y0: 120.5, y1: 194.5 }, rows: ASSIST_TOILET.map(([n, , l]) => [n, l]) }));
  add(assistSlots(P, PG, { cols: COLS, labelIn: { ...lab, y0: 229.5, y1: 247.5 }, rows: ASSIST_OUT.map(([n, , l]) => [n, l]) }));

  // ---------- 食事の右の表（主食・副食・摂取介助） ----------
  add(pickSlots(P, 'p6_主食', STAPLE, curCol(51, 73), planCol(51, 73)));
  add(parenSlot(P, 'p6_主食_現状_その他の内容', wide(70.5, 75), 0));
  add(parenSlot(P, 'p6_主食_計画_その他の内容', wide(70.5, 75), 1));
  add(pickSlots(P, 'p6_副食', SIDE, curCol(79.5, 96.5), planCol(79.5, 96.5)));
  add(parenSlot(P, 'p6_副食_現状_その他の内容', wide(94.8, 99), 0));
  add(parenSlot(P, 'p6_副食_計画_その他の内容', wide(94.8, 99), 1));
  add(levelSlots(P, 'p6_摂取介助', wide(103.5, 113)));

  // ---------- 排尿介助・排便介助の表 ----------
  add(levelSlots(P, 'p6_排尿介助', wide(129.5, 138.5)));
  add(pickSlots(P, 'p6_排尿方法', URINE, curCol(138.5, 158), planCol(138.5, 158)));
  add(levelSlots(P, 'p6_排便介助', wide(162.5, 171)));
  add(pickSlots(P, 'p6_排便方法', STOOL, curCol(171, 199), planCol(171, 199)));

  // ---------- その他食事の現状（左の枠） ----------
  add(C('p6_食事場所_食堂', P.boxBefore('食堂', { in: left(132, 137.5) })));
  add(C('p6_食事場所_居室ベッド上', P.boxBefore('居室ベッド上', { in: left(132, 137.5) })));
  add(C('p6_食事場所_布団上', P.boxBefore('布団上', { in: left(137.8, 142) })));
  add(C('p6_食事場所_その他居室内', P.boxBefore('その他居室内', { in: left(137.8, 142) })));
  add(C('p6_食事場所_その他', P.boxBefore('その他（', { in: left(142.5, 147) })));
  add(parenSlot(P, 'p6_食事場所_その他の内容', left(142.5, 147), 0));
  add(C('p6_食堂までの段差_あり', P.boxBefore('あり', { in: left(147.2, 152) })));
  add(C('p6_食堂までの段差_なし', P.boxBefore('なし', { in: left(147.2, 152) })));
  add(C('p6_咀嚼_問題なし', P.boxBefore('問題なし', { in: left(152, 156.5) })));
  add(C('p6_咀嚼_問題あり', P.boxBefore('問題あり', { in: left(152, 156.5) })));
  add(C('p6_咀嚼_噛みにくい', P.boxBefore('噛みにくい', { in: { x0: 13, x1: 60, y0: 156.3, y1: 161 } })));
  add(C('p6_咀嚼_時々噛みにくい', P.boxBefore('時々噛みにくい', { in: left(156.3, 161) })));
  add(C('p6_咀嚼_とても噛みにくい', P.boxBefore('とても噛みにくい', { in: left(161.5, 166) })));
  // 食事の内容
  const d1 = left(171, 176);
  add(C('p6_食事の内容_一般食', P.boxBefore('一般食', { in: d1 })));
  add(C('p6_食事の内容_糖尿食', P.boxBefore('糖尿食', { in: d1 })));
  const dm = P.find('糖尿食', { in: d1 });
  const k = P.find('K', { in: d1 });
  add(T('p6_食事の内容_糖尿食_kcal', dm.x1 + 0.5, k.y0 - 0.2, k.x0 - dm.x1 - 1, k.y1 - k.y0 + 0.4, { size: 8.5, align: 'center', fit: 'horizontal', minSize: 5 }));
  const d2 = left(175.8, 180);
  add(C('p6_食事の内容_高血圧食', P.boxBefore('高血圧食', { in: d2 })));
  add(C('p6_食事の内容_抗潰瘍食', P.boxBefore('抗潰瘍食', { in: d2 })));
  const ht = P.find('高血圧食', { in: d2 });
  const g = P.find('g', { in: d2 });
  add(T('p6_食事の内容_高血圧食_塩分g', ht.x1 + 0.5, g.y0 - 0.2, g.x0 - ht.x1 - 1, g.y1 - g.y0 + 0.4, { size: 8.5, align: 'center', fit: 'horizontal', minSize: 5 }));
  const d3 = left(180.5, 185);
  add(C('p6_食事の内容_その他', P.boxBefore('その他（', { in: d3 })));
  add(parenSlot(P, 'p6_食事の内容_その他の内容', d3, 0));

  // ---------- その他排泄の状況（左の枠） ----------
  for (const [name, y0, y1] of [['尿意', 200.5, 206], ['便意', 210, 214.5]]) {
    for (const u of URGE) add(C(`p6_${name}_${u}`, P.boxBefore(u, { in: { x0: 13, x1: 70, y0, y1 } })));
  }

  // ---------- 特記（3 つの枠） ----------
  const notes = P.findAll('【特記、解決すべき課題など】');
  const spec = [['食事', 76.9, 66.5, 111.3], ['排泄等', 76.9, 120.5, 220.2], ['外出', 76.9, 120.5, 284.4]];
  spec.forEach(([name, x, w, bottom], i) => {
    add(freeText(`p6_特記_${name}`, x, notes[i].y1 + 0.6, w, bottom - notes[i].y1 - 0.6));
  });
  return out;
}

export function inputs(data) {
  const o = {};
  Object.assign(o, surveyInputs(PG, SURVEY, data));
  Object.assign(o, assistInputs(PG, [...ASSIST_MEAL, ...ASSIST_TOILET, ...ASSIST_OUT].map(([n, k]) => [n, k]), data));

  for (const [prefix, key, choices] of [['p6_主食', 'meal.staple', STAPLE], ['p6_副食', 'meal.side', SIDE]]) {
    const m = data[key] || {};
    Object.assign(o, pickInputs(prefix, choices, m.current, m.plan));
    o[`${prefix}_現状_その他の内容`] = m.current === 'その他' ? s(m.other) : '';
    o[`${prefix}_計画_その他の内容`] = m.plan === 'その他' ? s(m.other) : '';
  }
  const ea = data['meal.eatingAssistLevel'] || {};
  Object.assign(o, levelInputs('p6_摂取介助', ea.current, ea.plan));
  for (const [prefix, key, choices] of [['p6_排尿', 'excretion.urination', URINE], ['p6_排便', 'excretion.defecation', STOOL]]) {
    const x = data[key] || {};
    Object.assign(o, levelInputs(`${prefix}介助`, x.currentLevel, x.planLevel));
    Object.assign(o, pickInputs(`${prefix}方法`, choices, x.currentMethods || [], x.planMethods || []));
  }

  const place = data['meal.place'] || [];
  for (const p of PLACE) o[`p6_食事場所_${p}`] = ck(place.includes(p));
  o['p6_食事場所_その他の内容'] = '';
  o['p6_食堂までの段差_あり'] = ck(data['meal.stepToDining'] === true);
  o['p6_食堂までの段差_なし'] = ck(data['meal.stepToDining'] === false);
  const ch = s(data['meal.chewing']);
  o['p6_咀嚼_問題なし'] = ck(ch === '問題なし');
  o['p6_咀嚼_問題あり'] = ck(ch !== '' && ch !== '問題なし'); // 「問題あり → 噛みにくい…」の 2 段のうち、上の段も印す
  for (const c of CHEW.slice(1)) o[`p6_咀嚼_${c}`] = ck(ch === c);
  const diet = data['meal.diet'] || {};
  const kinds = diet.kinds || [];
  for (const d of DIETS) o[`p6_食事の内容_${d}`] = ck(kinds.includes(d));
  o['p6_食事の内容_糖尿食_kcal'] = kinds.includes('糖尿食') ? s(diet.diabetesKcal) : '';
  o['p6_食事の内容_高血圧食_塩分g'] = kinds.includes('高血圧食') ? s(diet.saltGrams) : '';
  o['p6_食事の内容_その他の内容'] = kinds.includes('その他') ? s(diet.other) : '';

  for (const [name, key] of [['尿意', 'excretion.urgeUrine'], ['便意', 'excretion.urgeStool']]) {
    for (const u of URGE) o[`p6_${name}_${u}`] = ck(data[key] === u);
  }
  o['p6_特記_食事'] = s(data['notes.meal']);
  o['p6_特記_排泄等'] = s(data['notes.excretion']);
  o['p6_特記_外出'] = s(data['notes.outing']);
  return o;
}
