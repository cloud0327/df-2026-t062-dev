// アセスメント用紙 p.2（PDF の 3 ページ目）: 2 家族状況とインフォーマルな支援の状況、3 サービス利用状況（前半）
// 書き方は p1.mjs と同じ。欄の名前は「p2_…」。
// 図（家族構成図 family.genogram）は人が描くので欄を作らない。
import { textSlot as T, checkSlot as C, circleSlot as O, ck, mark, s, ymdParts } from '../../../scripts/layout.mjs';

export const pdfPage = 3;

export const usesKeys = [
  'family.members', 'family.careSituation',
  'services.asOf', 'services.used',
  'services.informal', 'desiredSupports',
];

/** 年・月・日の欄（p1 と同じ作り）。年・月・日の文字の直前に置く */
function ymdSlots(prefix, yHit, mHit, dHit, x0, opts = {}) {
  const size = opts.size ?? 8.5;
  const y = yHit.y0 - 0.2;
  const h = yHit.y1 - yHit.y0 + 0.4;
  return [
    T(`${prefix}_年`, x0, y, yHit.x0 - x0 - 0.3, h, { size, align: 'right', fit: 'horizontal', minSize: 5 }),
    T(`${prefix}_月`, yHit.x1 + 0.2, y, mHit.x0 - yHit.x1 - 0.5, h, { size, align: 'center', fit: 'horizontal', minSize: 5 }),
    T(`${prefix}_日`, mHit.x1 + 0.2, y, dHit.x0 - mHit.x1 - 0.5, h, { size, align: 'center', fit: 'horizontal', minSize: 5 }),
  ];
}

// ---------- 家族の一覧表（罫線から） ----------
const FAMILY_ROW_TOPS = [111.54, 119.54, 127.55, 135.55, 143.55];
const FAMILY_ROW_H = 8.0;
// 氏名 | 続柄 | 同別居 | 就労の状況 | 健康状態等 | 特記事項 の左右の罫線
const FAMILY_COLS = [12.54, 57.49, 72.49, 87.42, 108.49, 140.49, 198.53];

// ---------- 小さな表（インフォーマルな支援 / 本人が受けたい支援）: 3 行に分けて書く ----------
const INFORMAL = { top: 168.9, bottom: 184.37, cols: [12.53, 39.53, 145.53, 198.53] };
const DESIRED = { top: 193.5, bottom: 208.94, cols: [12.53, 118.53, 145.53, 198.53] };
const SMALL_ROWS = 3;

// ---------- サービス利用状況（在宅利用）のチェック欄 ----------
// unit: kai = 「月 □ 回」、nichi = 「月 □ 日」、hinmoku = 「□ 品目」、arinashi = 「あり・なし」
const LEFT = { x0: 14, x1: 106.9 };
const RIGHT = { x0: 107, x1: 192 };
const SERVICES = [
  ['訪問介護', '訪問介護（ホーム', LEFT, 'kai'],
  ['訪問型サービス', '訪問型サービス', LEFT, 'kai'],
  ['訪問入浴介護', '訪問入浴介護', LEFT, 'kai'],
  ['訪問看護', '訪問看護', LEFT, 'kai'],
  ['訪問リハビリテーション', '訪問リハビリテーション', LEFT, 'kai'],
  ['居宅療養管理指導', '居宅療養管理指導', LEFT, 'kai'],
  ['通所介護', '通所介護（デイ', LEFT, 'kai'],
  ['通所型サービス', '通所型サービス', LEFT, 'kai'],
  ['通所リハビリテーション', '通所リハビリテーション', LEFT, 'kai'],
  ['短期入所生活介護', '短期入所生活介護', LEFT, 'nichi'],
  ['短期入所療養介護', '短期入所療養介護', LEFT, 'nichi'],
  ['特定施設入居者生活介護', '特定施設入居者生活介護', RIGHT, 'nichi'],
  ['看護小規模多機能型居宅介護', '看護小規模多機能型居宅介護', RIGHT, 'nichi'],
  ['福祉用具貸与', '福祉用具貸与', RIGHT, 'hinmoku'],
  ['特定福祉用具販売', '福祉用具販売', RIGHT, 'hinmoku'],
  ['住宅改修', '住宅改修', RIGHT, 'arinashi'],
  ['夜間対応型訪問介護', '夜間対応型訪問介護', RIGHT, 'nichi'],
  ['認知症対応型通所介護', '認知症対応型通所介護', RIGHT, 'nichi'],
  ['小規模多機能型居宅介護', '）小規模多機能型居宅介護', RIGHT, 'nichi'],
  ['認知症対応型共同生活介護', '認知症対応型共同生活介護', RIGHT, 'nichi'],
  ['定期巡回・随時対応型訪問介護看護', '定期巡回・随時対応型訪問介護看護', RIGHT, 'kai'],
  ['その他の生活支援サービス', 'その他の生活支援サービス', RIGHT, 'kai'],
];
const NOT_ONE = (a) => a === 0 || a === '0' || a === 'なし' || a === false;

