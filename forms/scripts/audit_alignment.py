"""印字の位置のずれを測る。

作った PDF（out/<様式>_見本.pdf と out/<様式>_位置確認.pdf）を画像にして、
青い印字のインクの位置を、書類の □・文字・罫線と比べる。

  ✓        … ✓ のインクの中心と、□ のインクの中心の差
  丸       … 丸の中心と、囲んだ文字のインクの中心の差
  罫線の文 … 印字の基準線と、すぐ下の罫線の間（全部同じ間になっているか）
  1 行の文 … 印字の基準線と、同じ行の書類の文字（「年」「歳）」など）の基準線の差

使い方: python3 scripts/audit_alignment.py assessment
（先に node scripts/generate.mjs --form assessment と --layout で PDF を作っておく）
"""
import json
import statistics
import sys
from pathlib import Path

import pdfplumber
import pypdfium2

ROOT = Path(__file__).resolve().parent.parent
LABELS = {"admission": "入院時情報提供書", "assessment": "アセスメント"}
DPI = 300
PX = DPI / 25.4
MM = 25.4 / 72


def blue_mask(pil):
    """青い印字の画素だけを白にした画像"""
    rgb = pil.convert("RGB")
    r, g, b = rgb.split()
    from PIL import ImageChops
    # b − r が大きく、r が小さい画素
    diff = ImageChops.subtract(b, r)
    m1 = diff.point(lambda v: 255 if v > 45 else 0)
    m2 = r.point(lambda v: 255 if v < 200 else 0)
    return ImageChops.multiply(m1, m2)


def bbox_mm(mask, x0, y0, x1, y1):
    box = (max(0, int(x0 * PX)), max(0, int(y0 * PX)), int(x1 * PX) + 1, int(y1 * PX) + 1)
    bb = mask.crop(box).getbbox()
    if not bb:
        return None
    return (box[0] / PX + bb[0] / PX, box[1] / PX + bb[1] / PX, box[0] / PX + bb[2] / PX, box[1] / PX + bb[3] / PX)


def center(b):
    return ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)


def inserted_lines(pdf_page, ox=0):
    """印字した文字（BIZ UDP ゴシック）を、基準線ごとにまとめる"""
    rows = []
    for c in pdf_page.chars:
        if "BIZUDP" not in c["fontname"] or not c["text"].strip():
            continue
        b = (c["top"] + (c["y1"] - c["matrix"][5])) * MM
        rows.append({"x0": (c["x0"] - ox) * MM, "x1": (c["x1"] - ox) * MM, "b": b, "t": c["text"]})
    return rows


