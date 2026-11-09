// アセスメント用紙 p.9（PDF の 10 ページ目）: 6-⑥ 医療・健康関係、介護に関する医師の意見
import { textSlot as T, checkSlot as C, circleSlot as O, ck, mark, s } from '../../../scripts/layout.mjs';

export const pdfPage = 10;

export const usesKeys = [
  'survey.medical',
  'assist.vitalObservation', 'assist.medicineManagement', 'assist.medicineUse', 'assist.visitAccompany', 'assist.rehabilitation', 'assist.medicalProcedure',
  'medical.careDetails', 'notes.medical',
  'doctor.outdoorWalking', 'doctor.wheelchair', 'doctor.walkingAids', 'doctor.eating', 'doctor.nutrition', 'doctor.nutritionNotes',
  'doctor.likelyConditions', 'doctor.likelyConditionsPolicy', 'doctor.prognosis', 'doctor.medicalManagement',
  'doctor.serviceCautions', 'doctor.infection',
];

// ---------- 特別な医療 1〜12（左の表）。行の罫線の y ----------
const MEDICAL_ROWS = [18.0, 28.0, 38.0, 48.0, 58.0, 68.0, 78.0, 88.0, 98.0, 108.0, 122.0, 136.0, 154.0];

// ---------- 援助の現状の表（6 行）。列は 家族実施・サービス実施・希望・要援助→計画 ----------
const COLS = [[86, 98, '家族実施'], [98, 110, 'サービス実施'], [110, 122, '希望'], [122, 134, '計画']];
const ROWS = [28.0, 37.0, 46.0, 55.0, 64.0, 73.0, 82.0];
const ASSIST = [
  ['測定・観察', 'assist.vitalObservation'],
  ['薬剤の管理', 'assist.medicineManagement'],
  ['薬剤の使用', 'assist.medicineUse'],
  ['受診・検査介助', 'assist.visitAccompany'],
  ['リハビリテーション', 'assist.rehabilitation'],
  ['医療処置の管理', 'assist.medicalProcedure'],
];

// ---------- 具体的内容（現状・計画の □）。fields.json の medical.careDetails の item の順 ----------
const CARE_ITEMS = [
  'バイタルサインのチェック', '定期的な病状観察', '内服薬', '坐薬（緩下剤、解熱剤等）', '眼・耳・鼻等の外用薬の使用等',
  '温・冷あん法、湿布貼付等', '注射', '吸引', '吸入', '自己注射（インスリン療法）', '経管栄養法', '中心静脈栄養法',
  '酸素療法', '人工呼吸療法', '気管カニューレ管理', '自己導尿', '自己腹膜灌流', '膀胱留置カテーテル管理', '人工肛門・人工膀胱管理',
  '疼痛管理', '褥瘡管理',
];

// ---------- 医師の意見: [データの key, 欄の名前の中身, 印刷された選択肢の字, その行の y（印刷された字の上端）] ----------
const DOC_CHOICES = [
  // (1) 移動
  ['doctor.outdoorWalking', '屋外歩行', 173.3, ['自立', '介助があればしている', 'していない']],
  ['doctor.wheelchair', '車いすの使用', 178.3, ['用いていない', '主に自分で操作している', '主に他人が操作している']],
  ['doctor.walkingAids', '歩行補助具・装具の使用', 183.3, ['用いていない', '屋外で使用', '屋内で使用']],
  // (2) 栄養・食生活
  ['doctor.eating', '食事行為', 192.2, ['自立ないし何とか自分で食べられる', '全面介助']],
  ['doctor.nutrition', '現在の栄養状態', 197.2, ['良好', '不良']],
  // (4) 見通し
  ['doctor.prognosis', '見通し', 230.5, ['期待できる', '期待できない', '不明']],
];
// (3) 現在あるかまたは今後発生の可能性の高い状態（2 行）
const LIKELY_ROWS = [
  [211.0, ['尿失禁', '転倒・骨折', '移動能力の低下', '褥瘡', '心肺機能の低下', '閉じこもり', '意欲低下', '徘徊']],
  [216.0, ['低栄養', '摂食・嚥下機能低下', '脱水', '易感染性', 'がん等による疼痛', 'その他']],
];
// (5) 医学的管理の必要性（4 行）
const MGMT_ROWS = [
  [239.4, ['訪問診療', '訪問看護', '訪問歯科診療', '訪問薬剤管理指導']],
  [242.8, ['訪問リハビリテーション', '短期入所療養介護', '訪問歯科衛生指導', '訪問栄養食事指導']],
  [246.2, ['通所リハビリテーション', '老人保健施設', '介護医療院', 'その他の医療系サービス']],
  [249.7, ['特記すべき項目なし']],
];
// (6) 留意事項: [データの項目, 表示名, 行の y, その行の何番目の（ ）か]
const CAUTIONS = [
  ['bloodPressure', '血圧', 258.8, 0],
  ['eating', '摂食', 258.8, 1],
  ['swallowing', '嚥下', 258.8, 2],
  ['moving', '移動', 262.7, 0],
  ['exercise', '運動', 262.7, 1],
  ['other', 'その他', 262.7, 2],
];

