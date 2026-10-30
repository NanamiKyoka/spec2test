import json

import gen_ie


def _symbols(tmp_path):
    p = tmp_path / "symbols.json"
    p.write_text(json.dumps({"messages": {"SIB4": {"fields": ["goodField"]}}}), encoding="utf-8")
    return str(p)


def _fake_validate(ir, table):
    out = []
    for m in ir.get("messages") or []:
        for k, ie in enumerate(m.get("ies") or []):
            if ie.get("name") == "badField":
                out.append({"rule": "R2",
                            "path": "messages[%s].ies[%d].name" % (m.get("message"), k),
                            "detail": "unknown field 'badField' for %s" % m.get("message")})
    return out


def _patched(monkeypatch, tmp_path, gen):
    monkeypatch.setattr(gen_ie, "candidate_messages", lambda ctx, path: ["SIB4"])
    monkeypatch.setattr(gen_ie, "generate_ie", gen)
    monkeypatch.setattr(gen_ie.validate, "validate", _fake_validate)
    return _symbols(tmp_path)


def test_repair_fixes_after_one_round(tmp_path, monkeypatch):
    calls = []

    def gen(ctx, steps, msg, path, feedback=None):
        calls.append(list(feedback or []))
        name = "goodField" if feedback else "badField"
        return {"message": msg, "ies": [{"name": name}]}

    sym = _patched(monkeypatch, tmp_path, gen)
    res = gen_ie.generate_all({}, [], sym, repairs=1)

    assert res["repairs"] == 1
    assert res["calls"] == 2
    assert len(calls) == 2
    assert calls[0] == [] and calls[1]          # 第二次带上了违规清单
    assert _fake_validate({"messages": res["messages"]}, None) == []


def test_repair_stops_after_one_round_even_if_still_bad(tmp_path, monkeypatch):
    calls = []

    def gen(ctx, steps, msg, path, feedback=None):
        calls.append(list(feedback or []))
        return {"message": msg, "ies": [{"name": "badField"}]}

    sym = _patched(monkeypatch, tmp_path, gen)
    res = gen_ie.generate_all({}, [], sym, repairs=1)

    assert res["repairs"] == 1
    assert res["calls"] == 2
    assert len(calls) == 2                       # 只重试一次，不无限循环
    assert res["messages"][0]["ies"][0]["name"] == "badField"


def test_repair_parse_failure_keeps_old_message(tmp_path, monkeypatch):
    def gen(ctx, steps, msg, path, feedback=None):
        if feedback:
            return {"message": msg, "ies": []}
        return {"message": msg, "ies": [{"name": "badField"}]}

    sym = _patched(monkeypatch, tmp_path, gen)
    res = gen_ie.generate_all({}, [], sym, repairs=1)
    assert res["repairs"] == 1
    assert res["messages"][0]["ies"][0]["name"] == "badField"
