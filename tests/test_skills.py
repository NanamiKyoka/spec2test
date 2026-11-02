"""技能库：清单、读取与错误处理。"""
import pytest

import skills
import stage_tools


def test_list_skills_has_three_with_metadata():
    names = {s["name"] for s in skills.list_skills()}
    assert {"sib19-required-fields", "tp-reference-repair",
            "cross-message-field-check"} <= names
    for s in skills.list_skills():
        assert s["description"] and s["when"] and s["chars"] > 100


def test_get_skill_returns_body_and_accepts_file_stem():
    s = skills.get_skill("sib19-required-fields")
    assert s and "t-Service-r17" in s["body"]
    assert skills.get_skill("SIB19-required-fields")["name"] == "sib19-required-fields"
    assert skills.get_skill("nope") is None


def test_use_skill_tool_rejects_unknown():
    with pytest.raises(stage_tools.ToolError):
        stage_tools.use_skill("nope")


def test_use_skill_tool_returns_body():
    out = stage_tools.use_skill("tp-reference-repair")["data"]
    assert out["name"] == "tp-reference-repair"
    assert "tp_ref" in out["body"]
