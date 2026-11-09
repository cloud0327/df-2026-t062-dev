// アセスメント用紙 p.3（PDF の 4 ページ目）: 3 サービス利用状況（後半）、直近の入所・入院、制度利用状況、4 住居等の状況
// 書き方は p1.mjs と同じ。欄の名前は「p3_…」。
// 図（家屋見取図 housing.floorPlan）は人が描くので欄を作らない。
import { textSlot as T, checkSlot as C, circleSlot as O, ck, mark, s } from '../../../scripts/layout.mjs';

export const pdfPage = 4;

export const usesKeys = [
  'services.used', 'services.recentFacility',
  'insurance.healthInsuranceType', 'insurance.workersComp',
  'pensions', 'welfare.publicAssistance', 'welfare.programs', 'welfare.adultGuardianship', 'welfare.others',
  'housing.buildingType', 'housing.tenure', 'housing.privateRoom', 'housing.roomFloor', 'housing.elevator',
  'housing.bedding', 'housing.bedType', 'housing.sunlight', 'housing.heating', 'housing.cooling',
  'housing.toiletStyle', 'housing.toiletHandrail', 'housing.toiletStep',
  'housing.bathAtHome', 'housing.bathHandrail', 'housing.bathStep',
  'housing.mobilityAidsOutdoor', 'housing.mobilityAidsIndoor',
  'housing.cookingEquipment', 'housing.heatingEquipment', 'housing.notes',
];

const R = (x0, x1, y0, y1) => ({ x0, x1, y0, y1 });
const arr = (v) => (Array.isArray(v) ? v : []);

/** hit と同じ行で、hit の左にいちばん近い「□」 */
function nearestBox(P, hit, x0) {
  const yc = (hit.y0 + hit.y1) / 2;
  const cands = P.boxes({ in: { x0: Math.min(x0, hit.x0 - 32), x1: hit.x0 + 1, y0: hit.y0 - 2, y1: hit.y1 + 2 } })
    .filter((b) => hit.x0 - b.x1 < 32)
    .sort((a, b) => Math.abs((a.y0 + a.y1) / 2 - yc) - Math.abs((b.y0 + b.y1) / 2 - yc) || b.x0 - a.x0);
  if (!cands[0]) throw new Error(`p${P.n}: 「${hit.chars.map((c) => c.t).join('')}」の前に □ がありません`);
  const b = cands[0];
  return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
}

// ============ 選ぶ欄（□ に ✓ / 文字を丸で囲む）を、1 つの表で slots と inputs の両方に使う ============
// type: check = □ に ✓、circle = 印刷済みの文字を丸で囲む。on(v) = 見本データ v（key → 値）でその欄が選ばれるか
const eq = (key, val) => (v) => v[key] === val;
const has = (key, val) => (v) => arr(v[key]).includes(val);
const yes = (key) => (v) => v[key] === true;
const no = (key) => (v) => v[key] === false;
const SPECS = [];
function spec(name, type, label, region, on, nth = 0) {
  SPECS.push({ name, type, label, in: region, on, nth });
}

// ---------- 健康保険（右半分） ----------
for (const [label, region] of [
  ['国保', R(115, 152, 76.5, 81)], ['協会けんぽ', R(152, 200, 76.5, 81)],
  ['組合健保', R(115, 152, 81, 85.5)], ['日雇い', R(152, 200, 81, 85.5)],
  ['国公共済', R(115, 152, 85.5, 90)], ['地方共済', R(152, 200, 85.5, 90)],
  ['私立学校共済', R(115, 152, 90, 94.5)], ['船員', R(152, 200, 90, 94.5)],
  ['後期高齢者医療', R(115, 200, 94.5, 99)],
]) spec(`p3_健康保険_${label}`, 'check', label, region, eq('insurance.healthInsuranceType', label));
spec('p3_労災保険', 'check', '労災保険', R(108, 150, 99, 104), (v) => v['insurance.workersComp']?.has === true);

