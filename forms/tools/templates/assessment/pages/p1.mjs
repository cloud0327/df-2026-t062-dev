// アセスメント用紙 p.1（PDF の 2 ページ目）: 1 フェースシート
//
// ページのファイルの書き方（他のページもこれに合わせる）:
//   pdfPage  … PDF の何ページ目か（1 から）
//   usesKeys … このページが読む design/fields.json の key
//   slots(P) … 欄の配置。P は scripts/layout.mjs の LayoutPage。書類の文字を目印にして位置を決める
//   inputs(data) … データ（fields.json の key と値）→ 欄の値。slots の欄すべてに値を返す
// 欄の名前は「p<用紙のページ番号>_<中身>」。
import { textSlot as T, checkSlot as C, circleSlot as O, ck, mark, s, ymdParts, ageAt, parseDate, wareki } from '../../../scripts/layout.mjs';

export const pdfPage = 2;

export const usesKeys = [
  'intake.date', 'intake.method', 'intake.methodOther', 'intake.receiver', 'intake.referralRoute', 'intake.planRequestNotifiedDate',
  'person.name', 'person.sex', 'person.birthDate', 'person.age', 'person.postalCode', 'person.address', 'person.phone', 'person.mobile',
  'emergencyContact', 'consulter',
  'complaint.person', 'complaint.family', 'person.lifeHistory',
  'insurance.careCopayRate', 'insurance.lateElderlyCopay', 'insurance.highCostStage',
  'cert.status', 'cert.careLevel', 'cert.expectedCareLevel', 'cert.certifiedDate',
  'handbook.physical', 'handbook.rehabilitation', 'handbook.mental',
  'disabilityWelfare.certificate', 'disabilityWelfare.supportCategory', 'independenceSupportMedical',
  'independence.physical', 'independence.dementia',
  'assessment.initialDate', 'assessment.updateDate',
];

/** 年・月・日の欄。label の 3 つの文字（年・月・日）の直前に右寄せ・中央で置く */
function ymdSlots(P, prefix, yHit, mHit, dHit, x0, opts = {}) {
  const size = opts.size ?? 8.5;
  const y = yHit.y0 - 0.2;
  const h = yHit.y1 - yHit.y0 + 0.4;
  return [
    T(`${prefix}_年`, x0, y, yHit.x0 - x0 - 0.3, h, { size, align: 'right', fit: 'horizontal', minSize: 5 }),
    T(`${prefix}_月`, yHit.x1 + 0.2, y, mHit.x0 - yHit.x1 - 0.5, h, { size, align: 'center' }),
    T(`${prefix}_日`, mHit.x1 + 0.2, y, dHit.x0 - mHit.x1 - 0.5, h, { size, align: 'center' }),
  ];
}

/** 緊急連絡先・相談者の 3 行（氏名の行、☎ の行、住所と携帯の行） */
function contactSlots(P, prefix, nth) {
  const name = P.find('氏名', { nth: nth + 1 }); // 0 番目は「本人氏名」
  const row = { x0: 30, x1: 200, y0: name.y0 - 1, y1: name.y1 + 1 };
  const male = P.find('男', { in: row });
  const female = P.find('女', { in: row });
  const age = P.find('年齢（', { in: row });
  const ageEnd = P.find('歳）', { in: row });
  const rel = P.find('本人との続柄（', { in: row });
  const relEnd = P.find('）', { in: { ...row, x0: rel.x1 } });
  const tel = P.find('☎', { nth: nth + 1 });
  const addr = P.find('住所', { nth: nth + 1 }); // 0 番目は本人の「住　所」
  const mob = P.find('携帯', { nth: nth + 1 });
  return [
    T(`${prefix}_氏名`, name.x1 + 0.5, name.y0 - 0.5, male.x0 - name.x1 - 1.5, name.y1 - name.y0 + 1, { size: 10, fit: 'horizontal' }),
    O(`${prefix}_男`, male.chars[0]),
    O(`${prefix}_女`, female),
    T(`${prefix}_年齢`, age.x1, age.y0 - 0.2, ageEnd.x0 - age.x1, age.y1 - age.y0 + 0.4, { size: 8.5, align: 'center' }),
    T(`${prefix}_続柄`, rel.x1, rel.y0 - 0.2, relEnd.x0 - rel.x1, rel.y1 - rel.y0 + 0.4, { size: 8.5, align: 'center', fit: 'horizontal' }),
    T(`${prefix}_電話`, tel.x1 + 0.8, tel.y0 - 0.2, 199.5 - tel.x1 - 0.8, tel.y1 - tel.y0 + 0.4, { size: 9 }),
    T(`${prefix}_住所`, addr.x1 + 0.5, addr.y0 - 0.3, 130.5 - addr.x1 - 0.5, addr.y1 - addr.y0 + 0.6, { size: 9, fit: 'horizontal' }),
    T(`${prefix}_携帯`, mob.x1 + 0.8, mob.y0 - 0.2, 199.5 - mob.x1 - 0.8, mob.y1 - mob.y0 + 0.4, { size: 9 }),
  ];
}

