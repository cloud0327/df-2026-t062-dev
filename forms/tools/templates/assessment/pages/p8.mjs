// アセスメント用紙 p.8（PDF の 9 ページ目）: 6-⑤ 社会生活（への適応）力
import { textSlot as T, checkSlot as C, circleSlot as O, ck, mark, s } from '../../../scripts/layout.mjs';

export const pdfPage = 9;

export const usesKeys = [
  'survey.5_1', 'survey.5_2', 'survey.5_3', 'survey.5_4', 'survey.5_5', 'survey.5_6', 'survey.5_7', 'survey.5_8', 'survey.5_9',
  'assist.moneyManagement', 'assist.shopping', 'assist.cooking', 'assist.houseworkPrep',
  'assist.consultation', 'assist.paperwork', 'assist.leisure', 'assist.transport', 'assist.readWrite',
  'assist.companion', 'assist.safetyCheck', 'assist.emergencyMeans', 'assist.familyContact', 'assist.socialActivity',
  'social.family', 'social.neighbors', 'social.friends',
  'watchMethod', 'notes.socialLife',
];

// 要介護認定項目 5-1〜5-9（選択肢の順番 + 1 が、印刷された番号）
const KAIJO3 = ['介助されていない', '一部介助', '全介助'];
const KAIJO4 = ['介助されていない', '見守り等', '一部介助', '全介助'];
const SURVEY = [
  ['5-1', 'survey.5_1', KAIJO3, 17.94, 25.94],
  ['5-2', 'survey.5_2', KAIJO3, 25.94, 33.94],
  ['5-3', 'survey.5_3', ['できる（特別な場合でもできる）', '特別な場合を除いてできる', '日常的に困難', 'できない'], 33.94, 41.94],
  ['5-4', 'survey.5_4', ['ない', 'ときどきある', 'ある'], 41.94, 49.94],
  ['5-5', 'survey.5_5', KAIJO4, 49.94, 57.94],
  ['5-6', 'survey.5_6', KAIJO4, 57.94, 65.94],
  ['5-7', 'survey.5_7', ['1', '2', '3'], 65.94, 73.94],
  ['5-8', 'survey.5_8', ['1', '2', '3'], 73.94, 81.94],
  ['5-9', 'survey.5_9', ['1', '2'], 81.94, 89.94],
];

// 援助の現状の表（行の罫線の y）。列は 家族実施・サービス実施・希望・要援助→計画
const COLS = [[113, 125, '家族実施'], [125, 137, 'サービス実施'], [137, 149, '希望'], [149, 161, '計画']];
const T1 = [34.94, 42.94, 50.94, 58.94, 66.94];
const T2 = [78.94, 88.7, 98.4, 108.2, 117.9, 127.7, 137.4, 147.2, 156.9, 166.7, 176.4];
const ASSIST = [
  ['金銭管理', 'assist.moneyManagement', T1, 0],
  ['買い物', 'assist.shopping', T1, 1],
  ['調理', 'assist.cooking', T1, 2],
  ['準備・後始末', 'assist.houseworkPrep', T1, 3],
  ['定期的な相談・助言', 'assist.consultation', T2, 0],
  ['各種書類作成代行', 'assist.paperwork', T2, 1],
  ['余暇活動支援', 'assist.leisure', T2, 2],
  ['移送・外出介助', 'assist.transport', T2, 3],
  ['代読・代筆', 'assist.readWrite', T2, 4],
  ['話し相手', 'assist.companion', T2, 5],
  ['安否確認', 'assist.safetyCheck', T2, 6],
  ['緊急連絡手段の確保', 'assist.emergencyMeans', T2, 7],
  ['家族連絡の確保', 'assist.familyContact', T2, 8],
  ['社会活動への支援', 'assist.socialActivity', T2, 9],
];

const SOCIAL = [
  ['家族等近親者との交流', 'social.family', 107.7],
  ['地域近隣との交流', 'social.neighbors', 117.2],
  ['友人知人との交流', 'social.friends', 126.7],
];

export function slots(P) {
  const out = [];
  const add = (...a) => out.push(...a.flat());

  // ---------- 要介護認定項目 5-1〜5-9: 選んだ番号を丸で囲む ----------
  for (const [no, , choices, y0, y1] of SURVEY) {
    const row = { x0: 66, x1: 86, y0, y1 };
    choices.forEach((_, i) => {
      add(O(`p8_${no}_${i + 1}`, P.find(String(i + 1), { in: row }), 0.9));
    });
  }

  // ---------- 援助の現状の表 ----------
  for (const [label, , rows, i] of ASSIST) {
    const y0 = rows[i];
    const h = rows[i + 1] - y0;
    for (const [x0, x1, col] of COLS) {
      add(T(`p8_援助_${label}_${col}`, x0, y0 + 0.5, x1 - x0, h - 1, { size: 11, align: 'center' }));
    }
  }

  // ---------- 社会活動の状況: □あり（　）□なし ----------
  for (const [label, , y] of SOCIAL) {
    const row = { x0: 15, x1: 82, y0: y - 0.4, y1: y + 3.7 };
    const open = P.find('（', { in: row });
    const close = P.find('）', { in: row });
    add(C(`p8_社会活動_${label}_あり`, P.boxBefore('あり', { in: row })));
    add(C(`p8_社会活動_${label}_なし`, P.boxBefore('なし', { in: row })));
    add(T(`p8_社会活動_${label}_内容`, open.x1 + 0.3, open.y0 - 0.2, close.x0 - open.x1 - 0.6, open.y1 - open.y0 + 0.4, { size: 8.5, fit: 'horizontal', minSize: 5 }));
  }

  // ---------- 緊急連絡・見守りの方法、特記 ----------
  add(T('p8_緊急連絡・見守りの方法', 35.5, 136.5, 49.8, 11.0, { size: 9, valign: 'top', fit: 'vertical', minSize: 5.5, lineHeight: 1.2 }));
  add(T('p8_特記', 13.5, 188.0, 183.0, 53.5, { size: 9, valign: 'top', fit: 'vertical', minSize: 6, lineHeight: 1.3 }));

  return out;
}

// ---------- データ → 欄の値 ----------
export function inputs(data) {
  const v = (k) => data[k];
  const o = {};

  for (const [no, key, choices] of SURVEY) {
    const val = s(v(key));
    choices.forEach((_, i) => {
      o[`p8_${no}_${i + 1}`] = mark(val !== '' && choices.indexOf(val) === i);
    });
  }

  for (const [label, key] of ASSIST) {
    const a = v(key) || {};
    o[`p8_援助_${label}_家族実施`] = a.family ? s(a.family)[0] : '';
    o[`p8_援助_${label}_サービス実施`] = a.service ? '○' : '';
    o[`p8_援助_${label}_希望`] = a.wish ? '○' : '';
    o[`p8_援助_${label}_計画`] = a.plan ? s(a.plan)[0] : '';
  }

  for (const [label, key] of SOCIAL) {
    const h = v(key) || {};
    o[`p8_社会活動_${label}_あり`] = ck(h.has === true);
    o[`p8_社会活動_${label}_なし`] = ck(h.has === false);
    o[`p8_社会活動_${label}_内容`] = h.has === true ? s(h.detail) : '';
  }

  o['p8_緊急連絡・見守りの方法'] = s(v('watchMethod'));
  o['p8_特記'] = s(v('notes.socialLife'));
  return o;
}
