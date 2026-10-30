import json
import pathlib

import gen_ie
import score
import validate

ROOT = pathlib.Path(__file__).resolve().parents[1]
SYM = str(ROOT / "results" / "symbols" / "rrc_symbols.json")


def test_candidate_explicit_sibtype():
    ctx = {"test_purpose": "UE reads SystemInformationBlockType19 in NTN."}
    assert "SIB19" in gen_ie.candidate_messages(ctx, SYM)


def test_candidate_field_derived():
    ctx = {"conformance_requirements": "when cellReselectionInfoCommon is present"}
    assert "SIB2" in gen_ie.candidate_messages(ctx, SYM)


def test_candidate_ignores_enum_words():
    ctx = {"test_purpose": "one two three, not present, barred"}
    assert gen_ie.candidate_messages(ctx, SYM) == []


def test_l1_separates_coverage():
    ir = {"steps": [{"actor": "SS", "direction": "S->U", "message": ""},
                    {"actor": "UE", "direction": "U->S", "message": "RRCSetupRequest"}]}
    assert score.l1_ok(ir) == 1.0
    assert score.step_msg_coverage(ir) == 0.5


def _syms():
    return json.load(open(SYM, encoding="utf-8"))


def test_r3_counts_tp_ref_list():
    ir = {
        "case_id": "x",
        "tp": [{"index": 1}, {"index": 2}],
        "steps": [{"st": 1, "actor": "SS", "direction": "S->U", "message": "SIB1", "tp_ref": [1]}],
        "messages": [],
    }
    v = validate.validate(ir, _syms())
    assert any(x["rule"] == "R3" and x["path"] == "tp[2]" for x in v)


def test_r3_supports_old_tp_string():
    ir = {
        "case_id": "x",
        "tp": [{"index": 1}, {"index": 2}],
        "steps": [{"st": 1, "actor": "SS", "direction": "S->U", "message": "SIB1", "tp": "1, 2"}],
        "messages": [],
    }
    assert not any(x["rule"] == "R3" for x in validate.validate(ir, _syms()))


def test_r2_path_uses_message_name():
    ir = {
        "case_id": "x",
        "tp": [],
        "steps": [{"st": 1, "actor": "SS", "direction": "S->U", "message": "SIB1", "tp_ref": [1]}],
        "messages": [{"message": "SIB1", "ies": [{"name": "bogusFieldXyz"}]}],
    }
    v = validate.validate(ir, _syms())
    hit = [x for x in v if x["rule"] == "R2"]
    assert hit and hit[0]["path"].startswith("messages[SIB1]")
