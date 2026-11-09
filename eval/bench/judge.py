"""意味の判定（文章に要点が書かれているか、根拠にない中身がないか、同じ事実か）。

判定はファイル（judgments.json）に貯め、同じ問いには同じ答えを使い回す。
- 既定（backend なし）: 外のサービスに何も送らない。答えのない問いは answer: null でファイルに書き出し、
  「要判定」として扱う。人（または Claude Code）が answer を書き込めば、次の実行から使われる。
- AnthropicBackend: Claude に判定させる（--judge anthropic のときだけ）。公開・架空のデータにだけ使う。
"""
import hashlib
import json
import os


class _Pending:
    def __repr__(self):
        return "PENDING"


PENDING = _Pending()   # 「まだ判定していない」を表す印


def _key(task):
    raw = json.dumps(task, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


class CachedJudge:
    def __init__(self, path, backend=None):
        self.path = path
        self.backend = backend
        self.data = {}
        if path and os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                self.data = json.load(f)

    # ------------------------------------------------------------ 3 種類の問い

    def points(self, label, text, points):
        """文章に、各要点が書かれているか。→ [bool, ...]"""
        task = {"kind": "points", "label": label, "text": text, "points": [p["text"] for p in points]}
        ans = self._ask(task, lambda a: isinstance(a.get("covered"), list) and len(a["covered"]) == len(points))
        return ans if ans is PENDING else [bool(x) for x in ans["covered"]]

    def unsupported(self, label, text, sources):
        """文章のうち、根拠（原本の発言・記録）にない中身。→ [str, ...]"""
        task = {"kind": "unsupported", "label": label, "text": text,
                "sources": [{"id": s["id"], "who": s.get("who"), "text": s["text"]} for s in sources]}
        ans = self._ask(task, lambda a: isinstance(a.get("claims"), list))
        return ans if ans is PENDING else [str(c) for c in ans["claims"]]

    def match(self, what, target, candidates):
        """候補のうち、target と同じことを述べているもの。→ id / None"""
        cands = sorted(({"id": c["id"], "text": c["text"]} for c in candidates), key=lambda c: c["id"])
        ids = {c["id"] for c in cands}
        task = {"kind": "match", "what": what, "target": target, "candidates": cands}
        ans = self._ask(task, lambda a: "match" in a and (a["match"] is None or a["match"] in ids))
        return ans if ans is PENDING else ans["match"]

    # ------------------------------------------------------------ 貯める・聞く

    def _ask(self, task, valid):
        k = _key(task)
        entry = self.data.get(k)
        if entry and entry.get("answer") is not None and valid(entry["answer"]):
            return entry["answer"]
        if self.backend is not None:
            ans = self.backend.answer(task)
            if ans is not None and valid(ans):
                self.data[k] = {"task": task, "answer": ans, "by": self.backend.name}
                return ans
        if k not in self.data:
            self.data[k] = {"task": task, "answer": None, "by": None}
        return PENDING

    def pending_count(self):
        return sum(1 for e in self.data.values() if e.get("answer") is None)

    def save(self):
        if not self.path:
            return
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False, indent=1, sort_keys=True)
            f.write("\n")


# ---------------------------------------------------------------- Claude に判定させる

SYSTEM = (
    "あなたは、ケアマネジャーが書いたアセスメントシートを採点する係です。"
    "与えられた材料だけを使って判定し、材料にない知識で補わないでください。"
)


def build_prompt(task):
    """問いごとの指示と、答えの形（JSON Schema）を返す。"""
    kind = task["kind"]
    if kind == "points":
        pts = "\n".join(f"{i + 1}. {p}" for i, p in enumerate(task["points"]))
        user = (
            f"欄「{task['label']}」に書かれた文章:\n<text>\n{task['text']}\n</text>\n\n"
            f"次の要点が、それぞれこの文章に書かれているかを判定してください。"
            f"言い回しが違っても意味が同じなら書かれているとみなします。"
            f"一部しか書かれていない、または意味が違う場合は書かれていないとします。\n{pts}\n\n"
            f"covered には要点と同じ順に {len(task['points'])} 個の true/false を入れてください。"
        )
        schema = {"type": "object", "properties": {"covered": {"type": "array", "items": {"type": "boolean"}}},
                  "required": ["covered"], "additionalProperties": False}
    elif kind == "unsupported":
        src = "\n".join(f"[{s['id']}] {s.get('who') or ''}: {s['text']}" for s in task["sources"])
        user = (
            f"欄「{task['label']}」に書かれた文章:\n<text>\n{task['text']}\n</text>\n\n"
            f"根拠になる発言・記録:\n<sources>\n{src}\n</sources>\n\n"
            "文章のうち、根拠に書かれていない中身（言っていないこと、推測、誇張、根拠と食い違うこと）を、"
            "文章の言葉のまま 1 つずつ claims に入れてください。根拠の言い換えや要約は含めません。"
            "なければ空の配列にしてください。"
        )
        schema = {"type": "object", "properties": {"claims": {"type": "array", "items": {"type": "string"}}},
                  "required": ["claims"], "additionalProperties": False}
    elif kind == "match":
        cands = "\n".join(f"[{c['id']}] {c['text']}" for c in task["candidates"])
        user = (
            f"次の{task['what']}と同じことを述べているものを、候補から 1 つ選んでください。\n"
            f"<target>\n{task['target']}\n</target>\n\n候補:\n<candidates>\n{cands}\n</candidates>\n\n"
            "同じものがなければ「なし」を選んでください。一部だけ重なるものは、target の中心になることが"
            "書かれていれば同じとみなします。"
        )
        ids = [c["id"] for c in task["candidates"]] + ["なし"]
        schema = {"type": "object", "properties": {"match": {"type": "string", "enum": ids}},
                  "required": ["match"], "additionalProperties": False}
    else:
        raise ValueError(kind)
    return user, schema


class AnthropicBackend:
    """Claude による判定。`pip install anthropic` と認証（ANTHROPIC_API_KEY か `ant auth login`）が要る。"""

    def __init__(self, model=None):
        import anthropic  # 使うときだけ読み込む

        self.client = anthropic.Anthropic()
        self.model = model or os.environ.get("BENCH_JUDGE_MODEL", "claude-opus-5-5")
        self.name = f"anthropic:{self.model}"

    def answer(self, task):
        user, schema = build_prompt(task)
        resp = self.client.beta.messages.create(
            model=self.model,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",   # 安全のための拒否が起きたら、サーバー側で別のモデルに回す
            system=SYSTEM,
            messages=[{"role": "user", "content": user}],
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": schema}},
        )
        if resp.stop_reason == "refusal":
            return None
        text = next((b.text for b in resp.content if b.type == "text"), None)
        if text is None:
            return None
        ans = json.loads(text)
        if task["kind"] == "match" and ans.get("match") == "なし":
            ans["match"] = None
        return ans