/** 「自立・J1・J2・…」のように「・」で区切って並んだ選択肢を、1 つずつ丸で囲む欄 */
function optionCircles(P, prefix, rowText, options, opts = {}) {
  const row = P.find(rowText, opts);
  return options.map(([label, printed]) => O(`${prefix}_${label}`, P.find(printed, { in: { x0: row.x0 - 0.1, x1: row.x1 + 0.1, y0: row.y0 - 0.1, y1: row.y1 + 0.1 } })));
}

const PHYSICAL = [['自立', '自立'], ['J1', 'J1'], ['J2', 'J2'], ['A1', 'A1'], ['A2', 'A2'], ['B1', 'B1'], ['B2', 'B2'], ['C1', 'C1'], ['C2', 'C2']];
const DEMENTIA = [['自立', '自立'], ['I', 'Ⅰ'], ['IIa', 'Ⅱa'], ['IIb', 'Ⅱb'], ['IIIa', 'Ⅲa'], ['IIIb', 'Ⅲb'], ['IV', 'Ⅳ'], ['M', 'Ｍ']];
const LEVELS = ['非該当', '要支援1', '要支援2', '要介護1', '要介護2', '要介護3', '要介護4', '要介護5'];

export function slots(P) {
  const out = [];
  const add = (...a) => out.push(...a.flat());

  // ---------- 受付 ----------
  const hdr = { x0: 10, x1: 200, y0: 20, y1: 26 };
  add(ymdSlots(P, 'p1_相談受付日', P.find('年', { in: hdr }), P.find('月', { in: hdr }), P.find('日', { in: hdr }), 14));
  for (const m of ['訪問', '電話', '来所', 'その他']) add(O(`p1_受付方法_${m}`, P.find(m, { in: hdr })));
  const other = P.find('その他（', { in: hdr });
  add(T('p1_受付方法_その他の内容', other.x1, other.y0 - 0.2, 147.2 - other.x1, other.y1 - other.y0 + 0.4, { size: 8.5, fit: 'horizontal' }));
  const recv = P.find('初回相談受付者');
  add(T('p1_初回相談受付者', recv.x1 + 0.8, recv.y0 - 0.2, 199.5 - recv.x1 - 0.8, recv.y1 - recv.y0 + 0.4, { size: 9, fit: 'horizontal' }));

  // ---------- 本人 ----------
  const nameLabel = P.find('本人氏名');
  const pRow = { x0: 100, x1: 200, y0: 30.5, y1: 36 };
  const birthRow = { ...pRow, x0: 150 }; // 「年齢」の「年」を拾わないように
  add(T('p1_本人氏名', 33.0, 28.6, 73.0, 9.2, { size: 14, fit: 'horizontal' }));
  add(O('p1_本人_男', P.find('男', { in: pRow }).chars[0]));
  add(O('p1_本人_女', P.find('女', { in: pRow })));
  for (const e of ['Ｍ', 'Т', 'Ｓ']) add(O(`p1_生年月日_${e === 'Т' ? 'T' : e === 'Ｍ' ? 'M' : 'S'}`, P.find(e, { in: { x0: 133, x1: 139, y0: 27, y1: 38 } }), 0.4));
  const by = P.find('年', { in: birthRow });
  const bm = P.find('月', { in: birthRow });
  const bd = P.find('日生れ（', { in: birthRow });
  add(T('p1_生年月日_年', 139.0, by.y0 - 0.2, by.x0 - 139.3, by.y1 - by.y0 + 0.4, { size: 10, align: 'right' }));
  add(T('p1_生年月日_月', by.x1 + 0.2, bm.y0 - 0.2, bm.x0 - by.x1 - 0.5, bm.y1 - bm.y0 + 0.4, { size: 10, align: 'center' }));
  add(T('p1_生年月日_日', bm.x1 + 0.2, bd.y0 - 0.2, bd.x0 - bm.x1 - 0.5, bd.y1 - bd.y0 + 0.4, { size: 10, align: 'center' }));
  const ageEnd = P.find('歳）', { in: pRow });
  add(T('p1_本人_年齢', bd.x1, bd.y0 - 0.2, ageEnd.x0 - bd.x1, bd.y1 - bd.y0 + 0.4, { size: 9, align: 'center' }));
  void nameLabel;

  const zip = P.find('〒');
  add(T('p1_本人_郵便番号', zip.x1 + 0.5, zip.y0 - 0.2, 35, zip.y1 - zip.y0 + 0.4, { size: 8.5 }));
  add(T('p1_本人_住所', 34.0, 44.6, 96.5, 4.6, { size: 10, fit: 'horizontal' }));
  const tel = P.find('☎');
  add(T('p1_本人_電話', tel.x1 + 0.8, tel.y0 - 0.2, 199.5 - tel.x1 - 0.8, tel.y1 - tel.y0 + 0.4, { size: 9.5 }));
  const mob = P.find('携帯');
  add(T('p1_本人_携帯', mob.x1 + 0.8, mob.y0 - 0.2, 199.5 - mob.x1 - 0.8, mob.y1 - mob.y0 + 0.4, { size: 9.5 }));

  add(contactSlots(P, 'p1_緊急連絡先', 0));
  add(contactSlots(P, 'p1_相談者', 1));

  const route = P.find('相談経路');
  add(T('p1_相談経路', 34.0, route.y0 - 0.3, 165.5, 6.6, { size: 9.5, fit: 'horizontal' }));
  const notify = P.find('届出年月日');
  const nRow = { x0: notify.x1, x1: 100, y0: notify.y0 - 0.1, y1: notify.y1 + 0.1 };
  add(ymdSlots(P, 'p1_届出年月日', P.find('年', { in: nRow }), P.find('月', { in: nRow }), P.find('日', { in: nRow }), notify.x1 + 1));

  // ---------- 相談内容・生活の経過（罫線 7.27mm ごと） ----------
  const ruled = { size: 9, valign: 'top', lineHeight: 7.27 / (9 * 0.3528), fit: 'vertical', minSize: 6 };
  add(T('p1_相談内容_本人', 16.4, 118.0, 83.2, 35.2, ruled));
  add(T('p1_相談内容_家族', 16.4, 161.6, 83.2, 31.8, ruled));
  add(T('p1_生活の経過', 110.6, 110.0, 84.6, 83.4, ruled));

  // ---------- 保険・負担 ----------
  for (const [label, printed] of [['1割', '１割'], ['2割', '２割'], ['3割', '３割']]) add(C(`p1_介護保険_負担割合_${label}`, P.boxBefore(printed, { in: { x0: 70, x1: 106, y0: 199, y1: 205 } })));
  for (const [label, printed] of [['1割', '１割負担'], ['2割', '2割負担'], ['3割', '３割負担']]) add(C(`p1_後期高齢者医療_${label}`, P.boxBefore(printed)));
  for (const [printed, n] of [['５', 5], ['４', 4], ['３', 3], ['２', 2], ['１', 1]]) add(C(`p1_高額介護_第${n}段階`, P.boxBefore(`第${printed}段階`)));

  // ---------- 要介護認定 ----------
  const done = P.find('済', { in: { x0: 40, x1: 50, y0: 215, y1: 220 } });
  const notYet = P.find('未（見込み）');
  add(O('p1_要介護認定_済', done, 0.8));
  add(O('p1_要介護認定_未', notYet.chars[0], 0.8));
  for (const [rowName, rowHit] of [['済', done], ['未', notYet]]) {
    const row = { x0: 64, x1: 150, y0: rowHit.y0 - 0.5, y1: rowHit.y1 + 0.5 };
    add(O(`p1_要介護認定_${rowName}_非該当`, P.find('非該当', { in: row })));
    const shien = P.find('要支援', { in: row });
    const kaigo = P.find('要介護', { in: row });
    const digits = P.findAll('1', { in: row }).concat(P.findAll('2', { in: row }), P.findAll('3', { in: row }), P.findAll('4', { in: row }), P.findAll('5', { in: row }));
    for (const d of digits) {
      const group = d.x0 < kaigo.x0 ? '要支援' : '要介護';
      add(O(`p1_要介護認定_${rowName}_${group}${d.chars[0].t}`, d, 0.9));
    }
    void shien;
  }
  const certRow = { x0: 150, x1: 200, y0: 215, y1: 220 };
  const certLabel = P.find('認定日');
  add(ymdSlots(P, 'p1_認定日', P.find('年', { in: certRow }), P.find('月', { in: certRow }), P.find('日', { in: { ...certRow, x0: certLabel.x1 + 15 } }), certLabel.x1 + 0.5));

  // ---------- 手帳・受給者証 ----------
  const books = [['身体障害者手帳', 230.0], ['療育手帳', 238.0], ['精神障害者手帳', 246.0]];
  for (const [name, y] of books) {
    const row = { x0: 38, x1: 200, y0: y, y1: y + 5 };
    add(C(`p1_${name}_有`, P.boxBefore('有', { in: { ...row, x1: 50 } })));
    add(C(`p1_${name}_無`, P.boxBefore('無', { in: { ...row, x1: 60 } })));
    const issued = P.find('交付日', { in: row });
    const iy = P.find('年', { in: { ...row, x0: issued.x1 } });
    const im = P.find('月', { in: { ...row, x0: issued.x1 } });
    add(T(`p1_${name}_交付日_年`, issued.x1 + 0.5, iy.y0 - 0.2, iy.x0 - issued.x1 - 0.8, iy.y1 - iy.y0 + 0.4, { size: 8.5, align: 'right', fit: 'horizontal' }));
    add(T(`p1_${name}_交付日_月`, iy.x1 + 0.2, im.y0 - 0.2, im.x0 - iy.x1 - 0.5, im.y1 - im.y0 + 0.4, { size: 8.5, align: 'center' }));
  }
  // 身体: 「＿種＿級」、療育: 程度、精神: 「＿級」
  add(T('p1_身体障害者手帳_種', 72.5, 230.6, 12.0, 3.6, { size: 8.5, align: 'center' }));
  add(T('p1_身体障害者手帳_級', 88.3, 230.6, 9.3, 3.6, { size: 8.5, align: 'center' }));
  add(T('p1_身体障害者手帳_内容', 102.0, 230.6, 54.0, 3.6, { size: 8.5, fit: 'horizontal' }));
  add(T('p1_療育手帳_程度', 72.5, 238.6, 83.5, 3.6, { size: 8.5, fit: 'horizontal' }));
  add(T('p1_精神障害者手帳_級', 72.5, 246.6, 25.0, 3.6, { size: 8.5, align: 'center' }));
  const welfareRow = { x0: 38, x1: 200, y0: 254, y1: 259 };
  add(C('p1_障害福祉サービス受給者証_有', P.boxBefore('有', { in: { ...welfareRow, x1: 50 } })));
  add(C('p1_障害福祉サービス受給者証_無', P.boxBefore('無', { in: { ...welfareRow, x1: 60 } })));
  add(C('p1_自立支援医療受給者証_有', P.boxBefore('有', { in: { ...welfareRow, x0: 88, x1: 99 } })));
  add(C('p1_自立支援医療受給者証_無', P.boxBefore('無', { in: { ...welfareRow, x0: 99, x1: 108 } })));
  const sc = P.find('障害支援区分→（');
  add(T('p1_障害支援区分', sc.x1, sc.y0 - 0.2, 192.6 - sc.x1, sc.y1 - sc.y0 + 0.4, { size: 8.5, fit: 'horizontal' }));

  // ---------- 日常生活自立度 ----------
  add(optionCircles(P, 'p1_自立度_障害', '自立・J1・J2・A1・A2・B1・B2・C1・C2', PHYSICAL));
  add(optionCircles(P, 'p1_自立度_認知症', '自立・Ⅰ・Ⅱa・Ⅱb・Ⅲa・Ⅲb・Ⅳ・Ｍ', DEMENTIA));
  for (const [kind, y] of [['障害', 263.5], ['認知症', 273.5]]) {
    const row = { x0: 120, x1: 200, y0: y, y1: y + 4 };
    add(T(`p1_自立度_${kind}_判定者`, 127.2, y + 0.1, 27.6, 3.4, { size: 8, align: 'center', fit: 'horizontal' }));
    add(T(`p1_自立度_${kind}_機関名`, 139.0, y + 3.5, 12.7, 3.2, { size: 6.5, fit: 'horizontal', minSize: 4 }));
    const yy = P.find('年', { in: row });
    const mm = P.find('月', { in: row });
    const dd = P.find('日', { in: { ...row, x0: mm.x1 } });
    add(ymdSlots(P, `p1_自立度_${kind}_判定日`, yy, mm, dd, 159.2));
  }

  // ---------- アセスメント実施日 ----------
  const aRow = { x0: 70, x1: 200, y0: 282.5, y1: 287.5 };
  const ys = P.findAll('年', { in: aRow });
  const ms = P.findAll('月', { in: aRow });
  const ds = P.findAll('日', { in: aRow });
  add(ymdSlots(P, 'p1_アセスメント実施日_初回', ys[0], ms[0], ds[0], 87.2, { size: 9 }));
  add(ymdSlots(P, 'p1_アセスメント実施日_更新', ys[1], ms[1], ds[1], 150.8, { size: 9 }));

  return out;
}