// ---------- 制度利用状況（左半分） ----------
const PENSION = {
  老齢: ['国民年金（老齢基礎）', '厚生年金（老齢）', '共済年金（老齢）'],
  障害: ['障害年金'],
  遺族: ['遺族年金', '寡婦年金'],
  恩給: ['恩給'],
};
const pensionHas = (g) => (v) => arr(v.pensions).some((p) => PENSION[g].includes(p?.kind));
spec('p3_年金_老齢関係', 'check', '老齢関係', R(20, 70, 76.5, 81), pensionHas('老齢'));
spec('p3_年金_障害関係', 'check', '障害関係', R(20, 70, 81, 85.5), pensionHas('障害'));
spec('p3_年金_遺族・寡婦', 'check', '遺族・寡婦', R(20, 70, 85.5, 90), pensionHas('遺族'));
spec('p3_恩給', 'check', '恩給', R(18, 100, 90, 94.5), pensionHas('恩給'));
spec('p3_特別障害者手当', 'check', '特別障害者手当', R(18, 100, 94.5, 99), has('welfare.programs', '特別障害者手当'));
spec('p3_生活保護', 'check', '生活保護', R(18, 100, 99, 103.5), yes('welfare.publicAssistance'));
spec('p3_生活福祉資金貸付', 'check', '生活福祉資金貸付', R(18, 100, 103.5, 108), has('welfare.programs', '生活福祉資金貸付'));
spec('p3_高齢者住宅整備資金貸付', 'check', '高齢者住宅整備資金貸付', R(18, 100, 108, 112.5), has('welfare.programs', '高齢者住宅整備資金貸付'));
spec('p3_日常生活自立支援事業', 'check', '日常生活自立支援事業', R(18, 100, 112.5, 117), has('welfare.programs', '日常生活自立支援事業'));
spec('p3_成年後見制度', 'check', '成年後見制度', R(18, 50, 117, 122), (v) => v['welfare.adultGuardianship']?.has === true || !!v['welfare.adultGuardianship']?.type);
for (const [label, region] of [['成年後見', R(48, 68, 117, 122)], ['保佐', R(68, 82, 117, 122)], ['補助', R(81, 96, 117, 122)]]) {
  spec(`p3_成年後見制度_${label}`, 'check', label, region, (v) => v['welfare.adultGuardianship']?.type === label);
}

// ---------- 直近の入所・入院 ----------
const FACILITY_REGION = R(18, 145, 52.5, 71);
const FACILITIES = [
  ['介護老人福祉施設', '介護老人福祉施設', '介護老人福祉施設'],
  ['介護老人保健施設', '介護老人保健施設', '介護老人保健施設'],
  ['介護医療院', '介護医療院', '介護医療院'],
  ['認知症対応型共同生活介護適用施設（グループホーム）', '認知症対応型共同生活介護適用施設', 'グループホーム'],
  ['特定施設入居者生活介護適用施設（ケアハウス等）', '特定施設入居者生活介護適用施設', 'ケアハウス等'],
  ['医療機関（医療保険適用療養病床）', '医療機関（医療保', '医療機関_医療保険適用療養病床'],
  ['医療機関（療養病床以外）', '医療機関（療養病床以外）', '医療機関_療養病床以外'],
  ['その他の施設', 'その他の施設', 'その他の施設'],
];
for (const [kind, label, short] of FACILITIES) {
  spec(`p3_直近の入所入院_${short}`, 'check', label, FACILITY_REGION, (v) => v['services.recentFacility']?.kind === kind);
}

