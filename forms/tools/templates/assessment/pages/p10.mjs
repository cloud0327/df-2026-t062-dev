// アセスメント用紙 p.10（PDF の 11 ページ目）: 7 全体のまとめ、災害時の対応、権利擁護
// （PDF の 11・12 ページ目は横 2 倍の 1 枚を左右に分けたもの。この左半分が p.10、右半分が p.11）
import { textSlot as T, circleSlot as O, mark, s } from '../../../scripts/layout.mjs';

export const pdfPage = 11;

export const usesKeys = [
  'summary.overall',
  'disaster.needed', 'disaster.evacuationPlan', 'disaster.contact', 'disaster.notes',
  'advocacy.needed', 'advocacy.notes',
];

const PLANS = ['有', '策定中', '無'];

export function slots(P) {
  const out = [];
  const add = (...a) => out.push(...a.flat());

  // ---------- 全体のまとめ（点線の罫線が 8.0mm ごと。最初の線は y=33.5） ----------
  const ruled = { size: 10, valign: 'top', lineHeight: 8.0 / (10 * 0.3528), fit: 'vertical', minSize: 6 };
  add(T('p10_全体のまとめ', 17.0, 25.5, 178.0, 184.0, ruled));

  // ---------- 災害時の対応 ----------
  const need = { x0: 87.5, x1: 123.3, y0: 217.9, y1: 222.5 };
  add(O('p10_災害時の対応_有', P.find('有', { in: need }), 0.9));
  add(O('p10_災害時の対応_無', P.find('無', { in: need }), 0.9));
  const plan = { x0: 164.6, x1: 196.2, y0: 217.9, y1: 222.5 };
  for (const p of PLANS) add(O(`p10_個別避難計画_${p}`, P.find(p, { in: plan }), 0.9));

  const name = P.find('（氏名）');
  const rel = P.find('（本人との関係）');
  const tel = P.find('TEL.');
  const fax = P.find('FAX．');
  const mail = P.find('メール');
  const rowH = (h) => h.y1 - h.y0 + 0.6;
  add(T('p10_災害連絡先_氏名', name.x1 + 0.5, name.y0 - 0.3, 122.0 - name.x1 - 0.5, rowH(name), { size: 10, fit: 'horizontal', minSize: 6 }));
  add(T('p10_災害連絡先_関係', rel.x1 + 0.8, rel.y0 - 0.3, 195.0 - rel.x1 - 0.8, rowH(rel), { size: 9.5, fit: 'horizontal', minSize: 6 }));
  add(T('p10_災害連絡先_TEL', tel.x1 + 0.8, tel.y0 - 0.3, fax.x0 - tel.x1 - 2.0, rowH(tel), { size: 9.5, fit: 'horizontal', minSize: 6 }));
  add(T('p10_災害連絡先_FAX', fax.x1 + 0.8, fax.y0 - 0.3, 195.0 - fax.x1 - 0.8, rowH(fax), { size: 9.5, fit: 'horizontal', minSize: 6 }));
  add(T('p10_災害連絡先_メール', mail.x1 + 0.8, mail.y0 - 0.3, 195.0 - mail.x1 - 0.8, rowH(mail), { size: 9, fit: 'horizontal', minSize: 6 }));
  add(T('p10_災害_備考', 63.0, 241.3, 132.0, 14.0, { size: 9.5, valign: 'top', fit: 'vertical', minSize: 6, lineHeight: 1.3 }));

  // ---------- 権利擁護 ----------
  const adv = { x0: 108.4, x1: 144.2, y0: 261.2, y1: 265.8 };
  add(O('p10_権利擁護_有', P.find('有', { in: adv }), 0.9));
  add(O('p10_権利擁護_無', P.find('無', { in: adv }), 0.9));
  add(T('p10_権利擁護_備考', 63.0, 269.0, 132.0, 14.0, { size: 9.5, valign: 'top', fit: 'vertical', minSize: 6, lineHeight: 1.3 }));

  return out;
}

// ---------- データ → 欄の値 ----------
export function inputs(data) {
  const v = (k) => data[k];
  const o = {};

  o['p10_全体のまとめ'] = s(v('summary.overall'));

  const dn = v('disaster.needed');
  o['p10_災害時の対応_有'] = mark(dn === true);
  o['p10_災害時の対応_無'] = mark(dn === false);
  const plan = s(v('disaster.evacuationPlan'));
  for (const p of PLANS) o[`p10_個別避難計画_${p}`] = mark(plan === p);

  const c = v('disaster.contact') || {};
  o['p10_災害連絡先_氏名'] = s(c.name);
  o['p10_災害連絡先_関係'] = s(c.relationship);
  o['p10_災害連絡先_TEL'] = s(c.phone);
  o['p10_災害連絡先_FAX'] = s(c.fax);
  o['p10_災害連絡先_メール'] = s(c.email);
  o['p10_災害_備考'] = s(v('disaster.notes'));

  const an = v('advocacy.needed');
  o['p10_権利擁護_有'] = mark(an === true);
  o['p10_権利擁護_無'] = mark(an === false);
  o['p10_権利擁護_備考'] = s(v('advocacy.notes'));
  return o;
}
