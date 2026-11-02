"""MCP server（stdio）：协议握手、工具可见性、调用与错误。"""
import json
import subprocess
import sys

import serve
import mcp_server


def _call(method, params=None, req_id=1):
    return mcp_server.handle({"jsonrpc": "2.0", "id": req_id,
                              "method": method, "params": params or {}})


def test_initialize_negotiates_version():
    out = _call("initialize", {"protocolVersion": "2025-06-18"})
    assert out["result"]["protocolVersion"] == "2025-06-18"
    assert "tools" in out["result"]["capabilities"]
    assert out["result"]["serverInfo"]["name"] == "spec2test"

    odd = _call("initialize", {"protocolVersion": "1999-01-01"})
    assert odd["result"]["protocolVersion"] == mcp_server.DEFAULT_VERSION


def test_notification_has_no_response():
    assert mcp_server.handle({"jsonrpc": "2.0", "method": "notifications/initialized"}) is None


def test_tools_list_hides_model_and_eval_tools_by_default():
    names = {t["name"] for t in _call("tools/list")["result"]["tools"]}
    assert {"prepare_case", "validate_intent", "list_skills", "use_skill"} <= names
    assert "generate_steps" not in names
    assert "compare_gold" not in names

    full = {t["name"] for t in mcp_server.handle(
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, allow_model=True)["result"]["tools"]}
    assert "generate_steps" in full and "compare_gold" not in full


def test_tool_call_returns_json_text():
    out = mcp_server.handle({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                             "params": {"name": "list_candidates",
                                        "arguments": {"case": "6.7.1.3"}}})
    text = out["result"]["content"][0]["text"]
    assert out["result"]["isError"] is False
    assert json.loads(text)["candidates"]


def test_unknown_tool_and_bad_args():
    out = mcp_server.handle({"jsonrpc": "2.0", "id": 4, "method": "tools/call",
                             "params": {"name": "compare_gold", "arguments": {}}})
    assert out["error"]["code"] == -32601

    bad = mcp_server.handle({"jsonrpc": "2.0", "id": 5, "method": "tools/call",
                             "params": {"name": "validate_intent", "arguments": {}}})
    assert bad["result"]["isError"] is True
    assert "missing argument: ir" in bad["result"]["content"][0]["text"]


def test_unknown_method_is_error():
    out = _call("resources/list")
    assert out["error"]["code"] == -32601


def test_stdio_roundtrip():
    proc = subprocess.run(
        [sys.executable, "scripts/mcp_server.py"],
        cwd=serve.ROOT, capture_output=True, text=True, encoding="utf-8", timeout=60,
        input='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}\n'
              '{"jsonrpc":"2.0","method":"notifications/initialized"}\n'
              '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n',
    )
    lines = [json.loads(l) for l in proc.stdout.splitlines() if l.strip()]
    assert len(lines) == 2                      # 通知不产生响应
    assert lines[0]["result"]["serverInfo"]["name"] == "spec2test"
    assert any(t["name"] == "validate_intent" for t in lines[1]["result"]["tools"])