// ---------- 4 住居等の状況 ----------
const LEFT = (y0, y1) => R(14, 118, y0, y1);
spec('p3_住居_一戸建て', 'check', '戸建て', LEFT(148, 153), eq('housing.buildingType', '一戸建て'));
spec('p3_住居_集合住宅', 'check', '集合住宅', LEFT(148, 153), eq('housing.buildingType', '集合住宅'));
for (const t of ['賃貸', '所有', '社宅等', '公営住宅', 'その他']) spec(`p3_住居_所有の形_${t}`, 'circle', t, LEFT(154, 159), eq('housing.tenure', t));
spec('p3_居室_専用居室あり', 'check', '専用居室あり', LEFT(161.5, 166), yes('housing.privateRoom'));
spec('p3_居室_専用居室なし', 'check', '専用居室なし', LEFT(161.5, 166), no('housing.privateRoom'));
spec('p3_居室_1階', 'check', '１階', LEFT(167.5, 172), eq('housing.roomFloor', 1));
spec('p3_居室_2階', 'check', '２階', LEFT(167.5, 172), eq('housing.roomFloor', 2));
spec('p3_居室_その他の階', 'check', 'その他', R(50, 76, 167.5, 172), (v) => v['housing.roomFloor'] != null && ![1, 2].includes(Number(v['housing.roomFloor'])));
spec('p3_居室_エレベーター有', 'check', '有', R(96, 105, 167.5, 172), yes('housing.elevator'));
spec('p3_居室_エレベーター無', 'check', '無', R(105.5, 112, 167.5, 172), no('housing.elevator'));
spec('p3_居室_寝具_布団', 'check', '布団', LEFT(173, 178), eq('housing.bedding', '布団'));
spec('p3_居室_寝具_ベッド', 'check', 'ベッド', LEFT(173, 178), eq('housing.bedding', 'ベッド'));
for (const t of ['固定式', 'ギャッチ', '電動']) spec(`p3_居室_ベッド_${t}`, 'check', t, LEFT(173, 178), has('housing.bedType', t));
spec('p3_居室_寝具_その他', 'check', 'その他', LEFT(179, 183.5), eq('housing.bedding', 'その他'));
for (const t of ['良', '普通', '悪']) spec(`p3_居室_陽あたり_${t}`, 'check', t, R(40, 100, 184.8, 189), eq('housing.sunlight', t));
spec('p3_居室_暖房_あり', 'check', 'あり', R(30, 62, 190.5, 195), yes('housing.heating'));
spec('p3_居室_暖房_なし', 'check', 'なし', R(30, 62, 190.5, 195), no('housing.heating'));
spec('p3_居室_冷房_あり', 'check', 'あり', R(70, 100, 190.5, 195), yes('housing.cooling'));
spec('p3_居室_冷房_なし', 'check', 'なし', R(70, 100, 190.5, 195), no('housing.cooling'));
spec('p3_トイレ_和式', 'check', '和式', R(14, 72, 200, 204.5), eq('housing.toiletStyle', '和式'));
spec('p3_トイレ_洋式', 'check', '洋式', R(14, 72, 200, 204.5), eq('housing.toiletStyle', '洋式'));
spec('p3_トイレ_その他', 'check', 'その他', R(14, 72, 205.5, 210), eq('housing.toiletStyle', 'その他'));
spec('p3_トイレ_手すり_あり', 'check', 'あり', R(30, 72, 211.5, 215.5), yes('housing.toiletHandrail'));
spec('p3_トイレ_手すり_なし', 'check', 'なし', R(30, 72, 211.5, 215.5), no('housing.toiletHandrail'));
spec('p3_トイレ_段差_あり', 'check', 'あり', R(30, 72, 217, 221.5), yes('housing.toiletStep'));
spec('p3_トイレ_段差_なし', 'check', 'なし', R(30, 72, 217, 221.5), no('housing.toiletStep'));
spec('p3_浴室_自宅にあり', 'check', '自宅にあり', R(14, 75, 228.5, 233), yes('housing.bathAtHome'));
spec('p3_浴室_自宅になし', 'check', '自宅になし', R(14, 75, 228.5, 233), no('housing.bathAtHome'));
spec('p3_浴室_手すり_あり', 'check', 'あり', R(30, 75, 234.5, 239), yes('housing.bathHandrail'));
spec('p3_浴室_手すり_なし', 'check', 'なし', R(30, 75, 234.5, 239), no('housing.bathHandrail'));
spec('p3_浴室_段差_あり', 'check', 'あり', R(30, 75, 240.3, 244.5), yes('housing.bathStep'));
spec('p3_浴室_段差_なし', 'check', 'なし', R(30, 75, 240.3, 244.5), no('housing.bathStep'));