/** hit と同じ行で、hit の左にいちばん近い「□」（「（介護予防）」が間にあっても拾える） */
function nearestBox(P, hit, x0) {
  const yc = (hit.y0 + hit.y1) / 2;
  const cands = P.boxes({ in: { x0, x1: hit.x0 + 1, y0: hit.y0 - 2, y1: hit.y1 + 2 } })
    .filter((b) => hit.x0 - b.x1 < 32)
    .sort((a, b) => Math.abs((a.y0 + a.y1) / 2 - yc) - Math.abs((b.y0 + b.y1) / 2 - yc) || b.x0 - a.x0);
  if (!cands[0]) throw new Error(`p${P.n}: 「${hit.chars.map((c) => c.t).join('')}」の前に □ がありません`);
  const b = cands[0];
  return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
}

export function slots(P) {
  const out = [];
  const add = (...a) => out.push(...a.flat());

  // ---------- 家族の介護の状況・課題（8 本の点線、7.94mm ごと） ----------
  add(T('p2_家族の介護の状況・課題', 89.0, 35.7, 108.6, 72.0, { size: 9, valign: 'top', lineHeight: 7.94 / (9 * 0.3528), fit: 'vertical', minSize: 6 }));

  // ---------- 家族の一覧表 ----------
  const dobetsu = P.findAll('同・別');
  FAMILY_ROW_TOPS.forEach((top, i) => {
    const n = i + 1;
    const c = FAMILY_COLS;
    const y = top + 0.6;
    const h = FAMILY_ROW_H - 1.2;
    add(T(`p2_家族${n}_氏名`, c[0] + 1, y, c[1] - c[0] - 2, h, { size: 10, fit: 'horizontal' }));
    add(T(`p2_家族${n}_続柄`, c[1] + 0.5, y, c[2] - c[1] - 1, h, { size: 9, align: 'center', fit: 'horizontal' }));
    const hit = dobetsu[i];
    // 「同・別」は印字の位置が文字の枠より 0.8mm ほど上なので、丸も上げる
    for (const [nm, ch] of [['同居', hit.chars[0]], ['別居', hit.chars[2]]]) {
      const c = O(`p2_家族${n}_${nm}`, ch);
      c.position.y = Math.round((c.position.y - 0.8) * 100) / 100;
      add(c);
    }
    add(T(`p2_家族${n}_就労`, c[3] + 1, y, c[4] - c[3] - 2, h, { size: 8.5, fit: 'horizontal' }));
    add(T(`p2_家族${n}_健康`, c[4] + 1, y, c[5] - c[4] - 2, h, { size: 8.5, fit: 'horizontal' }));
    add(T(`p2_家族${n}_特記`, c[5] + 1, y, c[6] - c[5] - 2, h, { size: 8.5, fit: 'horizontal' }));
  });

  // ---------- インフォーマルな支援 / 本人が受けたい支援 ----------
  const small = (prefix, box, names) => {
    const rowH = (box.bottom - box.top) / SMALL_ROWS;
    for (let i = 0; i < SMALL_ROWS; i++) {
      const y = box.top + rowH * i + 0.3;
      names.forEach((name, j) => {
        add(T(`${prefix}${i + 1}_${name}`, box.cols[j] + 1, y, box.cols[j + 1] - box.cols[j] - 2, rowH - 0.6, { size: 9, fit: 'horizontal' }));
      });
    }
  };
  small('p2_インフォーマル', INFORMAL, ['支援提供者', '支援内容', '特記事項']);
  small('p2_受けたい支援', DESIRED, ['支援内容', '支援提供者', '特記事項']);

  // ---------- サービス利用状況 ----------
  const asOfRow = { x0: 168, x1: 201, y0: 226, y1: 230 };
  add(ymdSlots('p2_サービス利用状況_時点', P.find('年', { in: asOfRow }), P.find('月', { in: asOfRow }), P.find('日', { in: asOfRow }), P.find('（', { in: asOfRow }).x1 + 0.5));

  for (const [kind, printed, side, unit] of SERVICES) {
    const hit = P.find(printed, { in: { x0: side.x0, x1: side.x1, y0: 236, y1: 286 } });
    add(C(`p2_${kind}_チェック`, nearestBox(P, hit, side.x0)));
    // 「その他の生活支援サービス」だけは、月・回が次の行（名称の行）にある
    const nameHit = kind === 'その他の生活支援サービス' ? P.find('名称：', { in: { x0: side.x0, x1: side.x1, y0: 276, y1: 287 } }) : null;
    const base = nameHit || hit;
    const row = { x0: nameHit ? nameHit.x1 : hit.x1, x1: side.x1, y0: base.y0 - 1, y1: base.y1 + 1 };
    const size = 8.5;
    if (unit === 'kai' || unit === 'nichi') {
      const m = P.find('月', { in: row });
      const u = P.find(unit === 'kai' ? '回' : '日', { in: { ...row, x0: m.x1 } });
      add(T(`p2_${kind}_量`, m.x1 + 0.3, m.y0 - 0.2, u.x0 - m.x1 - 0.6, m.y1 - m.y0 + 0.4, { size, align: 'center' }));
    } else if (unit === 'hinmoku') {
      const u = P.find('品目', { in: row });
      add(T(`p2_${kind}_量`, u.x0 - 9.5, u.y0 - 0.2, 9.0, u.y1 - u.y0 + 0.4, { size, align: 'right' }));
    } else {
      add(O(`p2_${kind}_あり`, P.find('あり', { in: row })));
      add(O(`p2_${kind}_なし`, P.find('なし', { in: row })));
    }
    if (kind === 'その他の生活支援サービス') {
      const nm = nameHit;
      const close = P.find('）', { in: { x0: nm.x1, x1: side.x1, y0: nm.y0 - 1, y1: nm.y1 + 1 } });
      add(T('p2_その他の生活支援サービス_名称', nm.x1 + 0.3, nm.y0 - 0.2, close.x0 - nm.x1 - 0.6, nm.y1 - nm.y0 + 0.4, { size: 8.5, fit: 'horizontal' }));
    }
  }
  return out;
}

