// アセスメント用紙 p.5〜p.7（6 章）で共通に使う道具。pages/ の外に置いている（pages/ には「ページ 1 枚 = 1 ファイル」だけを置くため）。
//   surveySlots / surveyInputs … 要介護認定項目の番号（1 2 3 4）を丸で囲む欄
//   assistSlots / assistInputs … 援助の現状の表（家族実施・サービス実施・希望・要援助→計画）
//   levelSlots / levelInputs   … 「□見守りのみ □見守り必要 / □介助あり □介助必要」の小さな表
//   pickSlots / pickInputs     … 縦に並んだ □ を選択肢の順に ✓ する欄（主食、排尿の方法など）
//   freeText                   … 自由記述の枠
import { textSlot as T, checkSlot as C, circleSlot as O, ck, mark, s } from '../../scripts/layout.mjs';

import FIELDS from '../../../core/fields.json' with { type: 'json' };
const BYKEY = new Map(FIELDS.fields.filter((f) => f.key).map((f) => [f.key, f]));

/** fields.json の key の選択肢（choiceSets の名前なら引く） */
export function choicesOf(key) {
  const f = BYKEY.get(key);
  if (!f) throw new Error(`fields.json に ${key} がありません`);
  return typeof f.choices === 'string' ? FIELDS.choiceSets[f.choices] : f.choices;
}

/** choiceSets の選択肢 */
export const choiceSet = (name) => FIELDS.choiceSets[name];

// ---------- 要介護認定項目の番号 ----------
/**
 * list: [['1-3', 'survey.1_3'], ...]。
 * labelX: 「1-3」の左端の x。xMax: 番号の列の右端。
 * 行の中の、右端に並ぶ「1 2 3 …」の数字を探して、選択肢の番号の欄にする。
 */
export function surveySlots(P, page, list, { labelX, xMax, pad }) {
  const all = P.lines.flatMap((l) => l.chars);
  const out = [];
  for (const [no, key] of list) {
    const lab = P.find(no, { in: { x0: labelX - 0.5, x1: labelX + 9, y0: 0, y1: P.height } });
    const row = all
      .filter((c) => c.x0 >= lab.x1 - 0.01 && c.x1 <= xMax && (c.y0 + c.y1) / 2 > lab.y0 - 0.5 && (c.y0 + c.y1) / 2 < lab.y1 + 0.5)
      .sort((a, b) => a.x0 - b.x0);
    let i = row.length;
    while (i > 0 && /^[0-9]$/.test(row[i - 1].t)) i--;
    const digits = row.slice(i);
    const choices = choicesOf(key);
    if (digits.map((d) => d.t).join('') !== choices.map((_, n) => n + 1).join('')) {
      throw new Error(`p${P.n}: ${no} の番号が選択肢の数（${choices.length}）と合いません: ${digits.map((d) => d.t).join('')}`);
    }
    digits.forEach((d, n) => out.push(O(`${page}_${no}_${n + 1}`, d, pad ?? 0.6)));
  }
  return out;
}

export function surveyInputs(page, list, data) {
  const o = {};
  for (const [no, key] of list) {
    const choices = choicesOf(key);
    const v = data[key];
    const picked = Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v];
    choices.forEach((c, n) => {
      o[`${page}_${no}_${n + 1}`] = mark(picked.includes(c));
    });
  }
  return o;
}

// ---------- 援助の現状の表 ----------
/** 表の行の上下（mm）。col（x0〜x1）を横切る横線の間隔から求める */
function rowBands(P, x0, x1, yFrom, yTo) {
  const ys = P.hlines
    .filter(([y, a, b]) => y >= yFrom && y <= yTo && a <= x0 + 0.6 && b >= x1 - 0.6)
    .map((l) => l[0])
    .sort((a, b) => a - b);
  const u = [];
  for (const y of ys) if (!u.length || y - u[u.length - 1] > 0.8) u.push(y);
  return u.slice(0, -1).map((y, i) => [y, u[i + 1]]);
}

/**
 * 援助の現状の表の欄。
 *  cols: [家族実施の左, サービス実施の左, 希望の左, 計画の左, 計画の右] の x
 *  labelIn: 行の名前（「1）体位変換介助」）がある範囲（x0, x1, y0, y1）。y の範囲は表全体
 *  rows: [[欄の名前, 行の名前の文字], ...]
 */