const rowAt = (y) => ({ x0: 12, x1: 200, y0: y - 0.4, y1: y + 3.7 });
const LIKELY = LIKELY_ROWS.flatMap(([, labels]) => labels);
const MGMT = MGMT_ROWS.flatMap(([, labels]) => labels);

/** 「（　）」の中の文字の欄 */
function parenSlot(P, name, y, nth = 0) {
  const row = rowAt(y);
  const open = P.find('（', { in: row, nth });
  const close = P.find('）', { in: row, nth });
  return T(name, open.x1 + 0.3, open.y0 - 0.2, close.x0 - open.x1 - 0.6, open.y1 - open.y0 + 0.4, { size: 8.5, fit: 'horizontal', minSize: 5 });
}

export function slots(P) {
  const out = [];
  const add = (...a) => out.push(...a.flat());

  // ---------- 特別な医療 1〜12: 選んだ項目の番号を丸で囲む ----------
  for (let n = 1; n <= 12; n++) {
    const row = { x0: 24, x1: 34, y0: MEDICAL_ROWS[n - 1], y1: MEDICAL_ROWS[n] };
    add(O(`p9_特別な医療_${n}`, P.find(`${n}.`, { in: row }), 0.8));
  }

  // ---------- 援助の現状の表 ----------
  ASSIST.forEach(([label], i) => {
    const y0 = ROWS[i];
    const h = ROWS[i + 1] - y0;
    for (const [x0, x1, col] of COLS) {
      add(T(`p9_援助_${label}_${col}`, x0, y0 + 0.5, x1 - x0, h - 1, { size: 11, align: 'center' }));
    }
  });

  // ---------- 具体的内容: 現状・計画の □ ----------
  const boxes = P.boxes({ in: { x0: 141, x1: 150, y0: 28, y1: 150 } }).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  if (boxes.length !== CARE_ITEMS.length * 2) throw new Error(`p9: 具体的内容の □ の数が ${boxes.length} 個（42 個のはず）`);
  CARE_ITEMS.forEach((item, i) => {
    add(C(`p9_具体的内容_${item}_現状`, boxes[i * 2]));
    add(C(`p9_具体的内容_${item}_計画`, boxes[i * 2 + 1]));
  });

  // ---------- 特記 ----------
  add(T('p9_特記', 67.5, 90.3, 65.0, 62.5, { size: 9, valign: 'top', fit: 'vertical', minSize: 6, lineHeight: 1.3 }));

  // ---------- 医師の意見 ----------
  for (const [, name, y, labels] of DOC_CHOICES) {
    labels.forEach((label, i) => add(C(`p9_医師_${name}_${i}`, P.boxBefore(label, { in: rowAt(y) }))));
  }
  add(parenSlot(P, 'p9_医師_栄養・食生活上の留意点', 202.2));

  for (const [y, labels] of LIKELY_ROWS) {
    for (const label of labels) add(C(`p9_医師_状態_${label}`, P.boxBefore(label, { in: rowAt(y) })));
  }
  add(parenSlot(P, 'p9_医師_対処方針', 221.0));

  for (const [y, labels] of MGMT_ROWS) {
    for (const label of labels) add(C(`p9_医師_医学的管理_${label}`, P.boxBefore(label, { in: rowAt(y) })));
  }

  for (const [, label, y, nth] of CAUTIONS) {
    add(C(`p9_医師_留意事項_${label}`, P.boxBefore(label, { in: rowAt(y) })));
    add(parenSlot(P, `p9_医師_留意事項_${label}_内容`, y, nth));
  }
  add(C('p9_医師_留意事項_特記すべき項目なし', P.boxBefore('特記すべき項目なし', { in: rowAt(266.6) })));

  for (const label of ['無', '有', '不明']) add(C(`p9_医師_感染症_${label}`, P.boxBefore(label, { in: rowAt(278.2) })));
  add(parenSlot(P, 'p9_医師_感染症_内容', 278.2));

  return out;
}

