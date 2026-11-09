"""ベンチマーク（bench.py / judge.py）のテスト。

実行: python3 -m unittest discover -s eval/bench -v
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bench  # noqa: E402
import judge as judge_mod  # noqa: E402

# ---------------------------------------------------------------- 小さな見本

FIELDS_RAW = {
    "choiceSets": {"同別居": ["同居", "別居"]},
    "types": {
        "HasDetail": {"fields": [{"key": "has", "type": "bool"}, {"key": "detail", "type": "text"}]},
    },
    "fields": [
        {"group": "見出し"},
        {"key": "meal.chewing", "label": "咀嚼の状況", "type": "enum",
         "choices": ["問題なし", "噛みにくい"], "item23": 19, "forms": {"assess": "p.6"}},
        {"key": "survey.1_1", "label": "麻痺", "type": "multi",
         "choices": ["ない", "左上肢", "左下肢"], "item23": 11, "forms": {"assess": "p.5"}},
        {"key": "cert.careLevel", "label": "要介護度", "type": "enum",
         "choices": ["要介護1", "要介護2"], "item23": 8, "forms": {"assess": "p.1"}},
        {"key": "housing.renovation", "label": "住宅改修の必要", "type": "bool",
         "item23": 22, "forms": {"assess": "p.3"}},
        {"key": "speech", "label": "言語障害", "type": "object", "of": "HasDetail",
         "item23": 14, "forms": {"assess": "p.5"}},
        {"key": "notes.meal", "label": "食事の特記", "type": "longtext",
         "item23": 19, "forms": {"assess": "p.6"}},
        {"key": "family.members", "label": "家族", "type": "list", "item23": 21,
         "forms": {"assess": "p.2"},
         "fields": [{"key": "relationship", "type": "enum", "choices": ["子", "子の配偶者"]},
                    {"key": "livingTogether", "type": "enum", "choices": "同別居"}]},
        {"key": "health.visits", "label": "受診状況", "type": "list", "item23": 10,
         "forms": {"assess": "p.4"},
         "fields": [{"key": "disease", "type": "text"}, {"key": "medication", "type": "bool"}]},
        {"key": "floorPlan", "label": "見取図", "type": "image", "item23": 22, "forms": {"assess": "p.3"}},
        {"key": "cp.only", "label": "第1表だけ", "type": "text", "item23": None, "forms": {"cp1": "x"}},
    ],
}

GENPON_RAW = {
    "people": {"ST": {"role": "専門職"}, "PT": {"role": "専門職"}, "OT": {"role": "専門職"},
               "春子": {"role": "家族"}, "加藤": {"role": "ケアマネ"}},
    "visits": [
        {"id": "v1", "date": "2021-01-21", "scenes": [
            {"id": "s2", "kind": "会話", "entries": [
                {"id": "s2-001", "kind": "発言", "speaker": "ST", "text": "咀嚼、嚥下については大きな問題は見られません。"},
                {"id": "s2-002", "kind": "発言", "speaker": "PT", "text": "左上下肢に軽度の麻痺が残存しています。"},
                {"id": "s2-003", "kind": "発言", "speaker": "春子", "text": "家では私が3食作ります。"},
                {"id": "s2-004", "kind": "発言", "speaker": "OT", "text": "段差は家屋調査の時に確認させていただきます。"},
                {"id": "s2-005", "kind": "発言", "speaker": "ST", "text": "言葉が出にくいが、意思疎通は問題ない。"},
            ]},
        ]},
        {"id": "v2", "date": "2021-01-25", "scenes": [
            {"id": "s3", "kind": "観察", "by": "加藤", "entries": [
                {"id": "s3-001", "kind": "観察", "text": "手すりや段差解消などの住宅改修は必要ない。"},
            ]},
        ]},
    ],
}

GOLD_FACTS = {"facts": [
    {"id": "g-1", "text": "咀嚼に大きな問題はない", "item23": 19, "who": "ST", "kind": "said", "from": ["s2-001"]},
    {"id": "g-2", "text": "左上下肢に軽度の麻痺", "item23": 11, "who": "PT", "kind": "said", "from": ["s2-002"]},
    {"id": "g-3", "text": "退院後は嫁が3食作る", "item23": 21, "who": "春子", "kind": "said", "from": ["s2-003"]},
    {"id": "g-4", "text": "住宅改修は必要ない", "item23": 22, "who": "加藤", "kind": "seen", "from": ["s3-001"]},
    {"id": "g-5", "text": "言葉が出にくい", "item23": 14, "who": "ST", "kind": "said", "from": ["s2-005"]},
]}

GOLD_SHEET = {"entries": [
    {"key": "meal.chewing", "expect": "問題なし", "from": ["s2-001"], "facts": ["g-1"]},
    {"key": "survey.1_1", "expect": ["左上肢", "左下肢"], "from": ["s2-002"], "facts": ["g-2"]},
    {"key": "housing.renovation", "expect": False, "from": ["s3-001"], "facts": ["g-4"]},
    {"key": "speech", "sub": "has", "expect": True, "from": ["s2-005"], "facts": ["g-5"]},
    {"key": "speech", "sub": "detail", "points": [{"text": "言葉が出にくい", "from": ["s2-005"]}], "facts": ["g-5"]},
    {"key": "notes.meal", "points": [
        {"text": "咀嚼に問題はない", "from": ["s2-001"]},
        {"text": "嫁が3食作る", "from": ["s2-003"]},
    ], "facts": ["g-1", "g-3"]},
    {"key": "family.members", "facts": ["g-3"], "items": [
        {"match": {"relationship": "子の配偶者"}, "from": ["s2-003"],
         "subs": {"livingTogether": {"expect": "同居"}}},
    ]},
]}

GOLD_QUESTIONS = {"questions": [
    {"id": "gq-1", "text": "自宅の段差", "item23": 22, "why": "later", "from": ["s2-004"], "closedBy": ["g-4"]},
]}

# 提出（AI の出力）の事実。正解と同じ中身のものは同じ文にしておく（FakeJudge が文の一致で照合するため）
SUB_FACTS = [
    {"id": "f-1", "text": "咀嚼に大きな問題はない", "item23": 19, "from": ["s2-001"]},
    {"id": "f-2", "text": "左上下肢に軽度の麻痺", "item23": 11, "from": ["s2-002"]},
    {"id": "f-3", "text": "退院後は嫁が3食作る", "item23": 21, "from": ["s2-003"]},
    {"id": "f-5", "text": "言葉が出にくい", "item23": 14, "from": ["s2-005"]},
]


class FakeJudge:
    """決まった規則で答える判定役。points は部分一致、unsupported は「【嘘】」を含む文、match は文の一致。"""

    def __init__(self, pending=False):
        self.pending = pending

    def points(self, label, text, points):
        if self.pending:
            return judge_mod.PENDING
        return [p["text"] in text for p in points]

    def unsupported(self, label, text, sources):
        if self.pending:
            return judge_mod.PENDING
        return [s for s in text.split("。") if "【嘘】" in s]

    def match(self, what, target, candidates):
        if self.pending:
            return judge_mod.PENDING
        for c in candidates:
            if c["text"] == target:
                return c["id"]
        return None


def dump(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


F = bench.Fields(FIELDS_RAW)
G = bench.Genpon(GENPON_RAW)


def make_gold(sheet=None, facts=None, questions=None):
    return bench.Gold(sheet=sheet or GOLD_SHEET, facts=facts or GOLD_FACTS,
                      questions=questions or GOLD_QUESTIONS, fields=F, genpon=G)


def run(fields_value, t="v1", facts=None, questions=None, unplaced=None, judge=None, gold=None):
    sub = bench.Submission(sheet={"fields": fields_value, "unplaced": unplaced or []},
                           facts=SUB_FACTS if facts is None else facts,
                           questions=questions or [])
    return bench.score(F, G, gold or make_gold(), sub, t, judge or FakeJudge())


def verdict(result, unit_id):
    for u in result["units"]:
        if u["unit"] == unit_id:
            return u["verdict"]
    raise AssertionError(f"{unit_id} がない: {[u['unit'] for u in result['units']]}")


def unit(result, unit_id):
    return next(u for u in result["units"] if u["unit"] == unit_id)


# ---------------------------------------------------------------- シート（3 層目）

class TestUnits(unittest.TestCase):
    def test_units_are_leaves_of_assessment_fields_without_images(self):
        ids = [u.id for u in F.units()]
        self.assertIn("meal.chewing", ids)
        self.assertIn("speech/has", ids)
        self.assertIn("speech/detail", ids)
        self.assertNotIn("floorPlan", ids)      # 図は採点しない
        self.assertNotIn("cp.only", ids)        # アセスメント以外の様式の欄
        self.assertIn("family.members", [lf.key for lf in F.list_fields()])


class TestSheet(unittest.TestCase):
    def test_unlisted_unit_empty_is_correct_and_filled_is_fabrication(self):
        r = run({})
        self.assertEqual(verdict(r, "cert.careLevel"), "空で正しい")
        r = run({"cert.careLevel": {"value": "要介護2", "facts": ["f-1"]}})
        self.assertEqual(verdict(r, "cert.careLevel"), "作り話")

    def test_enum_correct_with_matching_evidence(self):
        r = run({"meal.chewing": {"value": "問題なし", "facts": ["f-1"]}})
        self.assertEqual(verdict(r, "meal.chewing"), "正しい")

    def test_correct_value_without_matching_evidence_is_evidence_mismatch(self):
        r = run({"meal.chewing": {"value": "問題なし", "facts": ["f-2"]}})
        self.assertEqual(verdict(r, "meal.chewing"), "根拠違い")
        r = run({"meal.chewing": {"value": "問題なし"}})
        self.assertEqual(verdict(r, "meal.chewing"), "根拠違い")

    def test_wrong_value_is_error_and_empty_is_missing(self):
        r = run({"meal.chewing": {"value": "噛みにくい", "facts": ["f-1"]}})
        self.assertEqual(verdict(r, "meal.chewing"), "誤り")
        r = run({})
        self.assertEqual(verdict(r, "meal.chewing"), "抜け")

    def test_any_of_allows_several_values_but_empty_is_still_missing(self):
        sheet = {"entries": [{"key": "meal.chewing", "anyOf": ["問題なし", "噛みにくい"], "from": ["s2-001"]}]}
        gold = make_gold(sheet=sheet)
        r = run({"meal.chewing": {"value": "噛みにくい", "facts": ["f-1"]}}, gold=gold)
        self.assertEqual(verdict(r, "meal.chewing"), "正しい")
        self.assertEqual(verdict(run({}, gold=gold), "meal.chewing"), "抜け")

    def test_multi_is_order_insensitive(self):
        r = run({"survey.1_1": {"value": ["左下肢", "左上肢"], "facts": ["f-2"]}})
        self.assertEqual(verdict(r, "survey.1_1"), "正しい")
        r = run({"survey.1_1": {"value": ["左上肢"], "facts": ["f-2"]}})
        self.assertEqual(verdict(r, "survey.1_1"), "誤り")

    def test_entry_from_later_visit_applies_only_from_that_visit(self):
        self.assertEqual(verdict(run({}, t="v1"), "housing.renovation"), "空で正しい")
        self.assertEqual(verdict(run({}, t="v2"), "housing.renovation"), "抜け")

    def test_citing_a_later_visit_is_evidence_mismatch(self):
        facts = SUB_FACTS + [{"id": "f-9", "text": "咀嚼に大きな問題はない", "item23": 19, "from": ["s2-001", "s3-001"]}]
        r = run({"meal.chewing": {"value": "問題なし", "facts": ["f-9"]}}, facts=facts)
        self.assertEqual(verdict(r, "meal.chewing"), "根拠違い")

    def test_bool_false_is_a_value_not_empty(self):
        r = run({"housing.renovation": {"value": False, "facts": ["f-1"]}}, t="v1")
        self.assertEqual(verdict(r, "housing.renovation"), "作り話")

    def test_object_sub_fields_are_scored_separately(self):
        r = run({"speech": {"value": {"has": True, "detail": "言葉が出にくい"}, "facts": ["f-5"]}})
        self.assertEqual(verdict(r, "speech/has"), "正しい")
        self.assertEqual(verdict(r, "speech/detail"), "正しい")

    def test_text_points(self):
        both = "咀嚼に問題はない。嫁が3食作る。"
        r = run({"notes.meal": {"value": both, "facts": ["f-1", "f-3"]}})
        self.assertEqual(verdict(r, "notes.meal"), "正しい")
        r = run({"notes.meal": {"value": "咀嚼に問題はない。", "facts": ["f-1"]}})
        self.assertEqual(verdict(r, "notes.meal"), "一部抜け")
        r = run({"notes.meal": {"value": "むせがひどい。", "facts": ["f-1"]}})
        self.assertEqual(verdict(r, "notes.meal"), "抜け")
        r = run({"notes.meal": {"value": both + "【嘘】毎晩飲酒している。", "facts": ["f-1", "f-3"]}})
        self.assertEqual(verdict(r, "notes.meal"), "作り話")
        self.assertEqual(len(unit(r, "notes.meal")["detail"]["unsupported"]), 1)

    def test_text_points_are_limited_to_the_time_point(self):
        sheet = {"entries": [{"key": "notes.meal", "points": [
            {"text": "咀嚼に問題はない", "from": ["s2-001"]},
            {"text": "住宅改修はいらない", "from": ["s3-001"]},
        ]}]}
        r = run({"notes.meal": {"value": "咀嚼に問題はない。", "facts": ["f-1"]}}, gold=make_gold(sheet=sheet))
        self.assertEqual(verdict(r, "notes.meal"), "正しい")

    def test_pending_judgment(self):
        r = run({"notes.meal": {"value": "咀嚼に問題はない。", "facts": ["f-1"]}}, judge=FakeJudge(pending=True))
        self.assertEqual(verdict(r, "notes.meal"), "要判定")

    def test_list_items_matched_missing_and_extra(self):
        ok = {"family.members": {"value": [{"relationship": "子の配偶者", "livingTogether": "同居"}], "facts": ["f-3"]}}
        r = run(ok)
        self.assertEqual(verdict(r, "family.members[relationship=子の配偶者]/livingTogether"), "正しい")
        self.assertEqual(verdict(r, "family.members[relationship=子の配偶者]/relationship"), "正しい")
        r = run({})
        self.assertEqual(verdict(r, "family.members[relationship=子の配偶者]/livingTogether"), "抜け")
        extra = {"family.members": {"value": [{"relationship": "子の配偶者", "livingTogether": "同居"},
                                              {"relationship": "子", "livingTogether": "別居"}], "facts": ["f-3"]}}
        r = run(extra)
        self.assertEqual(verdict(r, "family.members[+1]"), "作り話")


class TestSheetMore(unittest.TestCase):
    def test_full_width_and_half_width_are_the_same(self):
        sheet = {"entries": [{"key": "speech", "sub": "detail", "anyOf": ["Ｃリハビリテーション病院"], "from": ["s2-005"]}]}
        r = run({"speech": {"value": {"detail": "Cリハビリテーション病院"}, "facts": ["f-5"]}}, gold=make_gold(sheet=sheet))
        self.assertEqual(verdict(r, "speech/detail"), "正しい")

    def test_supported_text_in_an_unlisted_field_is_extra_not_fabrication(self):
        gold = make_gold(sheet={"entries": [{"key": "meal.chewing", "expect": "問題なし", "from": ["s2-001"]}]})
        r = run({"notes.meal": {"value": "咀嚼に問題はない。", "facts": ["f-1"]}}, gold=gold)
        self.assertEqual(verdict(r, "notes.meal"), "余分")
        self.assertEqual(unit(r, "notes.meal")["group"], "空のはず")
        r = run({"notes.meal": {"value": "【嘘】毎晩飲酒している。", "facts": ["f-1"]}}, gold=gold)
        self.assertEqual(verdict(r, "notes.meal"), "作り話")


    def test_list_rows_matched_by_a_text_key_use_the_judge(self):
        sheet = {"entries": [{"key": "health.visits", "items": [
            {"match": {"disease": "高血圧"}, "from": ["s2-001"], "subs": {"medication": {"expect": True}}}]}]}
        gold = make_gold(sheet=sheet)
        rows = {"health.visits": {"value": [{"disease": "高血圧", "medication": True}], "facts": ["f-1"]}}
        r = run(rows, gold=gold)
        self.assertEqual(verdict(r, "health.visits[disease=高血圧]/medication"), "正しい")
        # 文字が同じなら判定役に聞かない。違うときだけ聞く（ここでは判定待ち）
        rows2 = {"health.visits": {"value": [{"disease": "高血圧症", "medication": True}], "facts": ["f-1"]}}
        r = run(rows2, gold=gold, judge=FakeJudge(pending=True))
        self.assertEqual(verdict(r, "health.visits[disease=高血圧]/medication"), "要判定")
        self.assertNotIn("作り話", [u["verdict"] for u in r["units"] if u["unit"].startswith("health.visits")])

    def test_row_key_judged_same_counts_as_correct(self):
        class SameRowJudge(FakeJudge):
            def match(self, what, target, candidates):
                return candidates[0]["id"] if candidates else None
        sheet = {"entries": [{"key": "health.visits", "items": [
            {"match": {"disease": "高血圧"}, "from": ["s2-001"], "subs": {"medication": {"expect": True}}}]}]}
        rows = {"health.visits": {"value": [{"disease": "高血圧症", "medication": True}], "facts": ["f-1"]}}
        r = run(rows, gold=make_gold(sheet=sheet), judge=SameRowJudge())
        self.assertEqual(verdict(r, "health.visits[disease=高血圧]/disease"), "正しい")
        self.assertEqual(verdict(r, "health.visits[disease=高血圧]/medication"), "正しい")

    def test_default_gold_facts_are_same_source_and_same_item23(self):
        gold = make_gold(sheet={"entries": [{"key": "meal.chewing", "expect": "問題なし", "from": ["s2-001"]}]})
        facts = [f for f in SUB_FACTS if f["id"] != "f-1"]
        r = run({}, facts=facts, gold=gold)
        self.assertEqual(unit(r, "meal.chewing")["cause"], "取り出し")


class TestSummary(unittest.TestCase):
    def test_summary_splits_should_write_and_should_be_empty(self):
        r = run({"meal.chewing": {"value": "問題なし", "facts": ["f-1"]},
                 "cert.careLevel": {"value": "要介護2", "facts": ["f-1"]}})
        s = r["summary"]
        self.assertEqual(s["書くべき"]["正しい"], 1)
        self.assertEqual(s["空のはず"]["作り話"], 1)
        self.assertGreater(s["空のはず"]["空で正しい"], 0)
        total_should = sum(v for k, v in s["書くべき"].items() if k != "数")
        self.assertEqual(total_should, s["書くべき"]["数"])


# ---------------------------------------------------------------- 事実（2 層目）

class TestFacts(unittest.TestCase):
    def test_missing_fact_makes_the_cause_extraction(self):
        facts = [f for f in SUB_FACTS if f["id"] != "f-1"]
        r = run({}, facts=facts)
        self.assertEqual(r["facts"]["取り出せた"], 3)
        self.assertEqual(unit(r, "meal.chewing")["cause"], "取り出し")

    def test_present_fact_makes_the_cause_writing(self):
        r = run({})
        self.assertEqual(unit(r, "meal.chewing")["cause"], "書く段階")

    def test_wrong_item23_is_counted(self):
        facts = [dict(f, item23=10) if f["id"] == "f-1" else f for f in SUB_FACTS]
        r = run({}, facts=facts)
        self.assertEqual(r["facts"]["番号違い"], 1)
        self.assertIn("番号違い", unit(r, "meal.chewing")["cause"])

    def test_floating_fact_is_neither_used_nor_marked_unplaced(self):
        r = run({"meal.chewing": {"value": "問題なし", "facts": ["f-1"]}}, unplaced=["f-2"])
        self.assertEqual(r["facts"]["宙に浮いた"], 2)   # f-3, f-5


# ---------------------------------------------------------------- 確かめること

class TestQuestions(unittest.TestCase):
    def test_later_question_open_at_v1_and_closed_at_v2(self):
        q = [{"id": "q-1", "text": "自宅の段差", "item23": 22, "status": "open"}]
        r = run({}, questions=q, t="v1")
        self.assertEqual(r["questions"]["見つけた"], 1)
        self.assertEqual(r["questions"]["閉じるべき"], 0)
        q2 = [{"id": "q-1", "text": "自宅の段差", "item23": 22, "status": "closed"}]
        r = run({}, questions=q2, t="v2")
        self.assertEqual(r["questions"]["閉じるべき"], 1)
        self.assertEqual(r["questions"]["閉じた"], 1)


# ---------------------------------------------------------------- 正解の確かめ

class TestGoldValidation(unittest.TestCase):
    def check_raises(self, entry):
        with self.assertRaises(bench.GoldError):
            make_gold(sheet={"entries": [entry]})

    def test_unknown_key(self):
        self.check_raises({"key": "nope", "expect": "x", "from": ["s2-001"]})

    def test_choice_not_in_list(self):
        self.check_raises({"key": "meal.chewing", "expect": "かたい", "from": ["s2-001"]})

    def test_unknown_source_id(self):
        self.check_raises({"key": "meal.chewing", "expect": "問題なし", "from": ["s9-999"]})

    def test_unknown_fact_id(self):
        self.check_raises({"key": "meal.chewing", "expect": "問題なし", "from": ["s2-001"], "facts": ["g-99"]})

    def test_empty_is_not_an_allowed_answer(self):
        # 「空でもよい」は使わない。話に出たことは書く、出ていないことは書かない（entries に入れない）
        self.check_raises({"key": "meal.chewing", "anyOf": ["問題なし", None], "from": ["s2-001"]})
        self.check_raises({"key": "notes.meal", "allowEmpty": True,
                           "points": [{"text": "咀嚼に問題はない", "from": ["s2-001"]}]})

    def test_duplicate_unit_at_same_time(self):
        with self.assertRaises(bench.GoldError):
            make_gold(sheet={"entries": [
                {"key": "meal.chewing", "expect": "問題なし", "from": ["s2-001"]},
                {"key": "meal.chewing", "expect": "噛みにくい", "from": ["s2-001"]},
            ]})


# ---------------------------------------------------------------- 判定のキャッシュ

class TestCachedJudge(unittest.TestCase):
    def test_missing_answer_is_pending_and_written_with_null_then_used_when_filled(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "judgments.json")
            j = judge_mod.CachedJudge(path)
            pts = [{"text": "咀嚼に問題はない"}]
            self.assertIs(j.points("食事の特記", "咀嚼OK", pts), judge_mod.PENDING)
            j.save()
            data = json.loads(read(path))
            (key, entry), = data.items()
            self.assertIsNone(entry["answer"])
            entry["answer"] = {"covered": [True]}
            dump(path, data)
            j2 = judge_mod.CachedJudge(path)
            self.assertEqual(j2.points("食事の特記", "咀嚼OK", pts), [True])


# ---------------------------------------------------------------- ファイルから通しで

class TestGoldData(unittest.TestCase):
    """正解のシートを、用紙に印字するデータ（fields.json の key と値）に変える。"""

    def test_values_follow_the_time_point(self):
        d1 = bench.gold_data(F, make_gold(), G, "v1")
        self.assertEqual(d1["meal.chewing"], "問題なし")
        self.assertEqual(d1["survey.1_1"], ["左上肢", "左下肢"])
        self.assertNotIn("housing.renovation", d1)          # 2 回目から分かること
        self.assertIs(bench.gold_data(F, make_gold(), G, "v2")["housing.renovation"], False)

    def test_object_sub_fields_are_nested(self):
        d = bench.gold_data(F, make_gold(), G, "v1")
        self.assertEqual(d["speech"], {"has": True, "detail": "言葉が出にくい"})

    def test_longtext_points_become_sentences(self):
        d = bench.gold_data(F, make_gold(), G, "v1")
        self.assertEqual(d["notes.meal"], "咀嚼に問題はない。嫁が3食作る。")

    def test_points_are_limited_to_the_time_point(self):
        sheet = {"entries": [{"key": "notes.meal", "points": [
            {"text": "咀嚼に問題はない。", "from": ["s2-001"]},
            {"text": "住宅改修はいらない", "from": ["s3-001"]}]}]}
        self.assertEqual(bench.gold_data(F, make_gold(sheet=sheet), G, "v1")["notes.meal"], "咀嚼に問題はない。")
        self.assertEqual(bench.gold_data(F, make_gold(sheet=sheet), G, "v2")["notes.meal"],
                         "咀嚼に問題はない。住宅改修はいらない。")

    def test_one_line_text_points_are_joined_without_last_period(self):
        sheet = {"entries": [{"key": "speech", "sub": "detail", "points": [
            {"text": "言葉が出にくい", "from": ["s2-005"]}, {"text": "ろれつが回りにくい", "from": ["s2-005"]}]}]}
        d = bench.gold_data(F, make_gold(sheet=sheet), G, "v1")
        self.assertEqual(d["speech"], {"detail": "言葉が出にくい。ろれつが回りにくい"})

    def test_any_of_takes_the_first_value(self):
        sheet = {"entries": [{"key": "meal.chewing", "anyOf": ["噛みにくい", "問題なし"], "from": ["s2-001"]}]}
        self.assertEqual(bench.gold_data(F, make_gold(sheet=sheet), G, "v1")["meal.chewing"], "噛みにくい")

    def test_list_rows_merge_match_and_subs(self):
        d = bench.gold_data(F, make_gold(), G, "v1")
        self.assertEqual(d["family.members"], [{"relationship": "子の配偶者", "livingTogether": "同居"}])

    def test_assessment_date_is_the_first_visit(self):
        # 実施日は話から取り出すものではなく、システムが持つ（fields.json の source が setting）
        self.assertEqual(bench.gold_data(F, make_gold(), G, "v2")["assessment.initialDate"], "2021-01-21")

    def test_command_writes_one_file_per_time_point(self):
        with tempfile.TemporaryDirectory() as d:
            dump(os.path.join(d, "fields.json"), FIELDS_RAW)
            dump(os.path.join(d, "原本.json"), GENPON_RAW)
            dump(os.path.join(d, "gold", "sheet.json"), GOLD_SHEET)
            dump(os.path.join(d, "gold", "facts.json"), GOLD_FACTS)
            dump(os.path.join(d, "gold", "questions.json"), GOLD_QUESTIONS)
            out = os.path.join(d, "out")
            code = bench.main(["gold-data", "--gold", os.path.join(d, "gold"),
                               "--fields", os.path.join(d, "fields.json"), "--out", out])
            self.assertEqual(code, 0)
            v2 = json.loads(read(os.path.join(out, "アセスメント_v2.json")))
            self.assertIs(v2["housing.renovation"], False)
            self.assertNotIn("housing.renovation", json.loads(read(os.path.join(out, "アセスメント_v1.json"))))


class TestEndToEnd(unittest.TestCase):
    def test_score_command_writes_report_and_result(self):
        with tempfile.TemporaryDirectory() as d:
            dump(os.path.join(d, "fields.json"), FIELDS_RAW)
            dump(os.path.join(d, "原本.json"), GENPON_RAW)
            dump(os.path.join(d, "gold", "sheet.json"), GOLD_SHEET)
            dump(os.path.join(d, "gold", "facts.json"), GOLD_FACTS)
            dump(os.path.join(d, "gold", "questions.json"), GOLD_QUESTIONS)
            for t in ("v1", "v2"):
                dump(os.path.join(d, "sub", t, "sheet.json"),
                     {"fields": {"meal.chewing": {"value": "問題なし", "facts": ["f-1"]}}, "unplaced": []})
                dump(os.path.join(d, "sub", t, "facts.json"), {"facts": SUB_FACTS})
                dump(os.path.join(d, "sub", t, "questions.json"), {"questions": []})
            code = bench.main(["score", "--gold", os.path.join(d, "gold"), "--submission", os.path.join(d, "sub"),
                               "--fields", os.path.join(d, "fields.json")])
            self.assertEqual(code, 0)
            out = os.path.join(d, "sub", "bench")
            report = read(os.path.join(out, "report.md"))
            self.assertIn("1 回目のあと", report)
            self.assertIn("書くべき欄", report)
            result = json.loads(read(os.path.join(out, "result.json")))
            self.assertEqual([r["at"] for r in result["results"]], ["v1", "v2"])
            # 判定していない文章の欄は、判定のファイルに answer: null で出る
            self.assertTrue(os.path.exists(os.path.join(d, "judgments.json")))

    def test_show_gold_writes_review_sheets(self):
        with tempfile.TemporaryDirectory() as d:
            dump(os.path.join(d, "fields.json"), FIELDS_RAW)
            dump(os.path.join(d, "原本.json"), GENPON_RAW)
            dump(os.path.join(d, "gold", "sheet.json"), GOLD_SHEET)
            dump(os.path.join(d, "gold", "facts.json"), GOLD_FACTS)
            dump(os.path.join(d, "gold", "questions.json"), GOLD_QUESTIONS)
            code = bench.main(["show-gold", "--gold", os.path.join(d, "gold"),
                               "--fields", os.path.join(d, "fields.json")])
            self.assertEqual(code, 0)
            v2 = read(os.path.join(d, "gold", "正解シート_v2.md"))
            self.assertIn("咀嚼の状況", v2)
            self.assertIn("住宅改修の必要", v2)
            self.assertIn("手すりや段差解消", v2)   # 根拠の発言を引用する
            v1 = read(os.path.join(d, "gold", "正解シート_v1.md"))
            self.assertNotIn("housing.renovation", v1)   # 2 回目からの欄は 1 回目の表に出ない


if __name__ == "__main__":
    unittest.main()
