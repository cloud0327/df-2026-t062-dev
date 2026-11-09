# 認定調査票の取り込み検証資料

[Issue #18](https://github.com/cloud0327/df-2026-t062-dev/issues/18) の最初の検証用。氏名、日付、選択、記述は架空。広島市版の基本調査2ページと特記事項1ページを使い、第1〜5群の55項目に印を付ける。第6・7群は今回の検証範囲外。

- [gold.tsv](gold.tsv) は通常版の正解表。原本の項目番号・ページ、印を付けた選択肢番号、アプリ内ページとフィールドキー、アプリの値（JSON）を記録する。複数回答は配列。アプリ内ページは全社協PDFの表紙を含まない。
- [cases.json](cases.json) は同じ利用者の記録日・場面、特記事項の原文、難読版で変える箇所、別途照合する架空の面談メモ。特記事項は候補から参照できることを確認する。

## 使い方

| ケース | 入力 | 期待結果 |
|---|---|---|
| 通常 | `survey-clean.pdf` | 第1〜5群の55項目が正解表どおりの候補になる。特記事項は3ページ目の該当項目から参照できる。 |
| 難読 | `survey-difficult.pdf` | 2-2は印が薄く、2-4は単一選択欄に2つ印があるため要確認。残り53項目の候補は通常版と同じ。1-1の正当な複数回答は要確認にしない。 |
| 食い違い | 通常版と `cases.json` の `conflict` | 2-5の調査票「一部介助」と面談メモ「全介助」を出典・日時つきで提示し、要確認にする。どちらも自動で確定しない。 |

最初は 2-2・2-4・2-5 を画面まで通し、確定を選んだ候補だけがアプリp.6に反映されることを確認する。次に第2群12項目で手入力との所要時間を比べ、55項目まで同じ正解表で検証する。

## PDFを生成する

原本は、広島市の[介護保険認定調査票](https://www.city.hiroshima.lg.jp/_res/projects/default_project/_page_/001/030/602/245293.pdf)と[特記事項](https://www.city.hiroshima.lg.jp/_res/projects/default_project/_page_/001/030/602/11700.pdf)。それぞれ `basic.pdf`、`notes.pdf` として手元に保存する。生成スクリプトは原本のハッシュを確認し、位置が異なる版での生成を防ぐ。原本と生成PDFはリポジトリに含めない。

リポジトリ直下で実行する。

```sh
python3 -m venv .data/survey-venv
.data/survey-venv/bin/python -m pip install pdfplumber pypdf reportlab
.data/survey-venv/bin/python eval/document-import/survey/make_fixtures.py \
  --basic /path/to/basic.pdf --notes /path/to/notes.pdf \
  --out .data/survey-import-fixtures
```

難読版は印の濃さと数だけを変えたPDF。写真の傾き、影、手書き文字の認識精度を測るには、別の入力サンプルを追加する。
