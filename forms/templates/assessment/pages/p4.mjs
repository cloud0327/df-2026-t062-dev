// アセスメント用紙 p.4（PDF の 5 ページ目）: 5 本人の健康状態・受診等の状況
// 書き方は p1.mjs と同じ。欄の名前は「p4_…」。
// 図（人体図 health.bodyMap）は人が描くので欄を作らない。
import { textSlot as T, checkSlot as C, circleSlot as O, ck, mark, s } from '../../../scripts/layout.mjs';

export const pdfPage = 5;

export const usesKeys = [
  'health.history', 'health.height', 'health.weight', 'health.teeth', 'health.notes',
  'health.visits', 'health.homeVisitInstitution', 'health.emergencyInstitution', 'health.pharmacy',
  'health.lifeNotes',
];

const R = (x0, x1, y0, y1) => ({ x0, x1, y0, y1 });
const arr = (v) => (Array.isArray(v) ? v : []);
const r2 = (n) => Math.round(n * 100) / 100;

/** hit と同じ行で、hit の左にいちばん近い「□」 */
function nearestBox(P, hit) {
  const yc = (hit.y0 + hit.y1) / 2;
  const cands = P.boxes({ in: { x0: hit.x0 - 12, x1: hit.x0 + 1, y0: hit.y0 - 2, y1: hit.y1 + 2 } })
    .sort((a, b) => Math.abs((a.y0 + a.y1) / 2 - yc) - Math.abs((b.y0 + b.y1) / 2 - yc) || b.x0 - a.x0);
  if (!cands[0]) throw new Error(`p${P.n}: 「${hit.chars.map((c) => c.t).join('')}」の前に □ がありません`);
  const b = cands[0];
  return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
}

// ---------- 受診状況の表（罫線から） ----------
// 4 列。列の左右の罫線と、行の上下の罫線
const COLS = [34.33, 75.38, 116.43, 157.48, 198.53];
const ROWS = {
  病名: [145.2, 153.13],
  薬の有無: [153.13, 161.07],
  発症時期: [161.07, 171.07],
  受診頻度: [171.07, 182.96],
  受診状況: [182.96, 190.91],
  医療機関: [190.91, 198.85],
  診療科: [198.85, 206.8],
  主治医: [206.8, 214.74],
  連絡先: [214.74, 222.69],
  留意点: [222.69, 231.49],
};
const N_VISITS = 4;

// 往診可能な医療機関 / 緊急入院できる医療機関 / かかりつけ薬局（行の高さ）
const INSTITUTIONS = [
  ['往診可能な医療機関', 'health.homeVisitInstitution', R(48, 199, 231.6, 241.4)],
  ['緊急入院できる医療機関', 'health.emergencyInstitution', R(48, 199, 241.6, 251.3)],
  ['かかりつけ薬局', 'health.pharmacy', R(48, 199, 251.5, 261.3)],
];

