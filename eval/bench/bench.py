"""アセスメントのベンチマーク。

AI が原本（会話の記録など）から事実を取り出し（2 層目）、アセスメントシート（3 層目）を書いた結果を、
人が作った正解と比べて採点する。評価の考え方は eval/scenario/README.md の「確かめ方」。

使い方（説明は eval/bench/README.md）:
  python3 eval/bench/bench.py check-gold --gold eval/scenario/gold
  python3 eval/bench/bench.py show-gold  --gold eval/scenario/gold
  python3 eval/bench/bench.py score      --gold eval/scenario/gold --submission <提出のフォルダ>
"""
import argparse
import json
import os
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import judge as judge_mod  # noqa: E402

TEXTY = {"text", "longtext"}
SHOULD = ["正しい", "根拠違い", "一部抜け", "抜け", "誤り", "作り話", "要判定"]   # 書くべき欄の判定
EMPTY = ["空で正しい", "余分", "作り話", "要判定"]                              # 空のはずの欄の判定


class GoldError(Exception):
    """正解のファイルの書き間違い。"""


def is_empty(v):
    return v is None or v == "" or v == [] or v == {}


def _norm_text(s):
    """全角・半角の違いと空白を無視して比べるための形。"""
    return "".join(unicodedata.normalize("NFKC", str(s)).split())


def same(utype, a, b):
    """2 つの値が同じか。複数選択は順番を問わない。真偽は 0/1 と混同しない。"""
    if is_empty(a) or is_empty(b):
        return is_empty(a) and is_empty(b)
    if utype == "multi":
        return isinstance(a, list) and isinstance(b, list) and {_norm_text(x) for x in a} == {_norm_text(x) for x in b}
    if utype == "bool":
        return isinstance(a, bool) and isinstance(b, bool) and a is b
    if utype == "number":
        try:
            return not isinstance(a, bool) and not isinstance(b, bool) and float(a) == float(b)
        except (TypeError, ValueError):
            return False
    return _norm_text(a) == _norm_text(b)


# ================================================================ 欄の定義

class Unit:
    """採点の単位。ふつうの欄は 1 つ、まとまり（object）の欄は中の項目ごとに 1 つ。"""

    def __init__(self, key, sub, utype, choices, label, item23):
        self.key, self.sub, self.type, self.choices, self.label, self.item23 = key, sub, utype, choices, label, item23

    @property
    def id(self):
        return self.key if self.sub is None else f"{self.key}/{self.sub}"


class ListField:
    """繰り返しの欄（家族の一覧など）。行の中の項目は subs。"""

    def __init__(self, key, label, item23, subs):
        self.key, self.label, self.item23, self.subs = key, label, item23, subs   # subs: [Unit(sub=項目)]

    def sub(self, name):
        return next((s for s in self.subs if s.sub == name), None)


class Fields:
    def __init__(self, raw, form="assess"):
        self.raw = raw
        self.form = form
        cs = raw.get("choiceSets", {})
        types = raw.get("types", {})

        def choices(c):
            return cs[c] if isinstance(c, str) else c

        self._units, self._lists, self._defs = [], [], {}
        for f in raw["fields"]:
            if "key" not in f or form not in f.get("forms", {}):
                continue
            t = f["type"]
            if t == "image":
                continue
            self._defs[f["key"]] = f
            if t == "object":
                subs = f.get("fields") or types[f["of"]]["fields"]
                for s in subs:
                    self._units.append(Unit(f["key"], s["key"], s["type"], choices(s.get("choices")),
                                            f"{f['label']}／{s.get('label', s['key'])}", f.get("item23")))
            elif t == "list":
                subs = [Unit(f["key"], s["key"], s["type"], choices(s.get("choices")),
                             f"{f['label']}／{s.get('label', s['key'])}", f.get("item23")) for s in f["fields"]]
                self._lists.append(ListField(f["key"], f["label"], f.get("item23"), subs))
            else:
                self._units.append(Unit(f["key"], None, t, choices(f.get("choices")), f["label"], f.get("item23")))
        self._by_id = {u.id: u for u in self._units}
        self._list_by_key = {lf.key: lf for lf in self._lists}

    def units(self):
        return list(self._units)

    def list_fields(self):
        return list(self._lists)

    def unit(self, uid):
        return self._by_id.get(uid)

    def list_field(self, key):
        return self._list_by_key.get(key)

    def definition(self, key):
        return self._defs.get(key)

    def required_keys(self):
        keys = []
        for k in self.raw.get("required", {}).get(self.form, {}).get("keys", []):
            keys.extend(k if isinstance(k, list) else [k])
        return keys


# ================================================================ 原本（1 層目）

