"""様式の PDF から、文字・語・罫線の座標を取り出して layout.json に書く。

テンプレートを組み立てるスクリプト（build-*.mjs）と、位置をそろえる処理（align.mjs）が使う。
単位は mm、各ページの左上が原点（表示範囲 CropBox の左上）。

文字ごとに次を記録する:
  x0, y0, x1, y1 … pdfplumber の文字の枠。上下はフォントの情報で決まるので、フォントによって実際の字より上下にずれる
  b              … 基準線（文字が乗る線）の高さ。PDF の中の正確な値
  s              … 文字の大きさ
  ink            … 実際にインクが乗っている範囲 [x0, y0, x1, y1]。ページを画像にして測る。測れなければ null

使い方:
  python3 scripts/extract_layout.py templates/assessment/base.pdf templates/assessment/layout.json
必要なもの: pdfplumber（pip install pdfplumber。pypdfium2 と Pillow も一緒に入る）
"""
import json
import sys

import pdfplumber
import pypdfium2

MM = 25.4 / 72
DPI = 300
PX_PER_MM = DPI / 25.4
INK_THRESHOLD = 150  # これより暗い画素をインクとみなす（0〜255）


def r(v):
    return round(v * MM, 2)


def ink_box(mask, x0, x1, top, bottom):
    """mm の範囲を切り出して、インクの範囲（mm）を返す。なければ None"""
    box = (int(x0 * PX_PER_MM), int(top * PX_PER_MM), int(x1 * PX_PER_MM) + 1, int(bottom * PX_PER_MM) + 1)
    bb = mask.crop(box).getbbox()
    if not bb:
        return None
    return [
        round(box[0] / PX_PER_MM + bb[0] / PX_PER_MM, 2),
        round(box[1] / PX_PER_MM + bb[1] / PX_PER_MM, 2),
        round(box[0] / PX_PER_MM + bb[2] / PX_PER_MM, 2),
        round(box[1] / PX_PER_MM + bb[3] / PX_PER_MM, 2),
    ]


def char_ink(mask, c):
    """1 文字のインクの範囲。罫線などが入り込んだら狭めて測り直す"""
    s, b = c["s"], c["b"]
    tries = [
        (c["x0"] - 0.05, c["x1"] + 0.05, b - 1.0 * s, b + 0.3 * s),
        (c["x0"] + 0.05, c["x1"] - 0.05, b - 0.92 * s, b + 0.16 * s),
    ]
    for x0, x1, top, bottom in tries:
        ink = ink_box(mask, x0, x1, top, bottom)
        if ink is None:
            return None
        w, h = ink[2] - ink[0], ink[3] - ink[1]
        if w <= (c["x1"] - c["x0"]) + 0.3 and h <= 1.1 * s:
            return ink
    return None


def main(src, dst):
    pages = []
    doc = pypdfium2.PdfDocument(src)
    with pdfplumber.open(src) as pdf:
        for i, p in enumerate(pdf.pages):
            # 表示範囲（CropBox）の左上を原点にする
            ox, oy = p.cropbox[0], p.cropbox[1]
            # pdfplumber は CropBox の外の文字も返すことがあるので、範囲内に絞る
            q = p.crop(p.cropbox, strict=False)

            # ページを画像にして、インクの画素を白、それ以外を黒にした画像を作る（pdfium は CropBox を描く）
            img = doc[i].render(scale=DPI / 72).to_pil().convert("L")
            mask = img.point(lambda v: 255 if v < INK_THRESHOLD else 0)

            words = [
                {"t": w["text"], "x0": r(w["x0"] - ox), "y0": r(w["top"] - oy), "x1": r(w["x1"] - ox), "y1": r(w["bottom"] - oy)}
                for w in q.extract_words(x_tolerance=1.5, keep_blank_chars=False)
            ]
            chars = []
            for c in q.chars:
                if not c["text"].strip():
                    continue
                # 基準線: 文字の枠の上端（ページ上端から）+（枠の上端 − 基準線）。どちらも PDF の座標（上が正）
                baseline_top = c["top"] + (c["y1"] - c["matrix"][5])
                ch = {
                    "t": c["text"],
                    "x0": r(c["x0"] - ox), "y0": r(c["top"] - oy), "x1": r(c["x1"] - ox), "y1": r(c["bottom"] - oy),
                    "b": r(baseline_top - oy),
                    "s": r(c["size"]),
                }
                ch["ink"] = char_ink(mask, ch)
                chars.append(ch)
            hlines, vlines = [], []
            for e in q.edges:
                if e["orientation"] == "h":
                    hlines.append([r(e["top"] - oy), r(e["x0"] - ox), r(e["x1"] - ox)])
                else:
                    vlines.append([r(e["x0"] - ox), r(e["top"] - oy), r(e["bottom"] - oy)])
            pages.append({
                "page": i + 1,
                "width": r(p.cropbox[2] - p.cropbox[0]),
                "height": r(p.cropbox[3] - p.cropbox[1]),
                "words": words,
                "chars": chars,
                "hlines": sorted(hlines),
                "vlines": sorted(vlines),
            })
    with open(dst, "w", encoding="utf-8") as f:
        json.dump({"source": src, "unit": "mm", "pages": pages}, f, ensure_ascii=False)
    for pg in pages:
        no_ink = sum(1 for c in pg["chars"] if c["ink"] is None)
        print(f"p{pg['page']}: {pg['width']}x{pg['height']} 語 {len(pg['words'])} 文字 {len(pg['chars'])}（インクを測れない {no_ink}） 横線 {len(pg['hlines'])} 縦線 {len(pg['vlines'])}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
