"""fields.json を確かめて、チームが読む表（欄の一覧.md）を作る。

使い方: python3 design/make_table.py
"""
import collections
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
SRC = HERE / "fields.json"
OUT = HERE / "欄の一覧.md"

TYPE_LABEL = {
    "text": "文字", "longtext": "文章", "date": "日付", "number": "数", "bool": "はい・いいえ",
    "enum": "1 つ選ぶ", "multi": "いくつか選ぶ", "image": "図", "object": "まとまり", "list": "繰り返し",
}
FORM_ORDER = ["assess", "cp1", "cp2", "cp3", "adm"]


def check(d):
    errors = []
    item_nos = {i["no"] for i in d["item23"]}
    choice_sets = d["choiceSets"]
    types = d["types"]
    sources = d["sources"]
    seen = set()

    def check_field(f, where, top):
        k = f.get("key")
        if not k:
            errors.append(f"{where}: key がない")
            return
        if f.get("type") not in TYPE_LABEL:
            errors.append(f"{where}.{k}: type が不明 {f.get('type')}")
        ch = f.get("choices")
        if isinstance(ch, str) and ch not in choice_sets:
            errors.append(f"{where}.{k}: choices の参照先がない {ch}")
        if f.get("type") in ("enum", "multi") and not ch:
            errors.append(f"{where}.{k}: 選択肢がない")
        if "of" in f and f["of"] not in types:
            errors.append(f"{where}.{k}: of の参照先がない {f['of']}")
        if top:
            if "item23" not in f:
                errors.append(f"{k}: item23 がない（どれにも当たらないなら null）")
            elif f["item23"] is not None and f["item23"] not in item_nos:
                errors.append(f"{k}: item23 が 1〜23 でない {f['item23']}")
            for s in f.get("source", []):
                if s not in sources:
                    errors.append(f"{k}: source が不明 {s}")
            if not f.get("source"):
                errors.append(f"{k}: source がない")
            for fk in f.get("forms", {}):
                if fk not in d["forms"]:
                    errors.append(f"{k}: forms のキーが不明 {fk}")
        for sub in f.get("fields", []):
            check_field(sub, f"{where}.{k}", False)

    for f in d["fields"]:
        if "group" in f:
            continue
        if f.get("key") in seen:
            errors.append(f"key が重複 {f['key']}")
        seen.add(f.get("key"))
        check_field(f, "fields", True)
    for name, t in types.items():
        for sub in t["fields"]:
            check_field(sub, f"types.{name}", False)

    # 必須の欄（required）: 欄があり、その様式の欄で、重複がないこと
    by_key = {f["key"]: f for f in d["fields"] if "key" in f}
    for form, req in d.get("required", {}).items():
        if form not in d["forms"]:
            errors.append(f"required: 様式が不明 {form}")
            continue
        seen_req = set()
        for kk in required_keys(d, form):
            f = by_key.get(kk)
            if f is None:
                errors.append(f"required.{form}: 欄がない {kk}")
            elif form not in f.get("forms", {}):
                errors.append(f"required.{form}: {kk} はこの様式の欄ではない")
            if kk in seen_req:
                errors.append(f"required.{form}: 重複 {kk}")
            seen_req.add(kk)
    return errors


def required_keys(d, form):
    """必須の欄の key を並び順のまま返す。配列（どれか 1 つでよい組）はばらして返す。"""
    out = []
    for k in d.get("required", {}).get(form, {}).get("keys", []):
        out.extend(k if isinstance(k, list) else [k])
    return out


def choices_text(f, choice_sets):
    ch = f.get("choices")
    if ch is None:
        return ""
    if isinstance(ch, str):
        return f"〔{ch}〕"
    s = "・".join(ch)
    return s if len(s) <= 60 else s[:60] + "…"


def type_text(f, d):
    t = TYPE_LABEL.get(f["type"], f["type"])
    if "of" in f:
        return f"{t}（{d['types'][f['of']]['label']}）"
    if f.get("fields"):
        return f"{t}（{'、'.join(s['label'] for s in f['fields'])}）"
    return t


def esc(s):
    return str(s).replace("|", "／").replace("\n", " ")


