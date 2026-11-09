// 入院時情報提供書の pdfme テンプレートの「最初の版」を作る。
//
// 欄の位置は、元の PDF（templates/admission/base.pdf）の文字と「□」の座標を
// pdfplumber で取り出して決めた（単位は mm、左上が原点）。
//
// 注意: これを実行すると forms/seed/admission/template.json を上書きする。
// Designer（npm run designer）で位置を直したあとは、このスクリプトを実行しないこと。
import { writeFileSync } from 'node:fs';
import { loadLayout } from './load-layout.mjs';
import { alignSchemas, printReport } from './align.mjs';

const FONT = 'BIZUDPGothic';
const schemas = [];

/** 文字の欄 */
function txt(name, x, y, w, h, opts = {}) {
  schemas.push({
    name,
    type: 'text',
    content: '',
    position: { x, y },
    width: w,
    height: h,
    fontName: FONT,
    fontSize: opts.size ?? 9,
    alignment: opts.align ?? 'left',
    verticalAlignment: opts.valign ?? 'middle',
    lineHeight: opts.lineHeight ?? 1.1,
    characterSpacing: 0,
    fontColor: '#1a3fa0',
    ...(opts.fit ? { dynamicFontSize: { min: opts.minSize ?? 5, max: opts.size ?? 9, fit: opts.fit } } : {}),
  });
}

/** 印刷済みの「□」の上に ✓ を置く欄。x, y は □ の左上 */
function check(name, x, y) {
  schemas.push({
    name,
    type: 'text',
    content: '',
    position: { x: x - 0.1, y: y - 0.3 },
    width: 2.9,
    height: 3.0,
    fontName: FONT,
    fontSize: 10,
    alignment: 'center',
    verticalAlignment: 'middle',
    lineHeight: 1,
    characterSpacing: 0,
    fontColor: '#1a3fa0',
  });
}

/** 印刷済みの文字を丸で囲む欄。cx, cy は中心 */
function circle(name, cx, cy, w, h = 3.8) {
  schemas.push({
    name,
    type: 'circleMark',
    content: 'false',
    position: { x: cx - w / 2, y: cy - h / 2 },
    width: w,
    height: h,
    rotate: 0,
    opacity: 1,
    color: '#1a3fa0',
    borderWidth: 0.3,
  });
}

/** 年・月・日の 3 つの欄。xs は [年の左, 年の右, 月の左, 月の右, 日の左, 日の右] */
function ymd(prefix, y, xs, h = 2.8, size = 8) {
  txt(`${prefix}_年`, xs[0], y, xs[1] - xs[0], h, { size, align: 'right' });
  txt(`${prefix}_月`, xs[2], y, xs[3] - xs[2], h, { size, align: 'center' });
  txt(`${prefix}_日`, xs[4], y, xs[5] - xs[4], h, { size, align: 'center' });
}

// ---------- 見出し（右上の日付、医療機関・事業所） ----------
ymd('記入日', 5.6, [155.2, 160.0, 162.5, 167.4, 169.9, 174.8]);
ymd('入院日', 8.8, [155.2, 160.0, 162.5, 167.4, 169.9, 174.8]);
ymd('情報提供日', 12.0, [154.6, 160.1, 162.7, 167.5, 170.1, 174.9]);
txt('医療機関名', 43.0, 26.6, 58.0, 4.0, { size: 10, fit: 'horizontal' });
txt('医療機関の担当者名', 43.0, 32.2, 58.0, 4.0, { size: 10, fit: 'horizontal' });
txt('事業所名', 116.2, 26.8, 66.0, 4.0, { size: 10, fit: 'horizontal' });
txt('ケアマネジャー氏名', 128.8, 32.4, 53.0, 4.0, { size: 10, fit: 'horizontal' });
txt('事業所TEL', 110.2, 38.4, 22.4, 3.6, { size: 7.5, fit: 'horizontal', minSize: 5 });
txt('事業所FAX', 140.4, 38.4, 42.0, 3.6, { size: 7.5, fit: 'horizontal', minSize: 5 });

