import json
import os

import baseline_structured
import score


def _write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)


def test_dry_run_writes_structured_stub(tmp_path):
    ctx_dir = tmp_path / "ctx"
    _write(str(ctx_dir / "6.7.1.3.json"), {
        "case_id": "6.7.1.3", "title": "t", "test_purpose": "tp",
        "conformance_requirements": "", "pre_test_conditions": "",
    })
    out = tmp_path / "out"
    baseline_structured.main(str(ctx_dir), str(out), dry=True)
    d = json.load(open(out / "6.7.1.3.json", encoding="utf-8"))
    assert d["steps"] and d["messages"]
    assert d["calls"] == 0


def test_baseline_metrics_are_comparable():
    struct = {
        "steps": [{"actor": "SS", "direction": "S->U", "message": "SIB1"},
                  {"actor": "UE", "direction": "U->S", "message": ""}],
        "messages": [{"message": "SIB1", "ies": [{"name": "cellBarredNTN-r17"}]}],
    }
    gold = [score.norm_ie("cellBarredNTN-r17")]
    m = score.baseline_metrics(struct, gold)
    assert m["L1_base"] == 1.0
    assert m["L1_base_cov"] == 0.5
    assert m["L3_base"] == 1.0


def test_structured_baseline_overrides_prose(tmp_path):
    cid = "6.7.1.3"
    gold_steps = tmp_path / "gold_steps"
    gold_ie = tmp_path / "gold_ie"
    out = tmp_path / "out"
    base = tmp_path / "out_baseline"
    _write(str(gold_steps / (cid + ".json")), {"steps": [
        {"st": 1, "direction": "S->U", "message": "SIB1", "tp_ref": [1]}]})
    _write(str(gold_ie / (cid + ".json")), {"message_tables": [
        {"message": "SIB1", "leaf_ies": [{"name": "cellBarredNTN-r17"}]}]})
    _write(str(out / (cid + ".json")), {"steps": [
        {"st": 1, "actor": "SS", "direction": "S->U", "message": "SIB1"}],
        "messages": [{"message": "SIB1", "ies": [{"name": "cellBarredNTN-r17"}]}],
        "status": "generated"})
    _write(str(base / (cid + ".json")), {"text": "prose only"})
    _write(str(tmp_path / "out_baseline_struct" / (cid + ".json")), {
        "steps": [{"st": 1, "actor": "SS", "direction": "S->U", "message": "SIB1"}],
        "messages": [{"message": "SIB1", "ies": [{"name": "cellBarredNTN-r17"}]}],
    })
    report = tmp_path / "report"
    score.main(str(gold_steps), str(gold_ie), str(out), str(base), str(report))
    row = json.load(open(report / "report.json", encoding="utf-8"))[0]
    assert row["L1_base"] == 1.0
    assert row["L1_base_cov"] == 1.0
    assert row["L3_base"] == 1.0


def test_prose_only_falls_back(tmp_path):
    cid = "6.7.1.3"
    gold_steps = tmp_path / "gold_steps"
    gold_ie = tmp_path / "gold_ie"
    out = tmp_path / "out"
    base = tmp_path / "out_baseline"
    _write(str(gold_steps / (cid + ".json")), {"steps": [
        {"st": 1, "direction": "S->U", "message": "SIB1", "tp_ref": [1]}]})
    _write(str(gold_ie / (cid + ".json")), {"message_tables": [
        {"message": "SIB1", "leaf_ies": [{"name": "cellBarredNTN-r17"}]}]})
    _write(str(out / (cid + ".json")), {"steps": [], "messages": [], "status": "generated"})
    _write(str(base / (cid + ".json")), {"text": "prose only"})
    report = tmp_path / "report"
    score.main(str(gold_steps), str(gold_ie), str(out), str(base), str(report))
    row = json.load(open(report / "report.json", encoding="utf-8"))[0]
    assert row["L1_base"] == 1.0
    assert row["L3_base"] is None
    assert row["L1_base_cov"] is None