export function slots(P) {
  const out = [];
  const add = (...a) => out.push(...a.flat());

  // ---------- 既往歴・現症（5 本の点線、約 8mm ごと。最初の行は「※要介護状態に…」の下） ----------
  add(T('p4_既往歴・現症', 13.5, 35.4, 98.5, 48.5, { size: 9, valign: 'top', lineHeight: 7.97 / (9 * 0.3528), fit: 'vertical', minSize: 6 }));

  // ---------- 身長・体重 ----------
  const cm = P.find('cm', { in: R(40, 70, 82, 90) });
  add(T('p4_身長', 34.5, 82.6, cm.x0 - 0.8 - 34.5, 6.4, { size: 10, align: 'right', fit: 'horizontal', minSize: 6 }));
  const kg = P.find('kg', { in: R(90, 115, 82, 90) });
  add(T('p4_体重', 83.5, 82.6, kg.x0 - 0.8 - 83.5, 6.4, { size: 10, align: 'right', fit: 'horizontal', minSize: 6 }));

  // ---------- 歯の状況 ----------
  for (const t of ['歯あり', '歯なし', '総入れ歯', '局部義歯']) {
    add(C(`p4_歯の状況_${t}`, nearestBox(P, P.find(t, { in: R(33, 112, 91, 97) }))));
  }

  // ---------- 特記事項 ----------
  add(T('p4_特記事項', 13.5, 107.4, 184.0, 21.2, { size: 9, valign: 'top', fit: 'vertical', minSize: 6 }));

  // ---------- 現在の受診状況（4 列） ----------
  for (let i = 0; i < N_VISITS; i++) {
    const n = i + 1;
    const [c0, c1] = [COLS[i], COLS[i + 1]];
    const cell = (row) => ({ y0: ROWS[row][0], y1: ROWS[row][1] });
    const text = (name, row, opts = {}) => {
      const { y0, y1 } = cell(row);
      add(T(`p4_受診${n}_${name}`, c0 + 1, y0 + 0.6, c1 - c0 - 2, y1 - y0 - 1.2, { size: 9, fit: 'horizontal', minSize: 5, ...opts }));
    };
    const rowReg = (row) => R(c0, c1, ROWS[row][0], ROWS[row][1]);

    text('病名', '病名', { size: 10 });
    for (const [label, name] of [['有', '薬あり'], ['無', '薬なし']]) {
      add(C(`p4_受診${n}_${name}`, nearestBox(P, P.find(label, { in: rowReg('薬の有無') }))));
    }
    text('発症時期', '発症時期', { size: 8.5 });

    // 受診頻度: □定期（週・月　回）／□不定期
    const fr = rowReg('受診頻度');
    add(C(`p4_受診${n}_定期`, nearestBox(P, P.find('定期', { in: fr }))));
    const futei = P.find('不定期', { in: fr });
    add(C(`p4_受診${n}_不定期`, nearestBox(P, futei)));
    // 「月 1 回」の形に分けられない頻度（2週に1回 など）は、「不定期」の右の空きに書く
    add(T(`p4_受診${n}_頻度_補足`, futei.x1 + 1.5, futei.y0 - 0.5, c1 - 1 - futei.x1 - 1.5, futei.y1 - futei.y0 + 0.9, { size: 8.5, fit: 'horizontal', minSize: 5 }));
    const wk = P.find('週', { in: fr });
    const mo = P.find('月', { in: fr });
    const kai = P.find('回', { in: R(mo.x1, c1, fr.y0, fr.y1) });
    // 小さな文字は印字が文字の枠より 0.8mm ほど上なので、丸も上げる
    for (const [nm, hit] of [['週', wk], ['月', mo]]) {
      const c = O(`p4_受診${n}_頻度_${nm}`, hit);
      c.position.y = r2(c.position.y - 0.8);
      add(c);
    }
    add(T(`p4_受診${n}_頻度_回数`, mo.x1 + 0.3, mo.y0 - 0.9, kai.x0 - mo.x1 - 0.6, mo.y1 - mo.y0 + 0.4, { size: 8.5, align: 'center', fit: 'horizontal', minSize: 5 }));

    const vr = rowReg('受診状況');
    add(C(`p4_受診${n}_通院`, nearestBox(P, P.find('通院', { in: vr }))));
    add(C(`p4_受診${n}_往診`, nearestBox(P, P.find('往診', { in: vr }))));

    text('医療機関', '医療機関');
    text('診療科', '診療科');
    text('主治医', '主治医');
    const tel = P.find('☎', { in: rowReg('連絡先') });
    add(T(`p4_受診${n}_連絡先`, tel.x1 + 0.8, tel.y0 - 1.0, c1 - 1 - tel.x1 - 0.8, tel.y1 - tel.y0 + 0.4, { size: 9, fit: 'horizontal', minSize: 5 }));
    const { y0, y1 } = cell('留意点');
    add(T(`p4_受診${n}_留意点`, c0 + 1, y0 + 0.5, c1 - c0 - 2, y1 - y0 - 1.0, { size: 8.5, fit: 'vertical', minSize: 5, lineHeight: 1.15 }));
  }

  // ---------- 往診可能な医療機関 / 緊急入院できる医療機関 / かかりつけ薬局 ----------
  for (const [label, , reg] of INSTITUTIONS) {
    add(C(`p4_${label}_無`, nearestBox(P, P.find('無', { in: reg }))));
    add(C(`p4_${label}_有`, nearestBox(P, P.find('有', { in: reg }))));
    const open = P.find('（', { in: reg });
    const close = P.find('）', { in: { ...reg, x0: open.x1 } });
    add(T(`p4_${label}_名称`, open.x1 + 0.3, open.y0 - 0.2, close.x0 - open.x1 - 0.6, open.y1 - open.y0 + 0.4, { size: 9, fit: 'horizontal', minSize: 5 }));
    const tel = P.find('☎', { in: reg });
    add(T(`p4_${label}_電話`, tel.x1 + 1.0, tel.y0 - 1.0, 197.5 - tel.x1 - 1.0, tel.y1 - tel.y0 + 0.4, { size: 9, fit: 'horizontal', minSize: 5 }));
  }

  // ---------- 特記、生活上配慮すべき課題など ----------
  const head = P.find('【特記、生活上配慮', { in: R(10, 100, 261, 267) });
  add(T('p4_特記生活上配慮', 13.5, r2(head.y1 + 0.8), 184.0, r2(284.4 - head.y1 - 0.8), { size: 9, valign: 'top', fit: 'vertical', minSize: 6 }));
  return out;
}