// ---------- 1. 利用者（患者）基本情報 ----------
txt('1_フリガナ', 57.2, 54.8, 44.5, 3.8, { size: 7.5, fit: 'horizontal' });
txt('1_患者氏名', 47.4, 59.6, 54.2, 6.4, { size: 13, fit: 'horizontal' });
txt('1_年齢', 117.2, 54.8, 10.5, 3.8, { size: 9, align: 'right' });
circle('1_性別_男', 164.3, 56.55, 4.4);
circle('1_性別_女', 172.3, 56.55, 4.4);
circle('1_生年月日_明', 120.15, 62.65, 3.8);
circle('1_生年月日_大', 124.45, 62.65, 3.8);
circle('1_生年月日_昭', 128.75, 62.65, 3.8);
txt('1_生年月日_年', 131.0, 61.2, 17.0, 3.0, { size: 9, align: 'right' });
txt('1_生年月日_月', 151.2, 61.2, 6.9, 3.0, { size: 9, align: 'center' });
txt('1_生年月日_日', 160.9, 61.2, 6.9, 3.0, { size: 9, align: 'center' });
txt('1_郵便番号', 50.0, 66.6, 30.0, 2.8, { size: 8 });
txt('1_住所', 47.4, 69.4, 54.4, 4.4, { size: 9, fit: 'horizontal' });
txt('1_電話番号', 124.8, 67.4, 57.4, 5.6, { size: 10 });
circle('1_住居の種類_戸建て', 65.85, 77.25, 7.4);
circle('1_住居の種類_集合住宅', 77.5, 77.25, 10.4);
txt('1_何階建て', 89.0, 75.7, 5.0, 2.8, { size: 8, align: 'center' });
txt('1_居室の階', 115.0, 75.7, 4.9, 2.8, { size: 8, align: 'center' });
circle('1_エレベーター_有', 145.1, 77.25, 3.8);
circle('1_エレベーター_無', 150.85, 77.25, 3.8);
txt('1_住環境の特記事項', 60.5, 82.7, 103.0, 3.2, { size: 8, fit: 'horizontal' });

check('1_要支援', 48.7, 89.5);
txt('1_要支援の数', 62.9, 89.4, 7.0, 2.8, { size: 8, align: 'center' });
check('1_要介護', 76.2, 89.5);
txt('1_要介護の数', 89.6, 89.4, 7.0, 2.8, { size: 8, align: 'center' });
ymd('1_有効期間開始', 89.4, [116.3, 121.5, 124.2, 129.5, 132.2, 137.4]);
// 終了の「年」は「～」と「年」の間が 3.6mm しかないので、文字を小さくする
txt('1_有効期間終了_年', 146.3, 89.4, 3.8, 2.8, { size: 6.5, align: 'right', fit: 'horizontal', minSize: 4 });
txt('1_有効期間終了_月', 152.7, 89.4, 5.2, 2.8, { size: 8, align: 'center' });
txt('1_有効期間終了_日', 160.7, 89.4, 5.2, 2.8, { size: 8, align: 'center' });
check('1_申請中', 48.7, 93.3);
txt('1_申請中_申請日_月', 69.4, 93.2, 5.3, 2.8, { size: 8, align: 'center' });
txt('1_申請中_申請日_日', 77.4, 93.2, 4.5, 2.8, { size: 8, align: 'center' });
check('1_区分変更', 89.9, 93.3);
txt('1_区分変更_申請日_月', 113.9, 93.2, 7.0, 2.8, { size: 8, align: 'center' });
txt('1_区分変更_申請日_日', 123.6, 93.2, 3.6, 2.8, { size: 8, align: 'center' });
check('1_未申請', 133.4, 93.3);

const physical = [['自立', 48.7], ['J1', 60.2], ['J2', 70.3], ['A1', 80.4], ['A2', 91.1], ['B1', 101.8], ['B2', 112.5], ['C1', 123.1], ['C2', 133.8]];
for (const [label, x] of physical) check(`1_障害高齢者自立度_${label}`, x, 100.5);
check('1_自立度_医師の判断', 146.6, 100.4);
const dementia = [['自立', 48.7], ['I', 61.1], ['IIa', 71.8], ['IIb', 84.0], ['IIIa', 96.3], ['IIIb', 108.5], ['IV', 120.8], ['M', 132.4]];
for (const [label, x] of dementia) check(`1_認知症高齢者自立度_${label}`, x, 109.0);
check('1_自立度_ケアマネの判断', 146.6, 108.8);

