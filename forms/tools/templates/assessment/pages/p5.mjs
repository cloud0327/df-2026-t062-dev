// アセスメント用紙 p.5（PDF の 6 ページ目）: 6-① 基本（身体機能・起居）動作
// 共通の道具は ../lib-p567.mjs
import { checkSlot as C, ck, s } from '../../../scripts/layout.mjs';
import {
  surveySlots, surveyInputs, assistSlots, assistInputs, levelSlots, levelInputs, freeText, parenSlot,
} from '../lib-p567.mjs';

export const pdfPage = 6;
const PG = 'p5';

const SURVEY = [];
for (let n = 1; n <= 14; n++) SURVEY.push([`1-${n}`, `survey.1_${n}`]);

const ASSIST_TOP = [
  ['体位変換介助', 'assist.positionChange', '1）体位変換介助'],
  ['起居介助', 'assist.rising', '2）起居介助'],
];
const ASSIST_BATH = [
  ['入浴_準備後始末', 'assist.bathPrep', '1）準備・後始末'],
  ['入浴_移乗移動介助', 'assist.bathTransfer', '2）移乗移動介助'],
  ['入浴_洗身介助', 'assist.bodyWash', '3）洗身介助'],
  ['入浴_洗髪介助', 'assist.hairWash', '4）洗髪介助'],
  ['入浴_清拭部分浴', 'assist.partialBath', '5）清拭・部分浴'],
  ['入浴_褥瘡皮膚疾患', 'assist.skinCare', '6）褥瘡・皮膚疾患'],
];

export const usesKeys = [
  ...SURVEY.map(([, k]) => k),
  ...ASSIST_TOP.map(([, k]) => k),
  ...ASSIST_BATH.map(([, k]) => k),
  'rehabNeeded', 'notes.basicMovement',
  'assist.bathTransferLevel', 'assist.bodyWashLevel', 'notes.bath',
  'communication.aids', 'communication.phone', 'communication.speechDisorder', 'communication.supportDevice', 'notes.communication',
];

// 援助の現状の表の列（家族実施・サービス実施・希望・要援助→計画の左端と、計画の右端）
const COLS = [111.42, 123.41, 135.41, 147.4, 162.22];
const AIDS = ['眼鏡使用', 'コンタクト使用', '補聴器使用'];

export function slots(P) {
  const out = [];
  const add = (...a) => out.push(...a.flat());

  // ---------- 要介護認定項目の番号 ----------
  add(surveySlots(P, PG, SURVEY.slice(0, 13), { labelX: 21.9, xMax: 90 }));
  add(surveySlots(P, PG, SURVEY.slice(13), { labelX: 21.9, xMax: 90, pad: 0.3 })); // 1-14 は数字が詰まっている

  // ---------- 体位変換・起居 ----------
  add(assistSlots(P, PG, { cols: COLS, labelIn: { x0: 91, x1: 111.4, y0: 38, y1: 65 }, rows: ASSIST_TOP.map(([n, , l]) => [n, l]) }));
  add(C('p5_リハビリ_あり', P.boxBefore('あり→P', { in: { x0: 165, x1: 200, y0: 52, y1: 59 } })));
  add(C('p5_リハビリ_なし', P.boxBefore('なし', { in: { x0: 165, x1: 200, y0: 59.5, y1: 64 } })));

  // ---------- 特記（3 つの枠。【特記、…】の下から枠の下まで） ----------
  const notes = P.findAll('【特記、解決すべき課題など】');
  const noteBottom = [117.5, 233.7, 278.7];
  ['基本動作', '入浴', 'コミュニケーション'].forEach((name, i) => {
    const lab = notes[i];
    add(freeText(`p5_特記_${name}`, 92.4, lab.y1 + 0.6, 105.6, noteBottom[i] - lab.y1 - 0.6));
  });

  // ---------- 入浴 ----------
  add(assistSlots(P, PG, { cols: COLS, labelIn: { x0: 91, x1: 111.4, y0: 128.5, y1: 190 }, rows: ASSIST_BATH.map(([n, , l]) => [n, l]) }));
  add(levelSlots(P, 'p5_入浴_移乗移動介助_現状計画', { x0: 160, x1: 207, y0: 146.5, y1: 156 }));
  add(levelSlots(P, 'p5_入浴_洗身介助_現状計画', { x0: 160, x1: 207, y0: 160.5, y1: 170 }));

  // ---------- コミュニケーションの状況（左下の枠） ----------
  const box = (y0, y1) => ({ x0: 13, x1: 90, y0, y1 });
  for (const a of AIDS) add(C(`p5_視聴覚_${a}`, P.boxBefore(a, { in: box(243, 248) })));
  add(C('p5_電話_あり', P.boxBefore('あり', { in: box(253, 258) })));
  add(C('p5_電話_なし', P.boxBefore('なし', { in: box(253, 258) })));
  for (const [name, y0, y1] of [['言語障害', 263, 268], ['支援機器', 273, 278]]) {
    add(C(`p5_${name}_あり`, P.boxBefore('あり', { in: box(y0, y1) })));
    add(C(`p5_${name}_なし`, P.boxBefore('なし', { in: box(y0, y1) })));
    add(parenSlot(P, `p5_${name}_内容`, box(y0, y1), 0));
  }
  return out;
}

export function inputs(data) {
  const o = {};
  Object.assign(o, surveyInputs(PG, SURVEY, data));
  Object.assign(o, assistInputs(PG, ASSIST_TOP.map(([n, k]) => [n, k]), data));
  Object.assign(o, assistInputs(PG, ASSIST_BATH.map(([n, k]) => [n, k]), data));
  o['p5_リハビリ_あり'] = ck(data.rehabNeeded === true);
  o['p5_リハビリ_なし'] = ck(data.rehabNeeded === false);
  o['p5_特記_基本動作'] = s(data['notes.basicMovement']);
  o['p5_特記_入浴'] = s(data['notes.bath']);
  o['p5_特記_コミュニケーション'] = s(data['notes.communication']);
  const lv = (k) => data[k] || {};
  Object.assign(o, levelInputs('p5_入浴_移乗移動介助_現状計画', lv('assist.bathTransferLevel').current, lv('assist.bathTransferLevel').plan));
  Object.assign(o, levelInputs('p5_入浴_洗身介助_現状計画', lv('assist.bodyWashLevel').current, lv('assist.bodyWashLevel').plan));

  const aids = data['communication.aids'] || [];
  for (const a of AIDS) o[`p5_視聴覚_${a}`] = ck(aids.includes(a));
  o['p5_電話_あり'] = ck(data['communication.phone'] === true);
  o['p5_電話_なし'] = ck(data['communication.phone'] === false);
  for (const [name, key] of [['言語障害', 'communication.speechDisorder'], ['支援機器', 'communication.supportDevice']]) {
    const h = data[key] || {};
    o[`p5_${name}_あり`] = ck(h.has === true);
    o[`p5_${name}_なし`] = ck(h.has === false);
    o[`p5_${name}_内容`] = h.has === true ? s(h.detail) : '';
  }
  return o;
}
