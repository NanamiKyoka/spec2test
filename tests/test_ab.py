"""A/B 修复增益脚本的事件解析与差值计算。"""
import json

import ab_repair


def _lines(*events):
    return [json.dumps(e, ensure_ascii=False) for e in events]


def test_parse_events_reads_score_and_calls():
    row = ab_repair.parse_events(_lines(
        {"stage": "candidates", "status": "ok", "detail": {"candidates": ["SIB19"]}},
        {"stage": "generate", "status": "ok", "detail": {"calls": 2, "repairs": 0}},
        {"stage": "repair", "status": "ok", "detail": {"round": 1, "before": 2, "after": 0}},
        {"stage": "score", "status": "ok",
         "detail": {"L1": 1.0, "L3": 0.5, "violations": [], "verdict": "pass"}},
    ))
    assert row["status"] == "scored"
    assert (row["L1"], row["L3"], row["violations"]) == (1.0, 0.5, 0)
    assert row["calls"] == 2 and row["repair_rounds"] == 1
    assert row["verdict"] == "pass"


def test_parse_events_marks_abstain_and_failure():
    abstain = ab_repair.parse_events(_lines(
        {"stage": "candidates", "status": "skipped", "detail": {"candidates": []}},
        {"stage": "generate", "status": "skipped", "detail": {"calls": 0}},
    ))
    assert abstain["status"] == "abstained" and abstain["L3"] is None

    failed = ab_repair.parse_events(_lines(
        {"stage": "generate", "status": "failed", "summary": "生成失败：parse_failed"}))
    assert failed["status"] == "failed" and "parse_failed" in failed["error"]


def test_delta_only_on_comparable_rows():
    base = {"L1": 1.0, "L3": 0.4, "violations": 3}
    after = {"L1": 1.0, "L3": 0.6, "violations": 0}
    assert ab_repair.delta(base, after) == {"L1": 0.0, "L3": 0.2, "violations": -3}
    assert ab_repair.delta(base, {"L1": None})["L1"] is None


def test_run_defects_skips_index_and_non_dict(tmp_path, monkeypatch):
    (tmp_path / "6.7.1.3_D1.json").write_text(
        json.dumps({"case_id": "6.7.1.3", "_expected_rule": "R2"}), encoding="utf-8")
    (tmp_path / "_index.json").write_text(json.dumps([{"x": 1}]), encoding="utf-8")
    (tmp_path / "weird.json").write_text(json.dumps(["not", "a", "dict"]), encoding="utf-8")

    calls = []
    monkeypatch.setattr(ab_repair, "run_arm",
                        lambda *a, **k: calls.append(a) or {"case": a[0]})
    rows = ab_repair.run_defects(str(tmp_path), [0], 0, 10)

    assert len(rows) == 1 and calls[0][0] == "6.7.1.3"
    assert rows[0]["expected_rule"] == "R2"


def test_markdown_keeps_missing_values_visible():
    md = ab_repair.to_markdown([
        {"case": "6.7.1.3", "repairs": 0, "status": "scored",
         "L1": 1.0, "L3": 0.5, "violations": 1, "calls": 2, "seconds": 12.3},
        {"case": "6.7.1.4", "repairs": 0, "status": "abstained",
         "L1": None, "L3": None, "violations": None, "calls": 0, "seconds": 1.0},
    ])
    assert "| 6.7.1.3 | 0 | scored | 1.0 | 0.5 | 1 | 2 | 12.3 |" in md
    assert "| 6.7.1.4 | 0 | abstained | — | — | — |" in md