def main(form):
    label = LABELS[form]
    tdir = ROOT / "templates" / form
    template = json.loads((tdir / "template.json").read_text())
    layout = json.loads((tdir / "layout.json").read_text())
    sample_pdf = ROOT / "out" / f"{label}_見本.pdf"
    layout_pdf = ROOT / "out" / f"{label}_位置確認.pdf"

    doc_s = pypdfium2.PdfDocument(str(sample_pdf))
    results = {"✓": [], "丸": [], "罫線の文": [], "1 行の文": []}
    PUNCT = set("・、。（）():：□〔〕［］")
    with pdfplumber.open(str(sample_pdf)) as ps, pdfplumber.open(str(layout_pdf)) as pl:
        for pi, slots in enumerate(template["schemas"]):
            if not slots:
                continue
            page = layout["pages"][pi]
            chars = [c for c in page["chars"] if c.get("ink")]
            hlines, vlines = page["hlines"], page["vlines"]
            # 見本の PDF で測る（印が少ないので、隣の印のインクが混ざりにくい）
            mask = blue_mask(doc_s[pi].render(scale=DPI / 72).to_pil())
            ox_s = ps.pages[pi].cropbox[0]
            ins_sample = inserted_lines(ps.pages[pi].crop(ps.pages[pi].cropbox, strict=False), ox_s)
            ins_layout = inserted_lines(pl.pages[pi].crop(pl.pages[pi].cropbox, strict=False), ox_s)
            for s in slots:
                x, y, w, h = s["position"]["x"], s["position"]["y"], s["width"], s["height"]
                inside = lambda c: x <= (c["ink"][0] + c["ink"][2]) / 2 <= x + w and y <= (c["ink"][1] + c["ink"][3]) / 2 <= y + h
                if s["type"] == "circleMark":
                    ink = bbox_mm(mask, x - 0.3, y - 0.3, x + w + 0.3, y + h + 0.3)
                    under = [c for c in chars if inside(c) and c["t"] not in PUNCT] or [c for c in chars if inside(c)]
                    # この欄の丸なら、インクの範囲は欄とほぼ同じ大きさになる（小さければ隣の丸の一部なので数えない）
                    if ink and (ink[2] - ink[0] < 0.8 * w or ink[3] - ink[1] < 0.8 * h):
                        ink = None
                    if ink and under:
                        ref = (min(c["ink"][0] for c in under), min(c["ink"][1] for c in under), max(c["ink"][2] for c in under), max(c["ink"][3] for c in under))
                        (ax, ay), (bx, by) = center(ink), center(ref)
                        results["丸"].append((s["name"], ax - bx, ay - by))
                    continue
                cx, cy = x + w / 2, y + h / 2
                boxes = [c for c in chars if c["t"] == "□" and x - 0.6 <= (c["ink"][0] + c["ink"][2]) / 2 <= x + w + 0.6 and y - 0.6 <= (c["ink"][1] + c["ink"][3]) / 2 <= y + h + 0.6]
                if boxes and w <= 6 and s.get("alignment") == "center" and abs(w - h) < 0.6:
                    box = min(boxes, key=lambda c: abs(center(c["ink"])[0] - cx) + abs(center(c["ink"])[1] - cy))
                    ink = bbox_mm(mask, x - 0.3, y - 0.3, x + w + 0.3, y + h + 0.3)
                    # ✓ のインクは字の大きさの 6 割ほど。それより小さければ隣の ✓ の一部なので数えない
                    em = s.get("fontSize", 10) * MM
                    if ink and (ink[2] - ink[0] < 0.5 * em or ink[3] - ink[1] < 0.5 * em):
                        ink = None
                    if ink:
                        (ax, ay), (bx, by) = center(ink), center(box["ink"])
                        results["✓"].append((s["name"], ax - bx, ay - by))
                    continue
                fs_mm = s.get("fontSize", 9) * MM
                # 罫線の枠: 欄の中に、幅の 6 割以上にわたる等間隔の横線が 2 本以上（scripts/align.mjs と同じ見分け方）
                if s.get("verticalAlignment") == "top":
                    ys = sorted({round(l[0], 1) for l in hlines if y + 0.6 * fs_mm < l[0] <= y + h + fs_mm and (min(l[2], x + w) - max(l[1], x)) >= 0.6 * w})
                    ys = [v for i, v in enumerate(ys) if i == 0 or v - ys[i - 1] > 1.0]
                    diffs = [b - a for a, b in zip(ys, ys[1:])]
                    if len(ys) >= 2 and all(abs(d - statistics.median(diffs)) <= 0.35 for d in diffs) and 1.4 * fs_mm <= statistics.median(diffs) <= 4 * fs_mm:
                        rows = [r for r in ins_sample if x - 0.5 <= r["x0"] <= x + w and y - 1 <= r["b"] <= y + h + 2]
                        for b in sorted({round(r["b"], 2) for r in rows}):
                            below = [l for l in ys if l > b - 0.2]
                            if below:
                                results["罫線の文"].append((s["name"], below[0] - b, 0))
                        continue
                if h > 2.4 * fs_mm:
                    continue  # 複数行の枠（罫線なし）は対象外
                # 1 行の欄: 同じマスの、欄の左右 5mm 以内にある書類の文字の基準線と比べる
                def same_cell(c):
                    xa, xb = (c["x1"], x + 0.3) if c["x1"] <= x + 0.6 else (x + w - 0.3, c["x0"])
                    lo, hi = min(xa, xb), max(xa, xb)
                    yy = c["b"] - 0.3 * c["s"]
                    return not any(lo + 0.15 < v[0] < hi - 0.15 and v[1] <= yy and v[2] >= yy - 0.5 for v in vlines)
                neigh = [c for c in page["chars"] if y + 0.15 * h <= c["b"] <= y + h + max(0.8, 0.25 * fs_mm) and ((x - 5 <= c["x1"] <= x + 0.6) or (x + w - 0.6 <= c["x0"] <= x + w + 5)) and same_cell(c)]
                if not neigh:
                    continue
                nb = min(neigh, key=lambda c: min(abs(c["x1"] - x), abs(c["x0"] - (x + w))))
                for ins in (ins_sample, ins_layout):
                    rows = [r for r in ins if x - 0.3 <= r["x0"] and r["x1"] <= x + w + 0.3 and y - 1 <= r["b"] <= y + h + 1]
                    bs = sorted({round(r["b"], 2) for r in rows})
                    if len(bs) == 1:
                        results["1 行の文"].append((s["name"], 0, bs[0] - nb["b"]))
                        break

    print(f"[{form}] {label} の印字のずれ（mm。正は右・下）")
    for k, v in results.items():
        if not v:
            print(f"  {k}: 対象なし")
            continue
        if k == "罫線の文":
            gaps = [d for _, d, _ in v]
            print(f"  {k}: {len(v)} 行。罫線との間 最小 {min(gaps):.2f} / 中央 {statistics.median(gaps):.2f} / 最大 {max(gaps):.2f}")
            per = {}
            for n, d, _ in v:
                per.setdefault(n, []).append(d)
            for n, ds in per.items():
                print(f"      {n}: {min(ds):.2f}〜{max(ds):.2f}")
            continue
        mags = [max(abs(dx), abs(dy)) for _, dx, dy in v]
        print(f"  {k}: {len(v)} 個。ずれの大きさ 中央 {statistics.median(mags):.2f} / 最大 {max(mags):.2f}。0.3mm を超える {sum(m > 0.3 for m in mags)} 個")
        for n, dx, dy in sorted(v, key=lambda t: -max(abs(t[1]), abs(t[2])))[:6]:
            print(f"      {n}: 横 {dx:+.2f} 縦 {dy:+.2f}")


if __name__ == "__main__":
    main(sys.argv[1])
