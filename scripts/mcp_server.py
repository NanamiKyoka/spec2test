"""Spec2Test MCP server（stdio，JSON-RPC 2.0）。

把阶段工具以 MCP 工具形式暴露给外部客户端（Claude Code、其它 agent 或评委脚本）：

    {"mcpServers": {"spec2test": {"command": "py",
      "args": ["-3.12", "scripts/mcp_server.py"]}}}

默认只暴露确定性工具；加 --allow-model 才暴露调用模型的工具（generate_steps /
generate_ies / repair_intent）。compare_gold 只用于评测，不通过 MCP 暴露。
调试信息一律写 stderr，stdout 只承载协议消息。
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "tools"))
import stage_tools

VERSIONS = ("2024-11-05", "2025-03-26", "2025-06-18")
DEFAULT_VERSION = "2024-11-05"

SCHEMAS = {
    "prepare_case": {
        "description": "读取用例切片、上下文摘要与候选消息（不调用模型）",
        "inputSchema": {"type": "object",
                        "properties": {"case": {"type": "string",
                                                "description": "用例号，如 6.7.1.3"}},
                        "required": ["case"]},
    },
    "list_candidates": {
        "description": "列出用例的候选消息（不调用模型）",
        "inputSchema": {"type": "object",
                        "properties": {"case": {"type": "string"}},
                        "required": ["case"]},
    },
    "validate_intent": {
        "description": "用确定性规则校验测试意图：R1 消息存在 / R2 字段作用域 / R3 TP 覆盖",
        "inputSchema": {"type": "object",
                        "properties": {"ir": {"type": "object", "description": "测试意图 IR"},
                                       "strictness": {"type": "string",
                                                      "enum": ["strict", "skip_lte_r2", "r1_only"]}},
                        "required": ["ir"]},
    },
    "export_intent": {
        "description": "把 IR 导出为 JSON 与 Markdown",
        "inputSchema": {"type": "object", "properties": {"ir": {"type": "object"}},
                        "required": ["ir"]},
    },
    "list_skills": {
        "description": "列出可用技能（过程说明）",
        "inputSchema": {"type": "object", "properties": {}},
    },
    "use_skill": {
        "description": "取出指定技能的完整说明",
        "inputSchema": {"type": "object",
                        "properties": {"name": {"type": "string"}},
                        "required": ["name"]},
    },
    "generate_steps": {
        "description": "生成步骤序列（调用模型）",
        "inputSchema": {"type": "object",
                        "properties": {"case": {"type": "string"},
                                       "repairs": {"type": "integer", "minimum": 0, "maximum": 3}},
                        "required": ["case"], "model": True},
    },
    "generate_ies": {
        "description": "为候选消息生成 IE 字段（调用模型；必须提供本次步骤）",
        "inputSchema": {"type": "object",
                        "properties": {"case": {"type": "string"},
                                       "steps": {"type": "array"},
                                       "messages": {"type": "array",
                                                    "items": {"type": "string"}}},
                        "required": ["case", "steps"], "model": True},
    },
    "repair_intent": {
        "description": "按校验违规定向修复当前 IR（调用模型）",
        "inputSchema": {"type": "object",
                        "properties": {"ir": {"type": "object"},
                                       "repairs": {"type": "integer", "minimum": 0, "maximum": 5}},
                        "required": ["ir"], "model": True},
    },
}


def visible_tools(allow_model=False):
    out = []
    for name, schema in SCHEMAS.items():
        spec = stage_tools.TOOLS.get(name)
        if not spec or spec["eval_only"]:
            continue
        if spec["model"] and not allow_model:
            continue
        schema = {k: v for k, v in schema.items() if k != "model"}
        out.append(dict(schema, name=name))
    return out


def _result(req_id, payload):
    return {"jsonrpc": "2.0", "id": req_id, "result": payload}


def _error(req_id, code, message):
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


def handle(msg, allow_model=False):
    """处理一条 JSON-RPC 消息；通知返回 None（不写响应）。"""
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0":
        return _error(msg.get("id") if isinstance(msg, dict) else None,
                      -32600, "invalid request")
    method = msg.get("method")
    req_id = msg.get("id")
    params = msg.get("params") or {}
    is_notification = "id" not in msg

    if method == "initialize":
        asked = (params.get("protocolVersion") or "")
        return _result(req_id, {
            "protocolVersion": asked if asked in VERSIONS else DEFAULT_VERSION,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "spec2test", "version": "0.1.0"},
        })
    if method in ("notifications/initialized", "notifications/cancelled") or is_notification:
        return None
    if method == "ping":
        return _result(req_id, {})
    if method == "tools/list":
        return _result(req_id, {"tools": visible_tools(allow_model)})
    if method == "tools/call":
        name = params.get("name")
        args = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
        spec = stage_tools.TOOLS.get(name)
        if not spec or spec["eval_only"] or (spec["model"] and not allow_model):
            return _error(req_id, -32601, "unknown tool: %s" % name)
        required = (SCHEMAS.get(name, {}).get("inputSchema") or {}).get("required") or []
        missing = [k for k in required if k not in args]
        if missing:
            return _result(req_id, {"content": [
                {"type": "text", "text": "missing argument: %s" % ", ".join(missing)}],
                "isError": True})
        try:
            res = stage_tools.call(name, args)
        except stage_tools.ToolError as e:
            return _result(req_id, {"content": [{"type": "text", "text": str(e)}],
                                    "isError": True})
        except Exception as e:
            return _result(req_id, {"content": [{"type": "text",
                                                 "text": "tool_failed: %s" % str(e)[:200]}],
                                    "isError": True})
        text = json.dumps(res.get("data"), ensure_ascii=False)
        return _result(req_id, {"content": [{"type": "text", "text": text}],
                                "isError": False})
    return _error(req_id, -32601, "method not found: %s" % method)


def main():
    ap = argparse.ArgumentParser(description="Spec2Test MCP server（stdio）")
    ap.add_argument("--allow-model", action="store_true",
                    help="额外暴露调用模型的工具")
    a = ap.parse_args()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            sys.stdout.write(json.dumps(_error(None, -32700, "parse error")) + "\n")
            sys.stdout.flush()
            continue
        resp = handle(msg, a.allow_model)
        if resp is not None:
            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