def main():
    d = json.loads(SRC.read_text(encoding="utf-8"))
    errors = check(d)
    if errors:
        print("fields.json に問題があります:")
        for e in errors:
            print("  -", e)
        sys.exit(1)

    fields = [f for f in d["fields"] if "group" not in f]
    items = {i["no"]: i["name"] for i in d["item23"]}
    lines = []
    lines.append("# 欄の一覧（自動生成）")
    lines.append("")
    lines.append("`design/fields.json` から `design/make_table.py` で作った表。**この表は直接直さない**。直すときは fields.json を直してから作り直す。")
    lines.append("説明は [`データの定義.md`](データの定義.md)。")
    lines.append("")

    # 集計
    lines.append("## 数")
    lines.append("")
    lines.append(f"- 欄（いちばん上の段）: {len(fields)}")
    per_form = collections.Counter(fk for f in fields for fk in f.get("forms", {}))
    lines.append("- 様式ごとの欄の数: " + "、".join(f"{d['forms'][k]['name'].split('（')[0]} {per_form[k]}" for k in FORM_ORDER))
    shared = [f for f in fields if len(f.get("forms", {})) >= 2]
    lines.append(f"- 2 つ以上の様式で使い回す欄: {len(shared)}")
    req_assess = set(required_keys(d, "assess"))
    lines.append(f"- アセスメントの必須の欄: {len(req_assess)}")
    lines.append("")

    # 必須の欄
    req = d.get("required", {}).get("assess")
    if req:
        by_key = {f["key"]: f for f in fields}
        lines.append("## アセスメントの必須の欄")
        lines.append("")
        lines.append(f"{req['decided']} に決めた。決め方: {req['rule']}。")
        lines.append(f"{req['note']}。")
        lines.append("")
        lines.append("| 欄 | key | 23 項目 | 用紙の場所 |")
        lines.append("|---|---|---|---|")
        for k in req["keys"]:
            ks = k if isinstance(k, list) else [k]
            fs = [by_key[x] for x in ks]
            label = " または ".join(esc(f["label"]) for f in fs)
            keytxt = " または ".join(f"`{x}`" for x in ks)
            item = "—" if fs[0]["item23"] is None else str(fs[0]["item23"])
            loc = "<br>".join(esc(f["forms"]["assess"]) for f in fs)
            lines.append(f"| {label} | {keytxt} | {item} | {loc} |")
        lines.append("")

    # 23 項目ごとの数
    lines.append("## 23 項目ごとの欄の数")
    lines.append("")
    lines.append("| No. | 項目 | 欄の数 |")
    lines.append("|---|---|---|")
    cnt = collections.Counter(f["item23"] for f in fields)
    for no, name in items.items():
        lines.append(f"| {no} | {name} | {cnt.get(no, 0)} |")
    lines.append(f"| — | どれにも当たらない | {cnt.get(None, 0)} |")
    lines.append("")

    # 使い回す欄
    lines.append("## 様式をまたいで使い回す欄")
    lines.append("")
    lines.append("| 欄 | key | " + " | ".join(FORM_ORDER) + " |")
    lines.append("|---|---|" + "---|" * len(FORM_ORDER))
    for f in shared:
        cells = [esc(f["forms"].get(k, "")) for k in FORM_ORDER]
        lines.append(f"| {esc(f['label'])} | `{f['key']}` | " + " | ".join(cells) + " |")
    lines.append("")
    lines.append("様式の略称: " + "、".join(f"`{k}` = {v['name']}" for k, v in d["forms"].items()))
    lines.append("")

    # 全部
    lines.append("## すべての欄")
    lines.append("")
    group = None
    for f in d["fields"]:
        if "group" in f:
            group = f["group"]
            lines.append(f"### {group}")
            lines.append("")
            lines.append("| 欄 | key | 型 | 選択肢 | 23 項目 | アセスメントで必須 | 出どころ | 様式 | メモ |")
            lines.append("|---|---|---|---|---|---|---|---|---|")
            continue
        item = "—" if f["item23"] is None else str(f["item23"])
        forms = "<br>".join(f"{k}: {esc(v)}" for k, v in f.get("forms", {}).items()) or "（様式に欄なし）"
        src = "・".join(f["source"])
        must = "●" if f["key"] in req_assess else ""
        lines.append(
            f"| {esc(f['label'])} | `{f['key']}` | {esc(type_text(f, d))} | {esc(choices_text(f, d['choiceSets']))} | {item} | {must} | {src} | {forms} | {esc(f.get('note', ''))} |"
        )
    lines.append("")

    lines.append("## 選択肢の組（choiceSets）")
    lines.append("")
    for k, v in d["choiceSets"].items():
        lines.append(f"- **{k}**: {'・'.join(v)}")
    lines.append("")
    lines.append("## 出どころの意味（sources）")
    lines.append("")
    for k, v in d["sources"].items():
        lines.append(f"- `{k}`: {v}")
    lines.append("")

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"OK: 欄 {len(fields)}、使い回し {len(shared)}、書き出し {OUT.name}")
    print("様式ごと:", dict(per_form))
    print("23項目ごと:", {k: cnt[k] for k in sorted(cnt, key=lambda x: (x is None, x or 0))})


if __name__ == "__main__":
    main()
