import json
import sys
import types

import gen_ie
import gen_steps
import run_one
import validate as validate_mod


def _args(no_write=False):
    return types.SimpleNamespace(no_write=no_write)


def _events(capsys):
    return [json.loads(l) for l in capsys.readouterr().out.splitlines() if l.strip()]


def test_validate_exception_rejects(tmp_path, monkeypatch, capsys):
    """校验器抛异常必须按拒收处理，不能漏成 pass 写进正式结果。"""
    out = tmp_path / "out"
    rej = tmp_path / "out_rejected"
    monkeypatch.setattr(run_one, "OUT", str(out))
    monkeypatch.setattr(run_one, "OUT_REJECTED", str(rej))
    monkeypatch.setattr(run_one, "GOLD_IE", str(tmp_path / "no_gold"))

    def boom(ir, syms):
        raise KeyError("messages")

    monkeypatch.setattr(validate_mod, "validate", boom)

    ir = {"case_id": "6.7.1.99",
          "steps": [{"st": 1, "actor": "SS", "direction": "S->U",
                     "message": "FakeMessage", "tp_ref": [1]}]}
    run_one.finish("6.7.1.99", ir, _args(), None)

    assert not out.exists()
    saved = json.loads((rej / "6.7.1.99.json").read_text(encoding="utf-8"))
    assert saved["verdict"] == "reject"
    assert saved["violations"]
    assert saved["violations"][0]["rule"] == "R0"

    ev = _events(capsys)
    assert any(e["stage"] == "validate" and e["status"] == "failed" for e in ev)
    assert any(e["stage"] == "verdict" and e["status"] == "rejected" for e in ev)


def test_generate_parse_failure_is_fatal(tmp_path, monkeypatch, capsys):
    """模型输出解析失败要暴露成生成失败，而不是“生成完成 steps=0”。"""
    monkeypatch.setattr(run_one, "OUT", str(tmp_path / "out"))
    monkeypatch.setattr(run_one, "OUT_REJECTED", str(tmp_path / "rej"))
    monkeypatch.setattr(run_one, "GOLD_IE", str(tmp_path / "gold"))

    def fake_load(path):
        if "benchmark" in path:
            return {"title": "t", "inputs": {"test_purpose": "p"}, "answers": {}}
        return {"case_id": "6.7.1.3", "test_purpose": "p",
                "conformance_requirements": "", "pre_test_conditions": ""}

    monkeypatch.setattr(run_one, "load", fake_load)
    monkeypatch.setattr(gen_ie, "candidate_messages", lambda ctx, p: ["SIB1"])
    monkeypatch.setattr(gen_steps, "generate_steps",
                        lambda ctx: ([], {"error": "parse_failed(stop=end_turn,len=3)"}))
    monkeypatch.setattr(sys, "argv", ["run_one.py", "6.7.1.3"])

    assert run_one.main() == 1
    assert not (tmp_path / "out").exists()
    assert not (tmp_path / "rej").exists()

    ev = _events(capsys)
    assert any(e["stage"] == "generate" and e["status"] == "failed" for e in ev)
    assert any(e["stage"] == "validate" and e["status"] == "skipped" for e in ev)