// 移動手段（室外・室内）の福祉機器
const AIDS = [
  ['車いす', R(80, 97, 0, 0)], ['電動車いす', R(97, 120, 0, 0)],
  ['杖', R(80, 97, 0, 0)], ['歩行器', R(97, 120, 0, 0)], ['その他', R(80, 97, 0, 0)],
];
for (const [place, key, rows] of [
  ['室外', 'housing.mobilityAidsOutdoor', { use: 200, aids: [209, 213, 217] }],
  ['室内', 'housing.mobilityAidsIndoor', { use: 226.3, aids: [235, 239, 243] }],
]) {
  const anyAid = (v) => arr(v[key]).some((a) => a !== '使用していない');
  spec(`p3_移動手段_${place}_使用している`, 'check', '使用している', R(80, 99, rows.use, rows.use + 5), anyAid);
  spec(`p3_移動手段_${place}_使用していない`, 'check', '使用していない', R(99, 120, rows.use, rows.use + 5), has(key, '使用していない'));
  const rowOf = { 車いす: 0, 電動車いす: 0, 杖: 1, 歩行器: 1, その他: 2 };
  for (const [aid, reg] of AIDS) {
    const y0 = rows.aids[rowOf[aid]] - 0.5;
    spec(`p3_移動手段_${place}_${aid}`, 'check', aid, R(reg.x0, reg.x1, y0, y0 + 4.5), has(key, aid));
  }
}

spec('p3_諸設備_調理器具_ガス', 'check', 'ガス', R(30, 64, 251.3, 255.5), eq('housing.cookingEquipment', 'ガス'));
spec('p3_諸設備_調理器具_IH', 'check', 'IH', R(30, 64, 251.3, 255.5), eq('housing.cookingEquipment', 'IH'));
for (const t of ['ガス', '電気', '灯油', 'その他']) spec(`p3_諸設備_暖房器具_${t}`, 'check', t, R(64, 120, 251.3, 255.5), has('housing.heatingEquipment', t));

// ---------- サービス利用状況（後半）: 「月 □ 回」の行 ----------
const SV_LEFT = R(14, 108, 15, 52);
const SV_RIGHT = R(107, 200, 15, 52);
const SERVICES = [
  ['配食サービス', '配食サービス', SV_LEFT, 'kai'],
  ['洗濯サービス', '洗濯サービス', SV_LEFT, 'kai'],
  ['移動または外出支援', '移動または外出支援', SV_LEFT, 'kai'],
  ['友愛訪問', '友愛訪問', SV_LEFT, 'kai'],
  ['老人福祉センター', '老人福祉センター', SV_LEFT, 'kai'],
  ['老人憩いの家', '老人憩いの家', SV_LEFT, 'kai'],
  ['ガイドヘルパー', 'ガイドヘルパー', SV_LEFT, 'kai'],
  ['身障／補装具・日常生活用具', '身障／補装具・日常生活用具', SV_LEFT, 'bracket'],
  ['生活支援員の訪問（日常生活自立支援事業）', '生活支援員の訪問', SV_RIGHT, 'kai'],
  ['ふれあい・いきいきサロン', 'ふれあい・いきいきサロン', SV_RIGHT, 'kai'],
  ['市町村特別給付', '市町村特別給付', SV_RIGHT, 'bracket'],
];
// 右側の「□（　）月 回」2 行。「その他」の kind を上から順に入れる
const OTHER_ROWS = [
  { box: R(107, 112, 29.5, 34), mk: R(172, 192, 31.5, 36) },
  { box: R(107, 112, 38, 42.5), mk: R(172, 192, 40, 44.5) },
];

const unitText = (u) => {
  if (!u) return '';
  const a = s(u.amount);
  return a ? `${a}${s(u.unit)}` : '';
};

