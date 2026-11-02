"""自诊断修复闭环：定向修改、无进展即停、不改结构。"""
import json

import repair_steps
import stage_tools


def _ir():
    return {
        "case_id": "6.7.1.3",
        "steps": [{"st": 1, "actor": "SS", "direction": "S->U",
                   "message": "NotAMessage", "tp_ref": [1]}],
        "messages": [],
        "tp": [{"index": 1}],
    }


def _reply(steps):
    return json.dumps({"steps": steps}, ensure_ascii=False), "end_turn"


def test_repair_step_fixes_r1(monkeypatch):
    calls = {"n": 0}

    def fake(messages, **kw):
        calls["n"] += 1
        return _reply([{"st": 1, "actor": "SS", "direction": "S->U",
                        "message": "SIB1", "tp_ref": [1]}])

    monkeypatch.setattr(repair_steps.llm, "complete", fake)
    r = stage_tools.repair_step(_ir(), "strict")

    assert r["before"] == 1 and r["after"] == 0
    assert r["ir"]["steps"][0]["message"] == "SIB1"
    assert r["actions"][0]["layer"] == "steps"
    assert calls["n"] == 1


def test_repair_step_rejects_shape_change(monkeypatch):
    monkeypatch.setattr(repair_steps.llm, "complete",
                        lambda *a, **k: _reply([]))  # 步数被改
    r = stage_tools.repair_step(_ir(), "strict")
    assert r["after"] == r["before"] == 1
    assert r["ir"]["steps"][0]["message"] == "NotAMessage"
    assert r["actions"] and "error" in r["actions"][0]


def test_repair_step_cannot_change_actor_or_st(monkeypatch):
    monkeypatch.setattr(repair_steps.llm, "complete",
                        lambda *a, **k: _reply([{"st": 9, "actor": "UE",
                                                 "direction": "U->S",
                                                 "message": "SIB1", "tp_ref": [1]}]))
    r = stage_tools.repair_step(_ir(), "strict")
    step = r["ir"]["steps"][0]
    assert (step["st"], step["actor"], step["direction"]) == (1, "SS", "S->U")
    assert step["message"] == "SIB1"


def test_repair_step_passes_skill_hint(monkeypatch):
    seen = {}

    def fake(messages, **kw):
        seen["system"] = kw.get("system") or ""
        return _reply([{"st": 1, "actor": "SS", "direction": "S->U",
                        "message": "SIB1", "tp_ref": [1]}])

    monkeypatch.setattr(repair_steps.llm, "complete", fake)
    stage_tools.repair_step(_ir(), "strict", skills=["sib19-required-fields"])
    assert "t-Service-r17" in seen["system"]


def test_repair_step_ignores_unknown_skill(monkeypatch):
    seen = {}

    def fake(messages, **kw):
        seen["system"] = kw.get("system") or ""
        return _reply([])

    monkeypatch.setattr(repair_steps.llm, "complete", fake)
    stage_tools.repair_step(_ir(), "strict", skills=["nope"])
    assert "技能" not in seen["system"]


def test_repair_intent_stops_when_no_progress(monkeypatch):
    calls = {"n": 0}

    def same(messages, **kw):
        calls["n"] += 1
        return _reply([{"st": 1, "actor": "SS", "direction": "S->U",
                        "message": "NotAMessage", "tp_ref": [1]}])

    monkeypatch.setattr(repair_steps.llm, "complete", same)
    d = stage_tools.repair_intent(_ir(), 3, "strict")["data"]

    assert calls["n"] == 1 and d["repairs"] == 1  # 无进展立即停，不烧满 3 轮
    assert d["before"] == 1 and d["after"] == 1


def test_repair_intent_no_violations_makes_no_call(monkeypatch):
    def forbidden(*a, **k):
        raise AssertionError("无违规时不应调用模型")

    monkeypatch.setattr(repair_steps.llm, "complete", forbidden)
    ir = _ir()
    ir["steps"][0]["message"] = "SIB1"
    d = stage_tools.repair_intent(ir, 2, "strict")["data"]
    assert d["before"] == 0 and d["repairs"] == 0