class Genpon:
    def __init__(self, raw):
        self.raw = raw
        self.people = raw.get("people", {})
        self.visits = [v["id"] for v in raw["visits"]]
        self.titles = {v["id"]: v.get("title", v["id"]) for v in raw["visits"]}
        self.entries = {}   # 発言・記録の id → {visit, index, who, text}
        self.order = []
        for vi, v in enumerate(raw["visits"]):
            for s in v["scenes"]:
                for e in s["entries"]:
                    self.entries[e["id"]] = {"visit": v["id"], "index": vi,
                                             "who": e.get("speaker") or s.get("by"), "text": e["text"]}
                    self.order.append(e["id"])

    def index(self, visit):
        return self.visits.index(visit)

    def first_index(self, ids):
        return min(self.entries[i]["index"] for i in ids)

    def all_known_by(self, ids, t):
        """ids がすべて、時点 t までの原本にあるか。"""
        ti = self.index(t)
        return all(i in self.entries and self.entries[i]["index"] <= ti for i in ids)

    def sources(self, ids):
        s = set(ids)
        return [{"id": i, "who": self.entries[i]["who"], "text": self.entries[i]["text"]}
                for i in self.order if i in s]

    def after_label(self, t):
        return f"{self.index(t) + 1} 回目のあと"


# ================================================================ 正解

class Gold:
    """正解の 3 つのファイル（sheet / facts / questions）。読み込むときに書き間違いを確かめる。"""

    def __init__(self, sheet, facts, questions, fields, genpon):
        self.fields, self.genpon = fields, genpon
        self.facts = {}
        for f in facts.get("facts", []):
            self._check_from(f.get("from"), f"事実 {f.get('id')}", required=True)
            if f["id"] in self.facts:
                raise GoldError(f"事実の id が重複: {f['id']}")
            self.facts[f["id"]] = f
        self.questions = questions.get("questions", [])
        for q in self.questions:
            self._check_from(q.get("from"), f"確かめること {q.get('id')}", required=True)
            for fid in q.get("closedBy", []):
                if fid not in self.facts:
                    raise GoldError(f"確かめること {q['id']} の closedBy にない事実: {fid}")
        self.units = []   # {"unit": Unit, "spec": ..., "at": set, "facts": [...], "note": ...}
        self.lists = []   # {"field": ListField, "items": [...], "facts": [...]}
        for i, e in enumerate(sheet.get("entries", [])):
            where = f"sheet.json の {i + 1} 番目（{e.get('key')}）"
            if "items" in e:
                self._add_list(e, where)
            else:
                self._add_unit(e, where)
        self._check_duplicates()

    # ------------------------------------------------------------ 確かめ

    def _check_from(self, ids, where, required=False):
        if not ids:
            if required:
                raise GoldError(f"{where}: from がない")
            return
        for i in ids:
            if i not in self.genpon.entries:
                raise GoldError(f"{where}: 原本にない id {i}")

    def _check_value(self, unit, v, where):
        t, ch = unit.type, unit.choices
        ok = {
            "enum": lambda: isinstance(v, str) and (ch is None or v in ch),
            "multi": lambda: isinstance(v, list) and all(isinstance(x, str) and (ch is None or x in ch) for x in v),
            "bool": lambda: isinstance(v, bool),
            "number": lambda: isinstance(v, (int, float)) and not isinstance(v, bool),
        }.get(t, lambda: isinstance(v, str))()
        if not ok:
            raise GoldError(f"{where}: {unit.id} に入らない値 {v!r}（型 {t}、選択肢 {ch}）")

    def _spec(self, unit, e, where):
        kinds = [k for k in ("expect", "anyOf", "points") if k in e]
        if len(kinds) != 1:
            raise GoldError(f"{where}: expect・anyOf・points のどれか 1 つを書く")
        # 「空でもよい」は使わない。話に出たことは書く、出ていないことは書かない（entries に入れない）
        if "allowEmpty" in e or None in e.get("anyOf", []) or ("expect" in e and e["expect"] is None):
            raise GoldError(f"{where}: 「空でもよい」は使わない。話に出ていないなら entries から外す")
        if "points" in e:
            if unit.type not in TEXTY:
                raise GoldError(f"{where}: points は文字の欄だけ（{unit.id} は {unit.type}）")
            pts = []
            for p in e["points"]:
                self._check_from(p.get("from"), where)
                pts.append({"text": p["text"], "from": list(p.get("from", []))})
            return {"points": pts}
        vals = [e["expect"]] if "expect" in e else list(e["anyOf"])
        for v in vals:
            if v is not None:
                self._check_value(unit, v, where)
        return {"anyOf": vals}

    def _facts_of(self, e, where, src, item23):
        """この正解の元になる事実。書いていなければ、from が重なり 23 項目の番号が同じ事実。"""
        if "facts" not in e:
            return [fid for fid, f in self.facts.items() if set(f["from"]) & set(src) and f.get("item23") == item23]
        for fid in e["facts"]:
            if fid not in self.facts:
                raise GoldError(f"{where}: facts.json にない事実 {fid}")
        return list(e["facts"])

    def _at(self, e, src, where):
        if "at" in e:
            for t in e["at"]:
                if t not in self.genpon.visits:
                    raise GoldError(f"{where}: 原本にない回 {t}")
            return set(e["at"])
        if not src:
            raise GoldError(f"{where}: from も at もない（いつからの正解か決まらない）")
        first = self.genpon.first_index(src)
        return {v for i, v in enumerate(self.genpon.visits) if i >= first}

    def _add_unit(self, e, where):
        uid = e["key"] if e.get("sub") is None else f"{e['key']}/{e['sub']}"
        unit = self.fields.unit(uid)
        if unit is None:
            raise GoldError(f"{where}: アセスメントの欄にない {uid}")
        spec = self._spec(unit, e, where)
        self._check_from(e.get("from"), where)
        src = list(e.get("from", [])) or [i for p in spec.get("points", []) for i in p["from"]]
        self.units.append({"unit": unit, "spec": spec, "from": src, "at": self._at(e, src, where),
                           "facts": self._facts_of(e, where, src, unit.item23), "note": e.get("note")})

    def _add_list(self, e, where):
        lf = self.fields.list_field(e["key"])
        if lf is None:
            raise GoldError(f"{where}: 繰り返しの欄にない {e['key']}")
        items = []
        for j, it in enumerate(e["items"]):
            w = f"{where} の {j + 1} 行目"
            self._check_from(it.get("from"), w)
            src = list(it.get("from", []))
            match = it.get("match") or {}
            if not match:
                raise GoldError(f"{w}: match（どの行かを決める項目）がない")
            subs = {}
            for name, v in match.items():
                su = lf.sub(name)
                if su is None:
                    raise GoldError(f"{w}: 行にない項目 {name}")
                self._check_value(su, v, w)
                subs[name] = {"anyOf": [v], "from": src, "rowKey": True}   # 行を決めた項目
            for name, se in (it.get("subs") or {}).items():
                su = lf.sub(name)
                if su is None:
                    raise GoldError(f"{w}: 行にない項目 {name}")
                spec = self._spec(su, se, w)
                self._check_from(se.get("from"), w)
                spec["from"] = list(se.get("from", [])) or [i for p in spec.get("points", []) for i in p["from"]] or src
                subs[name] = spec
            items.append({"match": match, "subs": subs, "from": src, "at": self._at(it, src, w), "note": it.get("note")})
        all_src = [i for it in items for i in it["from"]]
        self.lists.append({"field": lf, "items": items, "facts": self._facts_of(e, where, all_src, lf.item23)})

    def _check_duplicates(self):
        for t in self.genpon.visits:
            seen = set()
            for u in self.units:
                if t in u["at"]:
                    if u["unit"].id in seen:
                        raise GoldError(f"{t} の時点で、{u['unit'].id} の正解が 2 つある（at で分ける）")
                    seen.add(u["unit"].id)
            keys = [lst["field"].key for lst in self.lists]
            if len(keys) != len(set(keys)):
                raise GoldError("繰り返しの欄の正解が 2 つある（1 つの entry にまとめる）")

    # ------------------------------------------------------------ 時点ごとの正解

    def _points_at(self, spec, t):
        if "points" not in spec:
            return spec
        ti = self.genpon.index(t)
        pts = [p for p in spec["points"] if not p["from"] or self.genpon.first_index(p["from"]) <= ti]
        return dict(spec, points=pts)

    def unit_expectation(self, uid, t):
        for u in self.units:
            if u["unit"].id == uid and t in u["at"]:
                spec = self._points_at(u["spec"], t)
                if "points" in spec and not spec["points"]:
                    return None
                return dict(u, spec=spec)
        return None

    def list_expectation(self, key, t):
        for lst in self.lists:
            if lst["field"].key == key:
                items = [dict(it, subs={k: self._points_at(v, t) for k, v in it["subs"].items()})
                         for it in lst["items"] if t in it["at"]]
                return dict(lst, items=items) if items else None
        return None

    def fact_known(self, fid, t):
        return self.genpon.first_index(self.facts[fid]["from"]) <= self.genpon.index(t)

    def facts_at(self, t):
        return [f for f in self.facts.values() if self.fact_known(f["id"], t)]

    def questions_at(self, t):
        ti = self.genpon.index(t)
        return [q for q in self.questions if self.genpon.first_index(q["from"]) <= ti]