check('1_自己負担割合', 48.7, 117.3);
txt('1_自己負担割合の数', 51.4, 117.0, 7.1, 2.9, { size: 8.5, align: 'center' });
check('1_自己負担割合_不明', 66.5, 117.3);
check('1_障害など認定_なし', 119.1, 117.2);
check('1_障害など認定_あり', 128.6, 117.2);
circle('1_障害など認定_身体', 143.15, 118.55, 6.4);
circle('1_障害など認定_精神', 151.6, 118.55, 6.4);
circle('1_障害など認定_知的', 160.05, 118.55, 6.4);

check('1_年金_国民年金', 48.7, 124.2);
check('1_年金_厚生年金', 66.5, 124.2);
check('1_年金_障害年金', 84.2, 124.2);
check('1_年金_生活保護', 103.8, 124.2);
check('1_年金_その他', 121.6, 124.2);
txt('1_年金_その他の内容', 133.3, 124.1, 29.0, 2.9, { size: 8, fit: 'horizontal' });

// ---------- 2. 家族構成／連絡先 ----------
check('2_世帯構成_独居', 48.7, 135.3);
check('2_世帯構成_高齢者世帯', 62.0, 135.3);
check('2_世帯構成_子と同居', 81.6, 135.3);
check('2_世帯構成_その他', 98.4, 135.3);
txt('2_世帯構成_その他の内容', 110.6, 135.2, 51.2, 2.9, { size: 8, fit: 'horizontal' });
check('2_日中独居', 100.3, 139.2);

txt('2_主介護者_氏名', 47.4, 144.2, 37.6, 4.6, { size: 10, fit: 'horizontal' });
txt('2_主介護者_続柄', 93.2, 145.0, 5.4, 2.9, { size: 7, align: 'center', fit: 'horizontal' });
txt('2_主介護者_年齢', 99.7, 145.0, 3.9, 2.9, { size: 6, align: 'center', fit: 'horizontal', minSize: 4 });
circle('2_主介護者_同居', 115.55, 146.45, 5.6, 3.6);
circle('2_主介護者_別居', 124.65, 146.45, 5.6, 3.6);
txt('2_主介護者_TEL', 153.7, 144.2, 28.8, 4.6, { size: 8.5, fit: 'horizontal' });

txt('2_キーパーソン_氏名', 47.4, 150.0, 37.6, 4.6, { size: 10, fit: 'horizontal' });
txt('2_キーパーソン_続柄', 93.2, 150.7, 5.4, 2.9, { size: 7, align: 'center', fit: 'horizontal' });
txt('2_キーパーソン_年齢', 99.7, 150.7, 3.9, 2.9, { size: 6, align: 'center', fit: 'horizontal', minSize: 4 });
// 「連絡先 TEL：」の後ろ（狭い）に 2 つ目の番号、右端の TEL の欄（広い）に主な番号を入れる
txt('2_キーパーソン_TEL_狭い欄', 132.1, 150.6, 14.2, 3.3, { size: 6.5, fit: 'horizontal', minSize: 4 });
txt('2_キーパーソン_TEL', 153.7, 150.0, 28.8, 4.6, { size: 8.5, fit: 'horizontal' });

// ---------- 3. 本人／家族の意向 ----------
txt('3_趣味・関心', 47.4, 162.0, 135.0, 6.2, { size: 9, valign: 'top', fit: 'vertical' });
txt('3_生活歴', 47.4, 169.3, 135.0, 6.3, { size: 9, valign: 'top', fit: 'vertical' });
txt('3_本人の意向', 47.4, 176.6, 135.0, 4.8, { size: 9, valign: 'top', fit: 'vertical' });
check('3_本人の意向_第1表参照', 47.5, 181.5);
txt('3_家族の意向', 47.4, 185.0, 135.0, 4.9, { size: 9, valign: 'top', fit: 'vertical' });
check('3_家族の意向_第1表参照', 47.5, 190.0);