// ---------- データ → 欄の値 ----------
const arr = (x) => (Array.isArray(x) ? x : []);

export function inputs(data) {
  const v = (k) => data[k];
  const o = {};

  const medical = arr(v('survey.medical'));
  const MED_CHOICES = ['点滴の管理', '中心静脈栄養', '透析', 'ストーマ（人工肛門）の処置', '酸素療法', 'レスピレーター（人工呼吸器）', '気管切開の処置', '疼痛の看護', '経管栄養', 'モニター測定（血圧、心拍、酸素飽和度等）', 'じょくそうの処置', 'カテーテル（コンドームカテーテル、留置カテーテル、ウロストーマ等）'];
  MED_CHOICES.forEach((c, i) => { o[`p9_特別な医療_${i + 1}`] = mark(medical.includes(c)); });

  for (const [label, key] of ASSIST) {
    const a = v(key) || {};
    o[`p9_援助_${label}_家族実施`] = a.family ? s(a.family)[0] : '';
    o[`p9_援助_${label}_サービス実施`] = a.service ? '○' : '';
    o[`p9_援助_${label}_希望`] = a.wish ? '○' : '';
    o[`p9_援助_${label}_計画`] = a.plan ? s(a.plan)[0] : '';
  }

  const details = arr(v('medical.careDetails'));
  for (const item of CARE_ITEMS) {
    const d = details.find((x) => x?.item === item);
    o[`p9_具体的内容_${item}_現状`] = ck(d?.current === true);
    o[`p9_具体的内容_${item}_計画`] = ck(d?.plan === true);
  }
  o['p9_特記'] = s(v('notes.medical'));

  // 医師の意見
  for (const [key, name, , labels] of DOC_CHOICES) {
    const val = v(key);
    const picked = Array.isArray(val) ? val : val === undefined || val === null ? [] : [val];
    labels.forEach((label, i) => { o[`p9_医師_${name}_${i}`] = ck(picked.includes(label)); });
  }
  o['p9_医師_栄養・食生活上の留意点'] = s(v('doctor.nutritionNotes'));

  const likely = arr(v('doctor.likelyConditions'));
  for (const label of LIKELY) o[`p9_医師_状態_${label}`] = ck(likely.includes(label));
  o['p9_医師_対処方針'] = s(v('doctor.likelyConditionsPolicy'));

  const mgmt = arr(v('doctor.medicalManagement'));
  for (const label of MGMT) o[`p9_医師_医学的管理_${label}`] = ck(mgmt.includes(label));

  const cautions = v('doctor.serviceCautions') || {};
  for (const [key, label] of CAUTIONS) {
    const t = s(cautions[key]);
    o[`p9_医師_留意事項_${label}`] = ck(t !== '');
    o[`p9_医師_留意事項_${label}_内容`] = t;
  }
  o['p9_医師_留意事項_特記すべき項目なし'] = ck(cautions.none === true);

  const inf = v('doctor.infection') || {};
  for (const label of ['無', '有', '不明']) o[`p9_医師_感染症_${label}`] = ck(inf.status === label);
  o['p9_医師_感染症_内容'] = inf.status === '有' ? s(inf.detail) : '';
  return o;
}
