// 入院時情報提供書: 利用者のデータ（design/fields.json の key と値）→ テンプレートの欄の値。
//
// AI は使わない。決まった手順で変換するだけ。
// data は { "person.name": "見本 花子", "cert.careLevel": "要介護2", ... } の形（値だけ）。

/** この様式が読む fields.json の key（scripts/check.mjs が fields.json と照らし合わせる） */
export const usesKeys = [
  'admission.recordDate', 'admission.date', 'admission.infoProvidedDate',
  'admission.hospitalName', 'admission.hospitalStaff',
  'office.name', 'office.careManagerName', 'office.phone', 'office.fax',
  'person.nameKana', 'person.name', 'person.sex', 'person.birthDate', 'person.age',
  'person.postalCode', 'person.address', 'person.phone',
  'housing.buildingType', 'housing.stories', 'housing.roomFloor', 'housing.elevator', 'housing.notes',
  'cert.status', 'cert.careLevel', 'cert.validFrom', 'cert.validTo', 'cert.applicationDate',
  'independence.physical', 'independence.dementia',
  'insurance.careCopayRate', 'disabilityCertificateSummary', 'handbook.physical', 'handbook.rehabilitation', 'handbook.mental',
  'pensions', 'welfare.publicAssistance',
  'household.type', 'household.typeOther', 'household.daytimeAlone', 'family.members',
  'person.interests', 'person.lifeHistory', 'intention.person', 'intention.family',
  'admission.enclosedCarePlan', 'admission.enclosedOther',
  'outlook.requirements', 'outlook.household', 'outlook.householdConsideration', 'outlook.caregiver',
  'outlook.careCapacity', 'outlook.abuseSuspicion', 'outlook.notes',
  'conference.inHospital', 'conference.preDischarge', 'conference.preDischargeRequest', 'conference.homeVisitAccompany',
];

const CHECK = '✓';
const ck = (b) => (b ? CHECK : '');
const mark = (b) => (b ? 'true' : 'false');
const s = (v) => (v === undefined || v === null ? '' : String(v));

// ---------- 日付 ----------
const ERAS = [
  { name: '令和', short: 'R', start: '2019-05-01' },
  { name: '平成', short: 'H', start: '1989-01-08' },
  { name: '昭和', short: 'S', start: '1926-12-25' },
  { name: '大正', short: 'T', start: '1912-07-30' },
  { name: '明治', short: 'M', start: '1868-01-25' },
];
function parseDate(v) {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? { y: +m[1], m: +m[2], d: +m[3], iso: m[0] } : null;
}
function wareki(dt) {
  const era = ERAS.find((e) => dt.iso >= e.start);
  const start = +era.start.slice(0, 4);
  return { era, year: dt.y - start + 1 };
}
/** 年・月・日の欄。年は和暦の略号つき（例: R8）。欄が狭いので西暦 4 桁は入らない */
function ymd(prefix, v) {
  const dt = parseDate(v);
  if (!dt) return { [`${prefix}_年`]: '', [`${prefix}_月`]: '', [`${prefix}_日`]: '' };
  const w = wareki(dt);
  return { [`${prefix}_年`]: `${w.era.short}${w.year}`, [`${prefix}_月`]: String(dt.m), [`${prefix}_日`]: String(dt.d) };
}
function ageAt(birth, ref) {
  const b = parseDate(birth);
  const r = parseDate(ref);
  if (!b || !r) return '';
  let a = r.y - b.y;
  if (r.m < b.m || (r.m === b.m && r.d < b.d)) a -= 1;
  return String(a);
}

