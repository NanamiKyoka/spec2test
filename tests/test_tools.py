"""阶段工具（HTTP / MCP 共用）与运行参数的契约测试。"""
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request

import pytest

import serve
import stage_tools
import run_one


def _post(url, payload):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8") or "{}")


@pytest.fixture(scope="module")
def base():
    port = 8766
    proc = subprocess.Popen(
        [sys.executable, "scripts/serve.py", "--port", str(port), "--no-browser"],
        cwd=serve.ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    url = "http://127.0.0.1:%d" % port
    try:
        for _ in range(80):
            try:
                with urllib.request.urlopen(url + "/api/health", timeout=2) as r:
                    if r.status == 200:
                        break
            except Exception:
                pass
            time.sleep(0.1)
        yield url
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def test_unknown_tool(base):
    code, body = _post(base + "/api/tools/nope", {"args": {}})
    assert code == 404 and body["error"] == "unknown_tool"


def test_prepare_case_tool(base):
    code, body = _post(base + "/api/tools/prepare_case", {"args": {"case": "6.7.1.3"}})
    assert code == 200 and body["ok"]
    assert body["data"]["case_id"] == "6.7.1.3"
    assert body["data"]["candidates"]
    assert body["trace"]["tool"] == "prepare_case"


def test_list_candidates_unknown_case(base):
    code, body = _post(base + "/api/tools/list_candidates", {"args": {"case": "9.9.9"}})
    assert code == 400 and "unknown_case" in body["error"]


def test_validate_intent_reports_r2(base):
    ir = {"case_id": "6.7.1.3",
          "steps": [{"st": 1, "actor": "SS", "direction": "S->U", "message": "SIB19"}],
          "messages": [{"message": "SIB19", "ies": [{"name": "notARealField"}]}],
          "tp": [1]}
    code, body = _post(base + "/api/tools/validate_intent", {"args": {"ir": ir}})
    assert code == 200 and body["ok"]
    assert any(v["rule"] == "R2" for v in body["data"]["violations"])
    assert body["data"]["verdict"] == "reject"


def test_trace_endpoint_lists_recent_calls(base):
    with urllib.request.urlopen(base + "/api/trace/tools?limit=5", timeout=5) as r:
        rows = json.loads(r.read().decode("utf-8"))["rows"]
    assert rows and any(row["tool"] == "prepare_case" for row in rows)
    assert all("ms" in row and "at" in row for row in rows)


def test_trace_endpoint_filters_unknown_job(base):
    with urllib.request.urlopen(base + "/api/trace/tools?job=no-such-job", timeout=5) as r:
        assert json.loads(r.read().decode("utf-8"))["rows"] == []


def test_recent_trace_filters_by_job(tmp_path, monkeypatch):
    monkeypatch.setattr(stage_tools, "TRACE_DIR", str(tmp_path))
    monkeypatch.setenv("SPEC2TEST_JOB", "jobA")
    stage_tools._trace("prepare_case", time.time(), case="6.7.1.3")
    monkeypatch.setenv("SPEC2TEST_JOB", "jobB")
    stage_tools._trace("prepare_case", time.time(), case="6.7.1.4")

    own = stage_tools.recent_trace(10, job="jobA")
    assert len(own) == 1 and own[0]["job"] == "jobA" and own[0]["case"] == "6.7.1.3"
    assert len(stage_tools.recent_trace(10)) == 2


def test_tools_listing_marks_eval_only(base):
    with urllib.request.urlopen(base + "/api/tools", timeout=5) as r:
        tools = {t["name"]: t for t in json.loads(r.read().decode("utf-8"))["tools"]}
    assert tools["compare_gold"]["eval_only"] is True
    assert tools["prepare_case"]["model"] is False


def test_dry_run_forces_pipeline(base):
    code, body = _post(base + "/api/run", {"case": "6.7.1.3", "dry_run": True,
                                           "options": {"engine": "agent"}})
    assert code == 200 and body["options"]["engine"] == "pipeline"


def test_agent_with_hitl_rejected(base):
    with urllib.request.urlopen(base + "/api/health", timeout=5) as r:
        if not json.loads(r.read().decode("utf-8")).get("credential"):
            pytest.skip("需要可用模型凭据")
    code, body = _post(base + "/api/run", {"case": "6.7.1.3", "hitl": True,
                                           "options": {"engine": "agent"}})
    assert code == 400 and body["error"] == "hitl_not_supported_with_agent"


def test_filter_keeps_r0_under_any_strictness():
    viol = [{"rule": "R0", "path": "validate", "detail": "boom"},
            {"rule": "R2", "path": "x", "detail": "bad field"}]
    assert len(stage_tools.filter_violations(viol, "r1_only")) == 1
    assert stage_tools.filter_violations(viol, "strict") == viol


def test_norm_strictness_aliases_fail_closed():
    assert stage_tools.norm_strictness("R1/R2/R3") == "strict"
    assert stage_tools.norm_strictness("R2") == "strict"
    assert stage_tools.norm_strictness("R1") == "r1_only"
    assert stage_tools.norm_strictness("R1+R3") == "skip_lte_r2"
    assert stage_tools.norm_strictness("nonsense") == "strict"
    assert stage_tools.norm_strictness(None) == "strict"


def test_generate_ies_requires_steps():
    with pytest.raises(stage_tools.ToolError):
        stage_tools.generate_ies_tool("6.7.1.3")


def test_norm_run_options_defaults_and_clamp():
    assert serve.norm_run_options(None) == {
        "messages": [], "mode": "full", "repairs": 1, "strictness": "strict",
        "engine": "pipeline", "skills": [], "mcpTools": None}
    got = serve.norm_run_options({"mode": "bogus", "repairs": 99,
                                  "strictness": "nope", "messages": ["SIB19", " ", 3]})
    assert got["mode"] == "full" and got["repairs"] == 5
    assert got["strictness"] == "strict" and got["messages"] == ["SIB19", "3"]


def test_norm_run_options_engine():
    assert serve.norm_run_options({"engine": "agent"})["engine"] == "agent"
    assert serve.norm_run_options({"engine": "nope"})["engine"] == "pipeline"


def test_norm_run_options_filters_unknown_skills_and_tools():
    got = serve.norm_run_options({"skills": ["sib19-required-fields", "nope"],
                                  "mcpTools": ["prepare_case", "compare_gold", "zzz"]})
    assert got["skills"] == ["sib19-required-fields"]
    assert got["mcpTools"] == ["prepare_case"]
    assert serve.norm_run_options({"mcpTools": ["zzz"]})["mcpTools"] == []


def test_pick_candidates_filters_and_reports_missing():
    kept, missing = run_one.pick_candidates(["SIB19", "SIB1", "RRCSetup"], "SIB19,FOO")
    assert kept == ["SIB19"] and missing == ["FOO"]
    assert run_one.pick_candidates(["SIB19"], "") == (["SIB19"], [])


def test_apply_options_overrides_only_valid():
    class A:
        mode, repairs, strictness, messages = "full", 1, "strict", ""
    a = run_one.apply_options(A(), {"mode": "steps", "repairs": 3,
                                    "strictness": "r1_only", "messages": ["SIB19"]})
    assert (a.mode, a.repairs, a.strictness, a.messages) == ("steps", 3, "r1_only", "SIB19")
    b = run_one.apply_options(A(), {"mode": "nope", "repairs": "x"})
    assert (b.mode, b.repairs) == ("full", 1)