# ================================================================ 提出（AI の出力）

class Submission:
    """ある時点の提出。sheet = {"fields": {欄: {value, by, facts}}, "unplaced": [事実 id]}。採点に使うのは value と facts だけ。"""

    def __init__(self, sheet, facts, questions):
        self.values = sheet.get("fields", {})
        self.unplaced = set(sheet.get("unplaced", []))
        self.facts = {f["id"]: f for f in facts}
        self.questions = questions


# ================================================================ 採点

def score(fields, genpon, gold, sub, t, judge):
    fact_status, facts_summary = _score_facts(gold, sub, t, judge)
    units = []
    for u in fields.units():
        rec = sub.values.get(u.key) or {}
        val = rec.get("value")
        got = (val.get(u.sub) if isinstance(val, dict) else None) if u.sub else val
        units.append(_score_one(u.id, u.label, u.type, gold.unit_expectation(u.id, t), got, rec.get("facts"),
                                sub, genpon, t, judge))
    for lf in fields.list_fields():
        units.extend(_score_list(lf, gold.list_expectation(lf.key, t), sub.values.get(lf.key) or {},
                                 sub, genpon, t, judge))
    for u in units:
        if u["verdict"] in ("誤り", "抜け", "一部抜け"):
            u["cause"] = _cause(u.get("goldFacts", []), fact_status)
    summary = {"書くべき": {"数": 0, **{k: 0 for k in SHOULD}}, "空のはず": {"数": 0, **{k: 0 for k in EMPTY}}}
    for u in units:
        g = summary[u["group"]]
        g["数"] += 1
        g[u["verdict"]] += 1
    return {"at": t, "units": units, "summary": summary, "facts": facts_summary,
            "questions": _score_questions(gold, sub, t, judge)}