// ---------- データ → 欄の値 ----------
function contactInputs(prefix, c = {}) {
  return {
    [`${prefix}_氏名`]: s(c.name),
    [`${prefix}_男`]: mark(c.sex === '男'),
    [`${prefix}_女`]: mark(c.sex === '女'),
    [`${prefix}_年齢`]: s(c.age),
    [`${prefix}_続柄`]: s(c.relationshipDetail || c.relationship),
    [`${prefix}_電話`]: s(c.phone),
    [`${prefix}_住所`]: s(c.address),
    [`${prefix}_携帯`]: s(c.mobile),
  };
}
const ymdIn = (prefix, v) => {
  const p = ymdParts(v);
  return { [`${prefix}_年`]: p.y, [`${prefix}_月`]: p.m, [`${prefix}_日`]: p.d };
};

export function inputs(data) {
  const v = (k) => data[k];
  const o = {};
  const put = (x) => Object.assign(o, x);

  put(ymdIn('p1_相談受付日', v('intake.date')));
  const method = s(v('intake.method'));
  for (const m of ['訪問', '電話', '来所', 'その他']) o[`p1_受付方法_${m}`] = mark(method === m);
  o['p1_受付方法_その他の内容'] = method === 'その他' ? s(v('intake.methodOther')) : '';
  o['p1_初回相談受付者'] = s(v('intake.receiver'));

  o['p1_本人氏名'] = s(v('person.name'));
  o['p1_本人_男'] = mark(v('person.sex') === '男');
  o['p1_本人_女'] = mark(v('person.sex') === '女');
  const b = parseDate(v('person.birthDate'));
  const bw = b ? wareki(b) : null;
  o['p1_生年月日_M'] = mark(bw?.era.name === '明治');
  o['p1_生年月日_T'] = mark(bw?.era.name === '大正');
  o['p1_生年月日_S'] = mark(bw?.era.name === '昭和');
  o['p1_生年月日_年'] = bw ? String(bw.year) : '';
  o['p1_生年月日_月'] = b ? String(b.m) : '';
  o['p1_生年月日_日'] = b ? String(b.d) : '';
  o['p1_本人_年齢'] = s(v('person.age')) || ageAt(v('person.birthDate'), v('assessment.updateDate') || v('assessment.initialDate'));
  o['p1_本人_郵便番号'] = s(v('person.postalCode'));
  o['p1_本人_住所'] = s(v('person.address'));
  o['p1_本人_電話'] = s(v('person.phone'));
  o['p1_本人_携帯'] = s(v('person.mobile'));
  put(contactInputs('p1_緊急連絡先', v('emergencyContact')));
  put(contactInputs('p1_相談者', v('consulter')));
  o['p1_相談経路'] = s(v('intake.referralRoute'));
  put(ymdIn('p1_届出年月日', v('intake.planRequestNotifiedDate')));

  o['p1_相談内容_本人'] = s(v('complaint.person'));
  o['p1_相談内容_家族'] = s(v('complaint.family'));
  o['p1_生活の経過'] = s(v('person.lifeHistory'));

  const rate = s(v('insurance.careCopayRate'));
  for (const r of ['1割', '2割', '3割']) o[`p1_介護保険_負担割合_${r}`] = ck(rate === r);
  const late = s(v('insurance.lateElderlyCopay'));
  for (const r of ['1割', '2割', '3割']) o[`p1_後期高齢者医療_${r}`] = ck(late === r);
  const stage = s(v('insurance.highCostStage'));
  for (let n = 1; n <= 5; n++) o[`p1_高額介護_第${n}段階`] = ck(stage === `第${n}段階`);

  const status = s(v('cert.status'));
  const isDone = status === '認定済';
  const isNotYet = status !== '' && !isDone;
  o['p1_要介護認定_済'] = mark(isDone);
  o['p1_要介護認定_未'] = mark(isNotYet);
  const level = isDone ? s(v('cert.careLevel')) : '';
  const expected = isNotYet ? s(v('cert.expectedCareLevel')) : '';
  for (const [row, lv] of [['済', level], ['未', expected]]) {
    for (const L of LEVELS) o[`p1_要介護認定_${row}_${L}`] = mark(lv === L);
  }
  put(ymdIn('p1_認定日', v('cert.certifiedDate')));

  const books = [['身体障害者手帳', v('handbook.physical')], ['療育手帳', v('handbook.rehabilitation')], ['精神障害者手帳', v('handbook.mental')]];
  for (const [name, h] of books) {
    o[`p1_${name}_有`] = ck(h?.has === true);
    o[`p1_${name}_無`] = ck(h?.has === false);
    const d = parseDate(h?.issuedDate);
    o[`p1_${name}_交付日_年`] = d ? ymdParts(h.issuedDate).y : '';
    o[`p1_${name}_交付日_月`] = d ? String(d.m) : '';
  }
  const ph = v('handbook.physical') || {};
  o['p1_身体障害者手帳_種'] = s(ph.kind);
  o['p1_身体障害者手帳_級'] = s(ph.grade);
  o['p1_身体障害者手帳_内容'] = s(ph.detail);
  o['p1_療育手帳_程度'] = s(v('handbook.rehabilitation')?.degree);
  o['p1_精神障害者手帳_級'] = s(v('handbook.mental')?.grade);
  const dw = v('disabilityWelfare.certificate');
  o['p1_障害福祉サービス受給者証_有'] = ck(dw === true);
  o['p1_障害福祉サービス受給者証_無'] = ck(dw === false);
  const ism = v('independenceSupportMedical');
  o['p1_自立支援医療受給者証_有'] = ck(ism === true);
  o['p1_自立支援医療受給者証_無'] = ck(ism === false);
  o['p1_障害支援区分'] = s(v('disabilityWelfare.supportCategory'));

  const phy = v('independence.physical') || {};
  const dem = v('independence.dementia') || {};
  for (const [label] of PHYSICAL) o[`p1_自立度_障害_${label}`] = mark(phy.level === label);
  for (const [label] of DEMENTIA) o[`p1_自立度_認知症_${label}`] = mark(dem.level === label);
  for (const [kind, x] of [['障害', phy], ['認知症', dem]]) {
    o[`p1_自立度_${kind}_判定者`] = s(x.judgedBy);
    o[`p1_自立度_${kind}_機関名`] = s(x.institution);
    put(ymdIn(`p1_自立度_${kind}_判定日`, x.date));
  }

  put(ymdIn('p1_アセスメント実施日_初回', v('assessment.initialDate')));
  put(ymdIn('p1_アセスメント実施日_更新', v('assessment.updateDate')));
  return o;
}
