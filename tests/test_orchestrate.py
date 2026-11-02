"""自由编排的指标与判定语义。"""
import json
import os

import pytest

import ab_orchestration
import orchestrate
import serve

NEEDS_DATA = pytest.mark.skipif(
    not os.path.isdir(os.path.join(serve.ROOT, "data", "benchmark", "v0")),
    reason="需要本地 data/ 基准，仓库未入库",
)


def test_parse_free_counts_tool_calls_and_score():
    lines = [json.dumps(e, ensure_ascii=False) for e in [
        {"stage": "agent", "status": "ok", "detail": {"tool": "generate_steps"}},
        {"stage": "agent", "status": "failed", "detail": {"tool": "validate_intent"}},
        {"stage": "score", "status": "ok",
         "detail": {"L1": 1.0, "L3": 0.5, "violations": [], "verdict": "pass", "calls": 2}},
    ]]
    row = ab_orchestration.parse_free(lines)
    assert row["status"] == "scored" and row["tool_calls"] == 2
    assert (row["L1"], row["L3"], row["calls"], row["verdict"]) == (1.0, 0.5, 2, "pass")


@NEEDS_DATA
def test_score_state_incomplete_without_messages(monkeypatch):
    monkeypatch.setattr(orchestrate.validate_mod, "validate", lambda ir, s: [])
    monkeypatch.setattr(orchestrate.score, "gold_leaf_ies", lambda p: ["fielda"])

    st = orchestrate.State("6.7.1.3")
    assert orchestrate.score_state(st)["verdict"] == "abstained"        # 什么都没有

    st.messages = [{"message": "SIB1", "ies": [{"name": "fielda"}]}]
    assert orchestrate.score_state(st)["verdict"] == "incomplete"       # 只有字段

    st.steps = [{"st": 1, "actor": "SS", "direction": "S->U", "message": "SIB1"}]
    st.messages = []
    assert orchestrate.score_state(st)["verdict"] == "incomplete"       # 只有步骤

    st.messages = [{"message": "SIB1", "ies": [{"name": "fielda"}]}]
    out = orchestrate.score_state(st)
    assert out["verdict"] == "pass" and out["L3"] == 1.0


@NEEDS_DATA
def test_score_state_abstains_without_anything(monkeypatch):
    monkeypatch.setattr(orchestrate.validate_mod, "validate", lambda ir, s: [])
    st = orchestrate.State("6.7.1.3")
    assert orchestrate.score_state(st)["verdict"] == "abstained"


def test_final_blocked_requires_complete_artifact():
    st = orchestrate.State("6.7.1.3")
    st.candidates = ["SIB1"]
    st.steps = [{"st": 1}]
    assert orchestrate.final_blocked(st) is True         # 缺字段
    st.messages = [{"message": "SIB1", "ies": []}]
    assert orchestrate.final_blocked(st) is False

    bare = orchestrate.State("6.7.1.4")
    bare.steps = [{"st": 1}]
    assert orchestrate.final_blocked(bare) is False      # 无候选=弃权，允许完成


def test_summarize_uses_verdict_counts():
    rows = [{"verdict": "pass", "calls": 2, "seconds": 1.0},
            {"verdict": "abstained", "calls": 0, "seconds": 0.5},
            {"status": "abstained", "calls": 0, "seconds": 0.4},
            {"verdict": "reject", "calls": 3, "seconds": 2.0},
            {"status": "timeout", "seconds": 9.0}]
    s = ab_orchestration.summarize(rows)
    assert (s["pass"], s["abstained"], s["reject"], s["failed"]) == (1, 2, 1, 1)
    assert s["success_rate"] == 0.2 and s["abstain_rate"] == 0.4
    assert s["calls"] == 5