def _cited_sources(cited, sub, genpon, t):
    """根拠にした事実が指す原本の id。事実がない・まだ聞いていない回を指すときは None。"""
    if not cited:
        return None
    ids = set()
    for fid in cited:
        f = sub.facts.get(fid)
        if f is None or not f.get("from") or not genpon.all_known_by(f["from"], t):
            return None
        ids.update(f["from"])
    return ids


def _evidence_ok(spec_from, cited, sub, genpon, t):
    ids = _cited_sources(cited, sub, genpon, t)
    if ids is None:
        return False
    return not spec_from or bool(ids & set(spec_from))


def _result(uid, label, group, verdict, expected, got, **kw):
    return {"unit": uid, "label": label, "group": group, "verdict": verdict, "expected": expected, "got": got, **kw}


def _score_one(uid, label, utype, exp, got, cited, sub, genpon, t, judge, gold_facts=None):
    if exp is None:
        if is_empty(got):
            return _result(uid, label, "空のはず", "空で正しい", None, got, cited=cited)
        if utype not in TEXTY:
            return _result(uid, label, "空のはず", "作り話", None, got, cited=cited)
        # 文章なら、根拠にした発言に書いてあることだけなら「余分」、ないことがあれば「作り話」
        claims = judge.unsupported(label, str(got), genpon.sources(_cited_sources(cited, sub, genpon, t) or set()))
        if claims is judge_mod.PENDING:
            return _result(uid, label, "空のはず", "要判定", None, got, cited=cited)
        return _result(uid, label, "空のはず", "作り話" if claims else "余分", None, got, cited=cited,
                       detail={"unsupported": claims})
    spec = exp["spec"]
    spec_from = exp.get("from") or spec.get("from") or []
    facts = gold_facts if gold_facts is not None else exp.get("facts", [])
    base = dict(cited=cited, goldFacts=facts)
    if "points" in spec:
        pts = spec["points"]
        expected = [p["text"] for p in pts]
        if is_empty(got):
            return _result(uid, label, "書くべき", "抜け", expected, got, **base)
        pfrom = sorted({i for p in pts for i in p["from"]})
        known = _cited_sources(cited, sub, genpon, t) or set()
        covered = judge.points(label, str(got), pts)
        claims = judge.unsupported(label, str(got), genpon.sources(set(pfrom) | known))
        if covered is judge_mod.PENDING or claims is judge_mod.PENDING:
            return _result(uid, label, "書くべき", "要判定", expected, got, **base)
        detail = {"covered": covered, "unsupported": claims}
        if claims:
            verdict = "作り話"
        elif not any(covered):
            verdict = "抜け"
        elif not all(covered):
            verdict = "一部抜け"
        else:
            verdict = "正しい" if _evidence_ok(pfrom, cited, sub, genpon, t) else "根拠違い"
        return _result(uid, label, "書くべき", verdict, expected, got, detail=detail, **base)
    allowed = spec["anyOf"]
    expected = allowed[0] if len(allowed) == 1 else allowed
    if is_empty(got):
        verdict = "抜け"
    elif any(same(utype, got, v) for v in allowed):
        verdict = "正しい" if _evidence_ok(spec_from, cited, sub, genpon, t) else "根拠違い"
    else:
        verdict = "誤り"
    return _result(uid, label, "書くべき", verdict, expected, got, **base)


def _find_row(lf, it, rows, used, judge):
    """正解の行に当たる提出の行の番号。選ぶ項目は値の一致、文字の項目は一致しなければ判定役に聞く。"""
    match = it["match"]
    cands = [i for i, r in enumerate(rows) if i not in used and isinstance(r, dict)
             and all(same(lf.sub(k).type, r.get(k), v) for k, v in match.items() if lf.sub(k).type not in TEXTY)]
    for k, v in match.items():
        if lf.sub(k).type not in TEXTY:
            continue
        exact = [i for i in cands if same("text", rows[i].get(k), v)]
        if exact:
            cands = exact
            continue
        opts = [{"id": str(i), "text": str(rows[i].get(k))} for i in cands if not is_empty(rows[i].get(k))]
        if not opts:
            return None
        m = judge.match(f"{lf.label}の行（{k}）", v, opts)
        if m is judge_mod.PENDING or m is None:
            return m
        cands = [int(m)]
    return cands[0] if cands else None