export function assistSlots(P, page, { cols, labelIn, rows }) {
  const bands = rowBands(P, cols[2], cols[3], labelIn.y0, labelIn.y1);
  const heads = ['家族実施', 'サービス実施', '希望', '計画'];
  const out = [];
  for (const [name, label] of rows) {
    const lab = P.find(label, { in: labelIn });
    const cy = (lab.y0 + lab.y1) / 2;
    const band = bands.find(([a, b]) => a <= cy && cy <= b);
    if (!band) throw new Error(`p${P.n}: 「${label}」の行の罫線が見つかりません`);
    heads.forEach((h, k) => {
      out.push(T(`${page}_${name}_${h}`, cols[k] + 0.3, band[0] + 0.3, cols[k + 1] - cols[k] - 0.6, band[1] - band[0] - 0.6, { size: 10, align: 'center' }));
    });
  }
  return out;
}

/** rows: [[欄の名前, fields.json の key], ...]。表には記号だけを印字する（括弧の説明は付けない） */
export function assistInputs(page, rows, data) {
  const o = {};
  for (const [name, key] of rows) {
    const a = data[key] || {};
    o[`${page}_${name}_家族実施`] = s(a.family).charAt(0);
    o[`${page}_${name}_サービス実施`] = a.service ? '○' : '';
    o[`${page}_${name}_希望`] = a.wish ? '○' : '';
    o[`${page}_${name}_計画`] = s(a.plan).charAt(0);
  }
  return o;
}

// ---------- 現状／計画の小さな表 ----------
/** region の中の「見守りのみ・介助あり・見守り必要・介助必要」の □ に ✓ */
export function levelSlots(P, prefix, region) {
  return [
    C(`${prefix}_現状_見守りのみ`, P.boxBefore('見守りのみ', { in: region })),
    C(`${prefix}_現状_介助あり`, P.boxBefore('介助あり', { in: region })),
    C(`${prefix}_計画_見守り必要`, P.boxBefore('見守り必要', { in: region })),
    C(`${prefix}_計画_介助必要`, P.boxBefore('介助必要', { in: region })),
  ];
}

export function levelInputs(prefix, current, plan) {
  return {
    [`${prefix}_現状_見守りのみ`]: ck(current === '見守りのみ'),
    [`${prefix}_現状_介助あり`]: ck(current === '介助あり'),
    [`${prefix}_計画_見守り必要`]: ck(plan === '見守り必要'),
    [`${prefix}_計画_介助必要`]: ck(plan === '介助必要'),
  };
}

/** 縦に並んだ □ を上から選択肢の順に対応させる（現状の列と計画の列） */
export function pickSlots(P, prefix, choices, curRegion, planRegion) {
  const out = [];
  for (const [col, region] of [['現状', curRegion], ['計画', planRegion]]) {
    const boxes = P.boxes({ in: region });
    if (boxes.length !== choices.length) throw new Error(`p${P.n}: ${prefix}_${col} の □ が ${boxes.length} 個（選択肢は ${choices.length} 個）`);
    boxes.forEach((b, i) => out.push(C(`${prefix}_${col}_${choices[i]}`, b)));
  }
  return out;
}

export function pickInputs(prefix, choices, current, plan) {
  const o = {};
  const cur = Array.isArray(current) ? current : [current];
  const pl = Array.isArray(plan) ? plan : [plan];
  for (const c of choices) {
    o[`${prefix}_現状_${c}`] = ck(cur.includes(c));
    o[`${prefix}_計画_${c}`] = ck(pl.includes(c));
  }
  return o;
}

// ---------- 自由記述 ----------
export function freeText(name, x, y, w, h, size = 9) {
  return T(name, x, y, w, h, { size, valign: 'top', fit: 'vertical', minSize: 6, lineHeight: 1.3 });
}

/** 「（　）」の間（同じ範囲の中で、n 番目の（ と ）の間）の文字欄 */
export function parenSlot(P, name, region, n, size = 8.5) {
  const o = P.findAll('（', { in: region })[n];
  const c = P.findAll('）', { in: region })[n];
  if (!o || !c) throw new Error(`p${P.n}: ${name} の（ ）が見つかりません`);
  return T(name, o.x1 + 0.2, o.y0 - 0.2, c.x0 - o.x1 - 0.4, o.y1 - o.y0 + 0.4, { size, fit: 'horizontal', minSize: 5 });
}

export { ck, mark, s };
