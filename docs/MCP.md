# MCP 接入

`scripts/mcp_server.py` 把阶段工具以 MCP（JSON-RPC 2.0 / stdio）暴露给外部客户端。
它和 HTTP 接口共用 `tools/stage_tools.py`，同一份实现，不是两套逻辑。

## 客户端配置

Claude Code、Cursor 或任意 MCP 客户端：

```json
{
  "mcpServers": {
    "spec2test": {
      "command": "py",
      "args": ["-3.12", "scripts/mcp_server.py"]
    }
  }
}
```

需要调用模型的工具时加 `--allow-model`：

```json
{"command": "py", "args": ["-3.12", "scripts/mcp_server.py", "--allow-model"]}
```

## 工具

| 工具 | 调用模型 | 说明 |
|---|---|---|
| `prepare_case` | 否 | 读取切片、上下文摘要与候选消息 |
| `list_candidates` | 否 | 候选消息清单 |
| `validate_intent` | 否 | R1/R2/R3 校验，可按严格度筛选 |
| `export_intent` | 否 | 导出 JSON 与 Markdown |
| `list_skills` | 否 | 技能清单 |
| `use_skill` | 否 | 读取一份技能的完整说明 |
| `generate_steps` | 是 | 生成步骤序列（需 `--allow-model`） |
| `generate_ies` | 是 | 为消息生成 IE 字段（需 `--allow-model`，必须给本次步骤） |
| `repair_intent` | 是 | 按违规定向修复（需 `--allow-model`） |

`compare_gold` 属于评测口径，**不通过 MCP 暴露**，避免运行时看到官方答案。

## 协议要点

- `initialize`：回显客户端支持的协议版本（支持 `2024-11-05` / `2025-03-26` / `2025-06-18`），
  声明 `tools` 能力；未知版本回落到 `2024-11-05`。
- `tools/list`：默认只列确定性工具。
- `tools/call`：成功返回 `{content:[{type:"text",text:<JSON>}],isError:false}`；
  参数缺失、工具报错都返回 `isError:true`，不会中断会话。
- 通知（无 `id`）不产生响应；未知方法返回 `-32601`，坏 JSON 返回 `-32700`。
- stdout 只输出协议消息，日志走 stderr。

## 手工验证

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_candidates","arguments":{"case":"6.7.1.3"}}}' \
  | py -3.12 scripts/mcp_server.py
```