// ---------- データ → 欄の値 ----------
export function inputs(data) {
  const v = (k) => data[k];
  const o = {};

  o['p2_家族の介護の状況・課題'] = s(v('family.careSituation'));

  const members = Array.isArray(v('family.members')) ? v('family.members') : [];
  for (let i = 0; i < FAMILY_ROW_TOPS.length; i++) {
    const n = i + 1;
    const m = members[i] || {};
    const has = members[i] !== undefined;
    o[`p2_家族${n}_氏名`] = has ? `${m.isMainCaregiver ? '※' : ''}${s(m.name)}` : '';
    o[`p2_家族${n}_続柄`] = s(m.relationshipDetail || m.relationship);
    o[`p2_家族${n}_同居`] = mark(m.livingTogether === '同居');
    o[`p2_家族${n}_別居`] = mark(m.livingTogether === '別居');
    o[`p2_家族${n}_就労`] = s(m.employment);
    o[`p2_家族${n}_健康`] = s(m.health);
    o[`p2_家族${n}_特記`] = s(m.note);
  }

  const informal = Array.isArray(v('services.informal')) ? v('services.informal') : [];
  const desired = Array.isArray(v('desiredSupports')) ? v('desiredSupports') : [];
  for (let i = 0; i < SMALL_ROWS; i++) {
    const a = informal[i] || {};
    o[`p2_インフォーマル${i + 1}_支援提供者`] = s(a.provider);
    o[`p2_インフォーマル${i + 1}_支援内容`] = s(a.content);
    o[`p2_インフォーマル${i + 1}_特記事項`] = s(a.note);
    const d = desired[i] || {};
    o[`p2_受けたい支援${i + 1}_支援内容`] = s(d.content);
    o[`p2_受けたい支援${i + 1}_支援提供者`] = s(d.provider);
    o[`p2_受けたい支援${i + 1}_特記事項`] = s(d.note);
  }

  const asOf = ymdParts(v('services.asOf'));
  o['p2_サービス利用状況_時点_年'] = asOf.y;
  o['p2_サービス利用状況_時点_月'] = asOf.m;
  o['p2_サービス利用状況_時点_日'] = asOf.d;

  const used = Array.isArray(v('services.used')) ? v('services.used') : [];
  for (const [kind, , , unit] of SERVICES) {
    const u = used.find((x) => x?.kind === kind);
    const on = u !== undefined;
    if (unit === 'arinashi') {
      const none = on && NOT_ONE(u.amount);
      o[`p2_${kind}_チェック`] = ck(on && !none);
      o[`p2_${kind}_あり`] = mark(on && !none);
      o[`p2_${kind}_なし`] = mark(none);
    } else {
      o[`p2_${kind}_チェック`] = ck(on);
      o[`p2_${kind}_量`] = on ? s(u.amount) : '';
    }
    if (kind === 'その他の生活支援サービス') o['p2_その他の生活支援サービス_名称'] = on ? s(u.name) : '';
  }
  return o;
}
