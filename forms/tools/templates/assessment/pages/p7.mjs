// アセスメント用紙 p.7（PDF の 8 ページ目）: 6-③ 認知機能、6-④ 精神・行動障害、全般の記述
// 共通の道具は ../lib-p567.mjs
import { s } from '../../../scripts/layout.mjs';
import { surveySlots, surveyInputs, freeText } from '../lib-p567.mjs';

export const pdfPage = 8;
const PG = 'p7';

const SURVEY = [];
for (let n = 1; n <= 10; n++) SURVEY.push([`3-${n}`, `survey.3_${n}`]);
for (let n = 1; n <= 21; n++) SURVEY.push([`4-${n}`, `survey.4_${n}`]);

// [欄の名前, key, x, y上, y下]。枠の中（縦書きの見出しの右）の文字の領域
const X = 98.4;
const W = 100.0;
const BOXES = [
  ['家族等からの情報と観察', 'cognition.observation', X, 18.8, 87.4, W],
  ['援助の現状_家族', 'cognition.currentByFamily', X, 95.4, 125.8, 49.6], // 点線の左
  ['援助の現状_サービス', 'cognition.currentByService', 149.4, 95.4, 125.8, 49.5], // 点線の右
  ['援助の希望_本人', 'cognition.wishPerson', X, 129.0, 163.6, W],
  ['援助の希望_家族', 'cognition.wishFamily', X, 167.1, 201.9, W],
  ['援助の計画', 'cognition.plan', X, 205.6, 240.1, W],
];

export const usesKeys = [
  ...SURVEY.map(([, k]) => k),
  ...BOXES.map(([, k]) => k),
  'notes.cognition',
];

export function slots(P) {
  const out = [];
  out.push(...surveySlots(P, PG, SURVEY, { labelX: 18.9, xMax: 90 }));
  for (const [name, , x, y0, y1, w] of BOXES) out.push(freeText(`p7_${name}`, x, y0, w, y1 - y0));
  const note = P.find('【特記、解決すべき課題など】');
  out.push(freeText('p7_特記', 92.4, note.y1 + 0.6, 106.0, 278.6 - note.y1 - 0.6));
  return out;
}

export function inputs(data) {
  const o = surveyInputs(PG, SURVEY, data);
  for (const [name, key] of BOXES) o[`p7_${name}`] = s(data[key]);
  o['p7_特記'] = s(data['notes.cognition']);
  return o;
}