// ---------- 4. 入院前の介護サービスの利用状況 ----------
check('4_計画書1・2・3表を同封', 46.9, 203.8);
check('4_その他を同封', 86.0, 203.8);
txt('4_その他の同封書類', 98.3, 203.7, 28.0, 2.9, { size: 8, fit: 'horizontal' });

// ---------- 5. 今後の在宅生活の展望 ----------
txt('5_在宅生活に必要な要件', 47.4, 213.6, 135.0, 7.6, { size: 9, valign: 'top', fit: 'vertical' });
check('5_退院後の世帯_独居', 46.9, 222.5);
check('5_退院後の世帯_高齢世帯', 61.1, 222.5);
check('5_退院後の世帯_子と同居', 80.7, 222.5);
txt('5_退院後の世帯_家族構成員数', 112.0, 222.4, 29.6, 2.9, { size: 8, align: 'center' });
check('5_退院後の世帯_日中独居', 153.5, 222.5);
check('5_退院後の世帯_その他', 46.9, 226.3);
txt('5_退院後の世帯_その他の内容', 59.3, 226.2, 111.5, 2.9, { size: 8, fit: 'horizontal' });
check('5_世帯への配慮_不要', 46.9, 231.1);
check('5_世帯への配慮_必要', 46.9, 234.9);
txt('5_世帯への配慮_内容', 57.8, 234.8, 112.4, 2.9, { size: 8, fit: 'horizontal' });
check('5_退院後の主介護者_同じ', 46.9, 240.0);
check('5_退院後の主介護者_左記以外', 71.4, 240.0);
txt('5_退院後の主介護者_氏名', 92.9, 239.9, 44.0, 2.9, { size: 8, fit: 'horizontal' });
txt('5_退院後の主介護者_続柄', 142.5, 239.9, 10.5, 2.9, { size: 8, align: 'center', fit: 'horizontal' });
txt('5_退院後の主介護者_年齢', 160.8, 239.9, 8.7, 2.9, { size: 8, align: 'center' });
check('5_介護力_見込める', 47.8, 245.5);
check('5_介護力_十分', 74.6, 245.5);
check('5_介護力_一部', 91.1, 245.5);
check('5_介護力_見込めない', 107.9, 245.5);
check('5_介護力_家族や支援者はいない', 136.4, 245.5);
check('5_虐待の疑い_なし', 46.9, 250.6);
check('5_虐待の疑い_あり', 46.9, 254.4);
txt('5_虐待の疑い_内容', 56.3, 254.3, 113.4, 2.9, { size: 8, fit: 'horizontal' });
txt('5_特記事項', 47.4, 258.7, 135.0, 7.0, { size: 9, valign: 'top', fit: 'vertical' });

// ---------- 6. カンファレンス等 ----------
check('6_院内カンファレンス_希望あり', 76.6, 272.6);
check('6_退院前カンファレンス_希望あり', 76.6, 277.5);
txt('6_退院前カンファレンス_具体的な要望', 122.6, 277.4, 42.3, 2.9, { size: 8, fit: 'horizontal' });
check('6_退院前訪問指導の同行_希望あり', 76.6, 282.2);

// 小数の誤差（4.800000000000011 など）を丸める
const r2 = (n) => Math.round(n * 100) / 100;
for (const s of schemas) {
  s.position = { x: r2(s.position.x), y: r2(s.position.y) };
  s.width = r2(s.width);
  s.height = r2(s.height);
}

const names = schemas.map((s) => s.name);
const dup = names.filter((n, i) => names.indexOf(n) !== i);
if (dup.length) throw new Error(`欄の名前が重複: ${dup.join(', ')}`);

// 欄を、書類の □・文字・罫線にぴったり合わせる（scripts/align.mjs）
const aligned = alignSchemas([schemas], loadLayout('admission'));
console.log('位置をそろえた結果:');
console.log(printReport(aligned.report));
const template = { basePdf: 'base.pdf', schemas: aligned.schemas };
writeFileSync(new URL('../../seed/admission/template.json', import.meta.url), JSON.stringify(template, null, 2));
console.log(`template.json を書き出しました（欄 ${schemas.length} 個）`);