def _score_list(lf, exp, rec, sub, genpon, t, judge):
    rows = rec.get("value") or []
    rows = rows if isinstance(rows, list) else []
    cited = rec.get("facts")
    used, out, pending = set(), [], False
    if exp is None and not rows:
        return [_result(lf.key, lf.label, "空のはず", "空で正しい", None, None)]
    for it in (exp["items"] if exp else []):
        name = lf.key + "[" + ",".join(f"{k}={v}" for k, v in it["match"].items()) + "]"
        idx = _find_row(lf, it, rows, used, judge)
        if idx is judge_mod.PENDING:
            pending = True
            for su in lf.subs:
                if su.sub in it["subs"]:
                    out.append(_result(f"{name}/{su.sub}", su.label, "書くべき", "要判定",
                                       it["subs"][su.sub].get("anyOf"), None, cited=cited, goldFacts=exp["facts"]))
            continue
        if idx is not None:
            used.add(idx)
        row = rows[idx] if idx is not None else {}
        for su in lf.subs:
            spec = it["subs"].get(su.sub)
            if idx is None and spec is None:
                continue   # 行がないので、空のはずの項目は数えない
            if idx is not None and spec is not None and spec.get("rowKey"):
                # 行を決めた項目は、行が見つかった時点で合っている（文字の項目は判定役が同じと判断した）
                ok = _evidence_ok(spec.get("from", it["from"]), cited, sub, genpon, t)
                out.append(_result(f"{name}/{su.sub}", su.label, "書くべき", "正しい" if ok else "根拠違い",
                                   spec["anyOf"][0], row.get(su.sub), cited=cited, goldFacts=exp["facts"]))
                continue
            e = None if spec is None else {"spec": spec, "from": spec.get("from", it["from"]), "facts": exp["facts"]}
            out.append(_score_one(f"{name}/{su.sub}", su.label, su.type, e, row.get(su.sub),
                                  cited, sub, genpon, t, judge))
    extra = 0
    for i, r in enumerate(rows):
        if i not in used:
            extra += 1
            out.append(_result(f"{lf.key}[+{extra}]", f"{lf.label}（正解にない行）", "空のはず",
                               "要判定" if pending else "作り話", None, r, cited=cited))
    return out


def _score_facts(gold, sub, t, judge):
    status = {}
    for g in gold.facts_at(t):
        cands = [f for f in sub.facts.values() if set(f.get("from", [])) & set(g["from"])]
        m = judge.match("事実", g["text"], cands) if cands else None
        if m is judge_mod.PENDING:
            status[g["id"]] = {"status": "要判定"}
        elif m is None:
            status[g["id"]] = {"status": "未抽出"}
        else:
            status[g["id"]] = {"status": "取り出せた", "match": m,
                               "item23ok": sub.facts[m].get("item23") == g.get("item23")}
    matched = {s["match"] for s in status.values() if "match" in s}
    referenced = set()
    for rec in sub.values.values():
        referenced.update((rec or {}).get("facts") or [])
    summary = {
        "正解の数": len(status),
        "取り出せた": sum(s["status"] == "取り出せた" for s in status.values()),
        "番号違い": sum(s.get("item23ok") is False for s in status.values()),
        "未抽出": sum(s["status"] == "未抽出" for s in status.values()),
        "要判定": sum(s["status"] == "要判定" for s in status.values()),
        "提出の数": len(sub.facts),
        "正解にない": len(set(sub.facts) - matched),
        "宙に浮いた": len(set(sub.facts) - referenced - sub.unplaced),
        "items": {gid: dict(s, text=gold.facts[gid]["text"]) for gid, s in status.items()},
    }
    return status, summary


def _cause(gold_facts, status):
    st = [status[g] for g in gold_facts if g in status]
    if not st:
        return None
    if any(s["status"] == "要判定" for s in st):
        return "要判定"
    if any(s["status"] == "未抽出" for s in st):
        return "取り出し"
    return "書く段階（番号違い）" if any(s.get("item23ok") is False for s in st) else "書く段階"


def _score_questions(gold, sub, t, judge):
    cands = [{"id": q["id"], "text": q["text"]} for q in sub.questions]
    by_id = {q["id"]: q for q in sub.questions}
    r = {"正解の数": 0, "見つけた": 0, "閉じるべき": 0, "閉じた": 0, "誤って閉じた": 0, "要判定": 0, "余分": 0, "items": []}
    matched = set()
    for q in gold.questions_at(t):
        r["正解の数"] += 1
        should_close = any(gold.fact_known(fid, t) for fid in q.get("closedBy", []))
        r["閉じるべき"] += should_close
        m = judge.match("確かめること", q["text"], cands) if cands else None
        item = {"id": q["id"], "text": q["text"], "shouldClose": should_close}
        if m is judge_mod.PENDING:
            r["要判定"] += 1
            item["status"] = "要判定"
        elif m is None:
            item["status"] = "見つからない"
        else:
            matched.add(m)
            r["見つけた"] += 1
            closed = by_id[m].get("status") == "closed"
            r["閉じた"] += should_close and closed
            r["誤って閉じた"] += (not should_close) and closed
            item.update(status="見つけた", match=m, closed=closed)
        r["items"].append(item)
    r["余分"] = len(set(by_id) - matched)
    return r


# ================================================================ 書き出し

def _cell(v, limit=80):
    if v is None:
        return "（空）"
    if isinstance(v, bool):
        return "はい" if v else "いいえ"
    s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
    s = s.replace("|", "｜").replace("\n", " ")
    return s if len(s) <= limit else s[:limit] + "…"