// ---------- 本体 ----------
export function toInputs(data) {
  const v = (k) => data[k];
  const out = {};
  const put = (o) => Object.assign(out, o);

  // 見出し
  put(ymd('記入日', v('admission.recordDate')));
  put(ymd('入院日', v('admission.date')));
  put(ymd('情報提供日', v('admission.infoProvidedDate')));
  out['医療機関名'] = s(v('admission.hospitalName'));
  out['医療機関の担当者名'] = s(v('admission.hospitalStaff'));
  out['事業所名'] = s(v('office.name'));
  out['ケアマネジャー氏名'] = s(v('office.careManagerName'));
  out['事業所TEL'] = s(v('office.phone'));
  out['事業所FAX'] = s(v('office.fax'));

  // 1. 基本情報
  out['1_フリガナ'] = s(v('person.nameKana'));
  out['1_患者氏名'] = s(v('person.name'));
  const ref = v('admission.recordDate') || v('admission.date');
  out['1_年齢'] = s(v('person.age')) || ageAt(v('person.birthDate'), ref);
  out['1_性別_男'] = mark(v('person.sex') === '男');
  out['1_性別_女'] = mark(v('person.sex') === '女');
  const birth = parseDate(v('person.birthDate'));
  const bw = birth ? wareki(birth) : null;
  out['1_生年月日_明'] = mark(bw?.era.name === '明治');
  out['1_生年月日_大'] = mark(bw?.era.name === '大正');
  out['1_生年月日_昭'] = mark(bw?.era.name === '昭和');
  out['1_生年月日_年'] = bw ? (['明治', '大正', '昭和'].includes(bw.era.name) ? String(bw.year) : `${bw.era.name}${bw.year}`) : '';
  out['1_生年月日_月'] = birth ? String(birth.m) : '';
  out['1_生年月日_日'] = birth ? String(birth.d) : '';
  out['1_郵便番号'] = s(v('person.postalCode'));
  out['1_住所'] = s(v('person.address'));
  out['1_電話番号'] = s(v('person.phone'));
  out['1_住居の種類_戸建て'] = mark(v('housing.buildingType') === '一戸建て');
  out['1_住居の種類_集合住宅'] = mark(v('housing.buildingType') === '集合住宅');
  out['1_何階建て'] = s(v('housing.stories'));
  out['1_居室の階'] = s(v('housing.roomFloor'));
  const ev = v('housing.elevator');
  out['1_エレベーター_有'] = mark(ev === true);
  out['1_エレベーター_無'] = mark(ev === false);
  out['1_住環境の特記事項'] = s(v('housing.notes'));

  // 要介護度
  const level = s(v('cert.careLevel'));
  const status = s(v('cert.status'));
  const shien = /^要支援(\d)$/.exec(level);
  const kaigo = /^要介護(\d)$/.exec(level);
  out['1_要支援'] = ck(!!shien);
  out['1_要支援の数'] = shien ? shien[1] : '';
  out['1_要介護'] = ck(!!kaigo);
  out['1_要介護の数'] = kaigo ? kaigo[1] : '';
  put(ymd('1_有効期間開始', v('cert.validFrom')));
  put(ymd('1_有効期間終了', v('cert.validTo')));
  const app = parseDate(v('cert.applicationDate'));
  const applying = status === '新規申請中' || status === '更新申請中';
  out['1_申請中'] = ck(applying);
  out['1_申請中_申請日_月'] = applying && app ? String(app.m) : '';
  out['1_申請中_申請日_日'] = applying && app ? String(app.d) : '';
  const change = status === '区分変更申請中';
  out['1_区分変更'] = ck(change);
  out['1_区分変更_申請日_月'] = change && app ? String(app.m) : '';
  out['1_区分変更_申請日_日'] = change && app ? String(app.d) : '';
  out['1_未申請'] = ck(status === '未申請');

  // 日常生活自立度
  const phy = v('independence.physical') || {};
  for (const l of ['自立', 'J1', 'J2', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2']) out[`1_障害高齢者自立度_${l}`] = ck(phy.level === l);
  const dem = v('independence.dementia') || {};
  for (const l of ['自立', 'I', 'IIa', 'IIb', 'IIIa', 'IIIb', 'IV', 'M']) out[`1_認知症高齢者自立度_${l}`] = ck(dem.level === l);
  const judges = [phy.judgedBy, dem.judgedBy].filter(Boolean);
  out['1_自立度_医師の判断'] = ck(judges.some((j) => j.startsWith('医師')));
  out['1_自立度_ケアマネの判断'] = ck(judges.includes('ケアマネ'));

  // 負担割合・障害・年金
  const rate = /^(\d)割$/.exec(s(v('insurance.careCopayRate')));
  out['1_自己負担割合'] = ck(!!rate);
  out['1_自己負担割合の数'] = rate ? rate[1] : '';
  out['1_自己負担割合_不明'] = ck(!rate);
  let dis = v('disabilityCertificateSummary');
  if (!dis) {
    dis = [];
    if (v('handbook.physical')?.has) dis.push('身体');
    if (v('handbook.mental')?.has) dis.push('精神');
    if (v('handbook.rehabilitation')?.has) dis.push('知的');
  }
  out['1_障害など認定_なし'] = ck(dis.length === 0);
  out['1_障害など認定_あり'] = ck(dis.length > 0);
  out['1_障害など認定_身体'] = mark(dis.includes('身体'));
  out['1_障害など認定_精神'] = mark(dis.includes('精神'));
  out['1_障害など認定_知的'] = mark(dis.includes('知的'));
  const pensions = (v('pensions') || []).map((p) => p.kind);
  const others = pensions.filter((k) => !['国民年金（老齢基礎）', '厚生年金（老齢）', '障害年金'].includes(k));
  out['1_年金_国民年金'] = ck(pensions.includes('国民年金（老齢基礎）'));
  out['1_年金_厚生年金'] = ck(pensions.includes('厚生年金（老齢）'));
  out['1_年金_障害年金'] = ck(pensions.includes('障害年金'));
  out['1_年金_生活保護'] = ck(v('welfare.publicAssistance') === true);
  out['1_年金_その他'] = ck(others.length > 0);
  out['1_年金_その他の内容'] = others.map((k) => k.replace(/（.*?）/, '')).join('、');

  // 2. 家族構成
  const ht = s(v('household.type'));
  out['2_世帯構成_独居'] = ck(ht === '独居');
  out['2_世帯構成_高齢者世帯'] = ck(ht === '高齢者世帯');
  out['2_世帯構成_子と同居'] = ck(ht === '子と同居');
  out['2_世帯構成_その他'] = ck(ht === 'その他');
  out['2_世帯構成_その他の内容'] = ht === 'その他' ? s(v('household.typeOther')) : '';
  out['2_日中独居'] = ck(v('household.daytimeAlone') === true);
  const members = v('family.members') || [];
  const rel = (m) => s(m.relationshipDetail || m.relationship);
  const main = members.find((m) => m.isMainCaregiver);
  out['2_主介護者_氏名'] = s(main?.name);
  out['2_主介護者_続柄'] = main ? rel(main) : '';
  out['2_主介護者_年齢'] = s(main?.age);
  out['2_主介護者_同居'] = mark(main?.livingTogether === '同居');
  out['2_主介護者_別居'] = mark(main?.livingTogether === '別居');
  out['2_主介護者_TEL'] = s(main?.phone);
  const key = members.find((m) => m.isKeyPerson);
  out['2_キーパーソン_氏名'] = s(key?.name);
  out['2_キーパーソン_続柄'] = key ? rel(key) : '';
  out['2_キーパーソン_年齢'] = s(key?.age);
  out['2_キーパーソン_TEL'] = s(key?.phone || key?.mobile);
  out['2_キーパーソン_TEL_狭い欄'] = key?.phone ? s(key?.mobile) : '';

  // 3. 意向
  out['3_趣味・関心'] = s(v('person.interests'));
  out['3_生活歴'] = s(v('person.lifeHistory'));
  out['3_本人の意向'] = s(v('intention.person'));
  out['3_本人の意向_第1表参照'] = '';
  out['3_家族の意向'] = s(v('intention.family'));
  out['3_家族の意向_第1表参照'] = '';

  // 4. サービス
  out['4_計画書1・2・3表を同封'] = ck(v('admission.enclosedCarePlan') === true);
  const encOther = s(v('admission.enclosedOther'));
  out['4_その他を同封'] = ck(!!encOther);
  out['4_その他の同封書類'] = encOther;

  // 5. 今後の展望
  out['5_在宅生活に必要な要件'] = s(v('outlook.requirements'));
  const oh = v('outlook.household') || {};
  out['5_退院後の世帯_独居'] = ck(oh.type === '独居');
  out['5_退院後の世帯_高齢世帯'] = ck(oh.type === '高齢者世帯');
  out['5_退院後の世帯_子と同居'] = ck(oh.type === '子と同居');
  out['5_退院後の世帯_家族構成員数'] = oh.type === '子と同居' ? s(oh.memberCount) : '';
  out['5_退院後の世帯_日中独居'] = ck(oh.daytimeAlone === true);
  out['5_退院後の世帯_その他'] = ck(oh.type === 'その他');
  out['5_退院後の世帯_その他の内容'] = oh.type === 'その他' ? s(oh.other) : '';
  const hc = v('outlook.householdConsideration');
  out['5_世帯への配慮_不要'] = ck(hc && hc.needed === false);
  out['5_世帯への配慮_必要'] = ck(hc?.needed === true);
  out['5_世帯への配慮_内容'] = hc?.needed ? s(hc.detail) : '';
  const cg = v('outlook.caregiver');
  out['5_退院後の主介護者_同じ'] = ck(cg?.sameAsNow === true);
  out['5_退院後の主介護者_左記以外'] = ck(cg && cg.sameAsNow === false);
  out['5_退院後の主介護者_氏名'] = cg && !cg.sameAsNow ? s(cg.name) : '';
  out['5_退院後の主介護者_続柄'] = cg && !cg.sameAsNow ? s(cg.relationship) : '';
  out['5_退院後の主介護者_年齢'] = cg && !cg.sameAsNow ? s(cg.age) : '';
  const cc = s(v('outlook.careCapacity'));
  out['5_介護力_見込める'] = ck(cc.startsWith('介護力が見込める'));
  out['5_介護力_十分'] = ck(cc === '介護力が見込める（十分）');
  out['5_介護力_一部'] = ck(cc === '介護力が見込める（一部）');
  out['5_介護力_見込めない'] = ck(cc === '介護力は見込めない');
  out['5_介護力_家族や支援者はいない'] = ck(cc === '家族や支援者はいない');
  const ab = v('outlook.abuseSuspicion');
  out['5_虐待の疑い_なし'] = ck(ab && ab.has === false);
  out['5_虐待の疑い_あり'] = ck(ab?.has === true);
  out['5_虐待の疑い_内容'] = ab?.has ? s(ab.detail) : '';
  out['5_特記事項'] = s(v('outlook.notes'));

  // 6. カンファレンス
  out['6_院内カンファレンス_希望あり'] = ck(v('conference.inHospital') === true);
  out['6_退院前カンファレンス_希望あり'] = ck(v('conference.preDischarge') === true);
  out['6_退院前カンファレンス_具体的な要望'] = s(v('conference.preDischargeRequest'));
  out['6_退院前訪問指導の同行_希望あり'] = ck(v('conference.homeVisitAccompany') === true);

  return out;
}