export function slots(P) {
  const out = [];
  const add = (...a) => out.push(...a.flat());

  // ---------- サービス利用状況（後半） ----------
  for (const [kind, label, reg, unit] of SERVICES) {
    const hit = P.find(label, { in: reg });
    add(C(`p3_${kind}_チェック`, nearestBox(P, hit, reg.x0)));
    if (unit === 'kai') {
      const row = R(hit.x1, reg.x1, hit.y0 - 1, hit.y1 + 1);
      const m = P.find('月', { in: row });
      const u = P.find('回', { in: { ...row, x0: m.x1 } });
      add(T(`p3_${kind}_量`, m.x1 + 0.3, m.y0 - (reg === SV_RIGHT ? 0.7 : 0.2), u.x0 - m.x1 - 0.6, m.y1 - m.y0 + 0.4, { size: 8.5, align: 'center' }));
    } else {
      const open = P.find(kind === '市町村特別給付' ? '［' : '（', { in: R(hit.x1 - 2, reg.x1, hit.y0 - 1, hit.y1 + 1) });
      const close = P.find(kind === '市町村特別給付' ? '］' : '）', { in: R(open.x1, reg.x1, hit.y0 - 1, hit.y1 + 1) });
      add(T(`p3_${kind}_内容`, open.x1 + 0.3, hit.y0 - 0.8, close.x0 - open.x1 - 0.6, hit.y1 - hit.y0 + 0.4, { size: 8.5, fit: 'horizontal' }));
    }
  }
  OTHER_ROWS.forEach((r, i) => {
    const n = i + 1;
    const box = P.boxes({ in: r.box })[0];
    if (!box) throw new Error(`p${P.n}: その他 ${n} 行目の □ が見つかりません`);
    add(C(`p3_その他${n}_チェック`, { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 }));
    const m = P.find('月', { in: r.mk });
    const u = P.find('回', { in: { ...r.mk, x0: m.x1 } });
    add(T(`p3_その他${n}_量`, m.x1 + 0.3, m.y0 - 0.8, u.x0 - m.x1 - 0.6, m.y1 - m.y0 + 0.4, { size: 8.5, align: 'center' }));
    // 名称は「（　）」の間（大きな括弧は 2 行にまたがるので、月・回の行の高さに合わせる）
    const open = P.find('（', { in: R(108, 114, box.y0, box.y0 + 12) });
    const close = P.find('）', { in: R(160, 170, box.y0, box.y0 + 12) });
    add(T(`p3_その他${n}_名称`, open.x1 + 0.3, m.y0 - 0.8, close.x0 - open.x1 - 0.6, m.y1 - m.y0 + 0.4, { size: 8.5, fit: 'horizontal' }));
  });

  // ---------- 直近の入所・入院（右の枠の記入欄） ----------
  const nameLabel = P.find('施設・機関名', { in: R(140, 200, 52.5, 58) });
  add(T('p3_直近の入所入院_施設機関名', nameLabel.x1 + 0.8, nameLabel.y0 - 0.2, 193.5 - nameLabel.x1 - 0.8, nameLabel.y1 - nameLabel.y0 + 0.4, { size: 8.5, fit: 'horizontal', minSize: 5 }));
  const zip = P.find('〒', { in: R(140, 200, 57.5, 62) });
  add(T('p3_直近の入所入院_所在地', 146.0, zip.y1 + 0.3, 47.5, 66.1 - zip.y1 - 0.5, { size: 8, fit: 'horizontal', minSize: 5, valign: 'bottom' }));
  const tel = P.find('☎', { in: R(140, 200, 66, 72) });
  add(T('p3_直近の入所入院_電話', tel.x1 + 0.8, tel.y0 - 1.0, 193.5 - tel.x1 - 0.8, tel.y1 - tel.y0 + 0.4, { size: 8.5 }));

  // ---------- 制度利用状況 ----------
  const parenSlot = (name, openReg, closeReg, y0, y1, opts = {}) => {
    const open = P.find('（', { in: openReg });
    const close = P.find('）', { in: closeReg });
    add(T(name, open.x1 + 0.3, y0 - 0.6, close.x0 - open.x1 - 0.6, y1 - y0, { size: 8.5, fit: 'horizontal', minSize: 5, ...opts }));
  };
  parenSlot('p3_年金_老齢関係_内容', R(40, 60, 77, 81), R(70, 80, 77, 81), 77.3, 80.6);
  parenSlot('p3_年金_障害関係_内容', R(40, 60, 81.5, 85.5), R(70, 80, 81.5, 85.5), 81.8, 85.1);
  parenSlot('p3_年金_遺族・寡婦_内容', R(40, 60, 86, 90), R(70, 80, 86, 90), 86.3, 89.5);
  parenSlot('p3_労災保険_内容', R(125, 140, 99.5, 103.5), R(170, 180, 99.5, 103.5), 99.8, 103.0);
  parenSlot('p3_成年後見人等', R(60, 75, 121.5, 126), R(90, 100, 121.5, 126), 122.1, 125.3);
  // 健康保険の下の「その他」3 行（□（　））
  [108.2, 112.7, 117.2].forEach((y, i) => {
    const box = P.boxes({ in: R(116, 121.5, y - 0.5, y + 4) })[0];
    if (!box) throw new Error(`p${P.n}: 制度のその他 ${i + 1} 行目の □ が見つかりません`);
    add(C(`p3_制度その他${i + 1}_チェック`, { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 }));
    parenSlot(`p3_制度その他${i + 1}_名称`, R(118, 123, y - 0.5, y + 4), R(172, 180, y - 0.5, y + 4), y, y + 3.2);
  });

  // ---------- 選ぶ欄（表から） ----------
  for (const sp of SPECS) {
    const hit = P.find(sp.label, { in: sp.in, nth: sp.nth });
    add(sp.type === 'check' ? C(sp.name, nearestBox(P, hit, sp.in.x0)) : O(sp.name, hit));
  }

  // ---------- 住居: 階の数字、特記事項 ----------
  const floorOpen = P.find('（', { in: R(55, 70, 167.5, 172) });
  const floorClose = P.find('）', { in: R(70, 80, 167.5, 172) });
  add(T('p3_居室_階の数字', floorOpen.x1, floorOpen.y0 - 0.2, floorClose.x0 - floorOpen.x1, floorOpen.y1 - floorOpen.y0 + 0.4, { size: 8.5, align: 'center' }));
  const notesHead = P.find('【周辺環境', { in: R(10, 100, 258, 264) });
  add(T('p3_住居_特記事項', 14.0, notesHead.y1 + 0.8, 183.0, 283.8 - notesHead.y1 - 0.8, { size: 9, valign: 'top', fit: 'vertical', minSize: 6 }));
  return out;
}