def render_report(results, genpon, meta):
    out = ["# ベンチマークの結果", "",
           f"- 正解: `{meta['gold']}`", f"- 提出: `{meta['submission']}`",
           f"- 判定: {meta['judge']}（判定待ち {meta['pending']} 件。`{meta['judgments']}` の answer が null のもの）", ""]
    for r in results:
        s, fa, q = r["summary"], r["facts"], r["questions"]
        out += [f"## {genpon.after_label(r['at'])}（{r['at']}）", "", "### シート（3 層目）", "",
                "| | 数 | " + " | ".join(SHOULD) + " |", "|---|" + "---|" * (len(SHOULD) + 1),
                "| 書くべき欄 | " + " | ".join(str(s["書くべき"][k]) for k in ["数"] + SHOULD) + " |", "",
                "| | 数 | " + " | ".join(EMPTY) + " |", "|---|" + "---|" * (len(EMPTY) + 1),
                "| 空のはずの欄 | " + " | ".join(str(s["空のはず"][k]) for k in ["数"] + EMPTY) + " |", ""]
        n = s["書くべき"]["数"]
        rate = f"{s['書くべき']['正しい'] / n:.0%}" if n else "—"
        out += [f"- 書くべき欄の正解率: {s['書くべき']['正しい']} / {n}（{rate}）",
                f"- 作り話: {s['書くべき']['作り話'] + s['空のはず']['作り話']} 件"
                f"（空のはずの欄 {s['空のはず']['作り話']}、書くべき欄の文章 {s['書くべき']['作り話']}）", "",
                "### 事実（2 層目）", "",
                "| 正解の事実 | 取り出せた | うち番号違い | 未抽出 | 判定待ち | 提出の事実 | 正解にない | 宙に浮いた |",
                "|---|---|---|---|---|---|---|---|",
                f"| {fa['正解の数']} | {fa['取り出せた']} | {fa['番号違い']} | {fa['未抽出']} | {fa['要判定']} | "
                f"{fa['提出の数']} | {fa['正解にない']} | {fa['宙に浮いた']} |", "",
                "- 宙に浮いた: シートのどこにも使われず、「入れる欄がない」（unplaced）とも示されていない事実", "",
                "### 確かめること", "",
                "| 正解 | 見つけた | 閉じるべき | 閉じた | 誤って閉じた | 判定待ち | 正解にないもの |",
                "|---|---|---|---|---|---|---|",
                f"| {q['正解の数']} | {q['見つけた']} | {q['閉じるべき']} | {q['閉じた']} | {q['誤って閉じた']} | "
                f"{q['要判定']} | {q['余分']} |", ""]
        sections = [
            ("作り話", ["欄", "書いた値", "根拠にない中身"],
             lambda u: [u["label"] + f" `{u['unit']}`", _cell(u["got"]),
                        _cell("／".join(u.get("detail", {}).get("unsupported", [])) or "—")]),
            ("誤り", ["欄", "正解", "書いた値", "どこで落ちたか"],
             lambda u: [u["label"] + f" `{u['unit']}`", _cell(u["expected"]), _cell(u["got"]), u.get("cause") or "—"]),
            ("抜け", ["欄", "正解", "書いた値", "どこで落ちたか"],
             lambda u: [u["label"] + f" `{u['unit']}`", _cell(u["expected"]), _cell(u["got"]), u.get("cause") or "—"]),
            ("一部抜け", ["欄", "正解の要点", "書いた値", "どこで落ちたか"],
             lambda u: [u["label"] + f" `{u['unit']}`",
                        _cell(["✓" + p if c else "✗" + p for p, c in zip(u["expected"], u["detail"]["covered"])]),
                        _cell(u["got"]), u.get("cause") or "—"]),
            ("根拠違い", ["欄", "書いた値", "根拠にした事実"],
             lambda u: [u["label"] + f" `{u['unit']}`", _cell(u["got"]), _cell(u.get("cited"))]),
            ("余分", ["欄", "書いた値"], lambda u: [u["label"] + f" `{u['unit']}`", _cell(u["got"])]),
            ("要判定", ["欄", "書いた値"], lambda u: [u["label"] + f" `{u['unit']}`", _cell(u["got"])]),
        ]
        out += ["### 間違いの一覧", ""]
        for verdict, head, row in sections:
            us = [u for u in r["units"] if u["verdict"] == verdict]
            if not us:
                continue
            out += [f"#### {verdict}（{len(us)}）", "", "| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
            out += ["| " + " | ".join(row(u)) + " |" for u in us]
            out.append("")
    return "\n".join(out) + "\n"


def _quote(genpon, ids, limit=60):
    parts = []
    for s in genpon.sources(ids):
        text = s["text"].replace("\n", " ").replace("|", "｜")
        parts.append(f"{s['id']} {s['who'] or ''}「{text[:limit]}{'…' if len(text) > limit else ''}」")
    return "<br>".join(parts) or "—"


def render_gold(gold, fields, genpon, t):
    """人が確かめるための正解シート（ある時点）。"""
    rows = []
    for u in fields.units():
        e = gold.unit_expectation(u.id, t)
        if e is None:
            continue
        spec = e["spec"]
        if "points" in spec:
            val = "<br>".join("・" + p["text"].replace("|", "｜") for p in spec["points"])
            src = sorted({i for p in spec["points"] for i in p["from"]})
        else:
            val = " または ".join(_cell(v) for v in spec["anyOf"])
            src = e["from"]
        note = f"<br>※{e['note']}" if e.get("note") else ""
        rows.append((u.item23, f"{u.label} `{u.id}`", val + note, _quote(genpon, src)))
    for lf in fields.list_fields():
        e = gold.list_expectation(lf.key, t)
        for it in (e["items"] if e else []):
            name = ",".join(f"{k}={v}" for k, v in it["match"].items())
            for sub_name, spec in it["subs"].items():
                if "points" in spec:
                    val = "<br>".join("・" + p["text"] for p in spec["points"])
                else:
                    val = " または ".join(_cell(v) for v in spec["anyOf"])
                rows.append((lf.item23, f"{lf.sub(sub_name).label}（{name}） `{lf.key}`", val,
                             _quote(genpon, spec.get("from") or it["from"])))
    rows.sort(key=lambda r: (r[0] is None, r[0] or 0))
    expected_keys = {u["unit"].key for u in gold.units if t in u["at"]} | \
                    {lst["field"].key for lst in gold.lists if gold.list_expectation(lst["field"].key, t)}
    empty_required = [k for k in fields.required_keys() if k not in expected_keys]
    out = [f"# 正解シート（{genpon.after_label(t)}・{t}）", "",
           "`sheet.json` などから `bench.py show-gold` で作った、確かめるための表。直すときは JSON の方を直す。", "",
           f"## 書くべき欄（{len(rows)}）", "", "| 23 項目 | 欄 | 正解 | 根拠 |", "|---|---|---|---|"]
    out += [f"| {r[0] if r[0] is not None else '—'} | {r[1]} | {r[2]} | {r[3]} |" for r in rows]
    out += ["", f"## 必須の欄のうち、この時点では空のままが正しいもの（{len(empty_required)}）", ""]
    for k in empty_required:
        d = fields.definition(k)
        out.append(f"- {d['label'] if d else k} `{k}`")
    qs = gold.questions_at(t)
    out += ["", f"## 確かめること（{len(qs)}）", "", "| id | 23 項目 | 確かめること | 種類 | この時点 | きっかけ |",
            "|---|---|---|---|---|---|"]
    for q in qs:
        closed = any(gold.fact_known(fid, t) for fid in q.get("closedBy", []))
        kind = {"later": "あとで確かめると言われた", "guess": "推測（言われていない）"}.get(q.get("why"), q.get("why"))
        out.append(f"| {q['id']} | {q.get('item23')} | {q['text']} | {kind} | {'閉じた' if closed else 'まだ'} | "
                   f"{_quote(genpon, q['from'], 40)} |")
    fs = gold.facts_at(t)
    out += ["", f"## 正解の事実（{len(fs)}）", "", "| id | 23 項目 | 誰 | 事実 | いつのことか | 元 |", "|---|---|---|---|---|---|"]
    for f in sorted(fs, key=lambda f: (f.get("item23") or 99, f["id"])):
        out.append(f"| {f['id']} | {f.get('item23')} | {f.get('who') or '—'} | {f['text']} | {f.get('when') or '—'} | "
                   f"{', '.join(f['from'])} |")
    return "\n".join(out) + "\n"


# ================================================================ 用紙に印字するデータ

def _sentences(points, longtext):
    s = "。".join(p["text"].rstrip("。") for p in points)
    return s + "。" if longtext and s else s


def _print_value(spec, utype):
    if "points" in spec:
        return _sentences(spec["points"], utype == "longtext")
    return spec["anyOf"][0]


def gold_data(fields, gold, genpon, t):
    """時点 t の正解のシートを、用紙に印字するデータ（fields.json の key → 値）にする。

    anyOf は最初の値を使う。文章の欄は要点を文につなぐ。
    アセスメント実施日（初回）は話から取り出すものではなくシステムが持つ情報なので、原本の最初の回の日付を入れる。
    """
    data = {}
    first = genpon.raw["visits"][0].get("date")
    if first:
        data["assessment.initialDate"] = first
    for u in fields.units():
        e = gold.unit_expectation(u.id, t)
        if e is None:
            continue
        v = _print_value(e["spec"], u.type)
        if u.sub:
            data.setdefault(u.key, {})[u.sub] = v
        else:
            data[u.key] = v
    for lf in fields.list_fields():
        e = gold.list_expectation(lf.key, t)
        if not e:
            continue
        rows = []
        for it in e["items"]:
            rows.append({name: _print_value(spec, lf.sub(name).type) for name, spec in it["subs"].items()
                         if not ("points" in spec and not spec["points"])})
        data[lf.key] = rows
    return data


# ================================================================ コマンド

def _load(path, default=None):
    if not os.path.exists(path):
        if default is not None:
            return default
        raise FileNotFoundError(path)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _load_all(args):
    fields = Fields(_load(args.fields))
    genpon = Genpon(_load(args.genpon or os.path.join(args.gold, "..", "原本.json")))
    gold = Gold(sheet=_load(os.path.join(args.gold, "sheet.json")),
                facts=_load(os.path.join(args.gold, "facts.json")),
                questions=_load(os.path.join(args.gold, "questions.json"), {"questions": []}),
                fields=fields, genpon=genpon)
    return fields, genpon, gold


def main(argv=None):
    p = argparse.ArgumentParser(prog="bench.py", description="アセスメントのベンチマーク")
    sp = p.add_subparsers(dest="cmd", required=True)
    for name in ("score", "check-gold", "show-gold", "gold-data"):
        c = sp.add_parser(name)
        c.add_argument("--gold", required=True, help="正解のフォルダ（sheet.json, facts.json, questions.json）")
        c.add_argument("--fields", default=os.path.join(HERE, "..", "..", "core", "fields.json"))
        c.add_argument("--genpon", help="原本.json（既定は正解のフォルダの 1 つ上）")
        if name == "score":
            c.add_argument("--submission", required=True, help="提出のフォルダ（v1/, v2/ …）")
            c.add_argument("--at", nargs="*", help="採点する時点（既定はすべて）")
            c.add_argument("--out", help="結果の置き場（既定は 提出/bench）")
            c.add_argument("--judge", choices=["cache", "anthropic"], default="cache",
                           help="cache: 外に送らない（既定）。anthropic: Claude に判定させる")
            c.add_argument("--judgments", help="判定のファイル（既定は正解のフォルダの 1 つ上の judgments.json）")
        if name in ("show-gold", "gold-data"):
            c.add_argument("--out", help="置き場（既定は正解のフォルダ）")
    args = p.parse_args(argv)
    try:
        fields, genpon, gold = _load_all(args)
    except GoldError as e:
        print(f"正解のファイルに間違い: {e}", file=sys.stderr)
        return 1

    if args.cmd == "check-gold":
        for t in genpon.visits:
            n_units = sum(1 for u in fields.units() if gold.unit_expectation(u.id, t))
            n_lists = sum(len(e["items"]) for lf in fields.list_fields() if (e := gold.list_expectation(lf.key, t)))
            print(f"{t}: 書くべき欄 {n_units}、繰り返しの欄の行 {n_lists}、事実 {len(gold.facts_at(t))}、"
                  f"確かめること {len(gold.questions_at(t))}")
        print("正解のファイルに間違いは見つからなかった")
        return 0

    if args.cmd == "show-gold":
        out = args.out or args.gold
        for t in genpon.visits:
            with open(os.path.join(out, f"正解シート_{t}.md"), "w", encoding="utf-8") as f:
                f.write(render_gold(gold, fields, genpon, t))
        print(f"{out} に 正解シート_*.md を書いた")
        return 0

    if args.cmd == "gold-data":
        out = args.out or args.gold
        os.makedirs(out, exist_ok=True)
        for t in genpon.visits:
            data = {"_comment": f"正解のシート（{genpon.after_label(t)}）を用紙に印字する形にしたもの。"
                                "bench.py gold-data で作る。直すときは sheet.json を直す。anyOf は最初の値"}
            data.update(gold_data(fields, gold, genpon, t))
            with open(os.path.join(out, f"アセスメント_{t}.json"), "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=1)
        print(f"{out} に アセスメント_*.json を書いた")
        return 0

    jpath = args.judgments or os.path.normpath(os.path.join(args.gold, "..", "judgments.json"))
    backend = judge_mod.AnthropicBackend() if args.judge == "anthropic" else None
    jd = judge_mod.CachedJudge(jpath, backend)
    results = []
    for t in args.at or genpon.visits:
        d = os.path.join(args.submission, t)
        sub = Submission(sheet=_load(os.path.join(d, "sheet.json"), {"fields": {}}),
                         facts=_load(os.path.join(d, "facts.json"), {"facts": []})["facts"],
                         questions=_load(os.path.join(d, "questions.json"), {"questions": []})["questions"])
        results.append(score(fields, genpon, gold, sub, t, jd))
    jd.save()
    out = args.out or os.path.join(args.submission, "bench")
    os.makedirs(out, exist_ok=True)
    meta = {"gold": args.gold, "submission": args.submission, "judge": args.judge, "judgments": jpath,
            "pending": jd.pending_count()}
    with open(os.path.join(out, "result.json"), "w", encoding="utf-8") as f:
        json.dump({**meta, "results": results}, f, ensure_ascii=False, indent=1)
    with open(os.path.join(out, "report.md"), "w", encoding="utf-8") as f:
        f.write(render_report(results, genpon, meta))
    for r in results:
        s = r["summary"]
        print(f"{r['at']}: 書くべき欄 {s['書くべき']['正しい']}/{s['書くべき']['数']} 正しい、"
              f"作り話 {s['書くべき']['作り話'] + s['空のはず']['作り話']}、判定待ち {s['書くべき']['要判定']}")
    print(f"結果: {os.path.join(out, 'report.md')}（判定待ち {jd.pending_count()} 件: {jpath}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