// ---------- データ → 欄の値 ----------
export function inputs(data) {
  const v = (k) => data[k];
  const o = {};

  o['p4_既往歴・現症'] = s(v('health.history'));
  o['p4_身長'] = s(v('health.height'));
  o['p4_体重'] = s(v('health.weight'));
  const teeth = arr(v('health.teeth'));
  for (const t of ['歯あり', '歯なし', '総入れ歯', '局部義歯']) o[`p4_歯の状況_${t}`] = ck(teeth.includes(t));
  o['p4_特記事項'] = s(v('health.notes'));

  const visits = arr(v('health.visits'));
  for (let i = 0; i < N_VISITS; i++) {
    const n = i + 1;
    const x = visits[i] || {};
    const regular = x.frequencyType === '定期';
    o[`p4_受診${n}_病名`] = s(x.disease);
    o[`p4_受診${n}_薬あり`] = ck(x.medication === true);
    o[`p4_受診${n}_薬なし`] = ck(x.medication === false);
    o[`p4_受診${n}_発症時期`] = s(x.onset);
    o[`p4_受診${n}_定期`] = ck(x.frequencyType === '定期');
    o[`p4_受診${n}_不定期`] = ck(x.frequencyType === '不定期');
    o[`p4_受診${n}_頻度_週`] = mark(regular && x.frequencyUnit === '週');
    o[`p4_受診${n}_頻度_月`] = mark(regular && x.frequencyUnit === '月');
    o[`p4_受診${n}_頻度_回数`] = regular ? s(x.frequencyCount) : '';
    o[`p4_受診${n}_頻度_補足`] = regular ? s(x.frequencyNote) : '';
    o[`p4_受診${n}_通院`] = ck(x.visitType === '通院');
    o[`p4_受診${n}_往診`] = ck(x.visitType === '往診');
    o[`p4_受診${n}_医療機関`] = s(x.institution);
    o[`p4_受診${n}_診療科`] = s(x.department);
    o[`p4_受診${n}_主治医`] = s(x.doctor);
    o[`p4_受診${n}_連絡先`] = s(x.phone);
    o[`p4_受診${n}_留意点`] = s(x.notes);
  }

  for (const [label, key] of INSTITUTIONS) {
    const inst = v(key) || {};
    const present = inst.has === true || (inst.has == null && !!inst.name);
    o[`p4_${label}_無`] = ck(inst.has === false);
    o[`p4_${label}_有`] = ck(present);
    o[`p4_${label}_名称`] = s(inst.name);
    o[`p4_${label}_電話`] = s(inst.phone);
  }

  o['p4_特記生活上配慮'] = s(v('health.lifeNotes'));
  return o;
}