// ---------- データ → 欄の値 ----------
const PENSION_LABEL = {
  '国民年金（老齢基礎）': '国民年金', '厚生年金（老齢）': '厚生年金', '共済年金（老齢）': '共済年金',
  遺族年金: '遺族年金', 寡婦年金: '寡婦年金',
};
const pensionText = (list, group) => arr(list)
  .filter((p) => PENSION[group].includes(p?.kind))
  .map((p) => s(p.detail) || PENSION_LABEL[p.kind] || '')
  .filter(Boolean)
  .join('、');

export function inputs(data) {
  const v = data;
  const o = {};

  // 選ぶ欄
  for (const sp of SPECS) {
    const on = !!sp.on(v);
    o[sp.name] = sp.type === 'check' ? ck(on) : mark(on);
  }

  // サービス利用状況（後半）
  const used = arr(v['services.used']);
  for (const [kind, , , unit] of SERVICES) {
    const u = used.find((x) => x?.kind === kind);
    o[`p3_${kind}_チェック`] = ck(u !== undefined);
    if (unit === 'kai') o[`p3_${kind}_量`] = u ? s(u.amount) : '';
    else o[`p3_${kind}_内容`] = u ? (s(u.name) || unitText(u)) : '';
  }
  const others = used.filter((x) => x?.kind === 'その他');
  OTHER_ROWS.forEach((_, i) => {
    const u = others[i];
    o[`p3_その他${i + 1}_チェック`] = ck(u !== undefined);
    o[`p3_その他${i + 1}_名称`] = u ? s(u.name) : '';
    o[`p3_その他${i + 1}_量`] = u ? s(u.amount) : '';
  });

  // 直近の入所・入院
  const f = v['services.recentFacility'] || {};
  o['p3_直近の入所入院_施設機関名'] = s(f.name);
  o['p3_直近の入所入院_所在地'] = s(f.address);
  o['p3_直近の入所入院_電話'] = s(f.phone);

  // 制度利用状況
  o['p3_年金_老齢関係_内容'] = pensionText(v.pensions, '老齢');
  o['p3_年金_障害関係_内容'] = pensionText(v.pensions, '障害');
  o['p3_年金_遺族・寡婦_内容'] = pensionText(v.pensions, '遺族');
  o['p3_労災保険_内容'] = s(v['insurance.workersComp']?.detail);
  o['p3_成年後見人等'] = s(v['welfare.adultGuardianship']?.guardian);
  const wo = arr(v['welfare.others']);
  for (let i = 0; i < 3; i++) {
    o[`p3_制度その他${i + 1}_チェック`] = ck(wo[i] !== undefined);
    o[`p3_制度その他${i + 1}_名称`] = s(wo[i]?.name);
  }

  // 住居
  o['p3_居室_階の数字'] = v['housing.roomFloor'] != null && ![1, 2].includes(Number(v['housing.roomFloor'])) ? s(v['housing.roomFloor']) : '';
  o['p3_住居_特記事項'] = s(v['housing.notes']);
  return o;
}
