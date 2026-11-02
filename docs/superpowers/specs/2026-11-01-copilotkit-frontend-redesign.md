# 前端整体重做：Next.js + CopilotKit 信息架构

日期：2026-11-01
状态：设计已确认，待实现计划

## 1. 背景与目标

现有前端是 Vite + React 18 的 hash 路由 SPA（`app/`，约 5,500 行），对话页与五个并列视图各自实现，
"智能体"只体现在一条聊天流里，工具调用、审批、判定结果没有统一的信息架构。

目标：按 CopilotKit 的逻辑重做前端——**对话是主界面，能力以 action 暴露，应用状态可被模型读取，
人类在关键步骤审批，结果以生成式卡片回到对话里**。同时真接入 CopilotKit 运行时。

## 2. 非目标

- 不改 Python 后端协议（`scripts/serve.py` 的 `/api/*` 保持现状）。
- 不重做校验器和评分口径。
- 不引入 CopilotKit Cloud，不依赖公网服务。

## 3. 架构

```
浏览器 ──> :3000 Next.js
             ├─ UI（App Router，React 19）
             ├─ /api/copilotkit  (route handler, CopilotRuntime + AnthropicAdapter)
             └─ rewrite /api/* /data/* /results/* (afterFiles) ──> :8000
                                                                    │
:15721 OpenCode 代理 <── AnthropicAdapter（UA: claude-cli/1.0 (external)）
                                                                    │
                                                          scripts/serve.py（任务/数据/快照）
```

- CopilotKit `1.83.x`；`AnthropicAdapter` 注入自定义 `Anthropic` 客户端：`baseURL=http://127.0.0.1:15721/v1`
  （AI SDK 会在其后拼 `/messages`）、`apiKey` 占位、`defaultHeaders` 带
  `user-agent: claude-cli/1.0 (external)` 与 `x-opencode-session`（缺失分别会 403）。
- 1.83 的 Next 端点是 **v2 单路由协议**（POST `{method, params, body}`，`method ∈ info/agent/run/...`），
  前端 Provider 必须显式 `useSingleEndpoint`；GraphQL 传输不适用于该端点。
- 已验证：该代理支持 Anthropic SSE 流式、tool_use、`input_json_delta`；`agent/run` 真实返回
  `TEXT_MESSAGE_CONTENT("收到")` 与 `RUN_FINISHED`。
- Next 16 + React 19；Python API 的 rewrite 必须放在 `afterFiles`，避免吞掉 `/api/copilotkit`。
- 模型名默认 `claude-sonnet-4-6[1M]`，可用 `LLM_MODEL` 覆盖；代理负责映射到底层模型。

## 4. 目录与迁移策略

新建 `webapp/`，不原地改 `app/`：

```
webapp/
  app/                     # Next App Router：页面与 route handler
  components/copilot/      # action 卡片、trace 面板、evidence 抽屉
  lib/                     # 从 app/src/lib 迁入（api/export/stages/plain/evidence）
  views/                   # 从 app/src/views 迁入，改 client component
```

- 功能对齐（E2E 通过）后删除 `app/`、`web/`，同步更新 `start.bat`、README、WEB-SPEC。
- 旧 `/#/chat` 等 hash 链接用 `app/page.tsx` 的客户端重定向兜底。

## 5. 信息架构

| 路由 | 内容 |
|---|---|
| `/` | 对话工作台：左栏 8 用例速览 + 最近运行；中栏 CopilotChat；右栏运行 trace（按需打开） |
| `/case/[id]` | 单例全链条与字段级证据（也可从卡片抽屉打开） |
| `/data` | 指标卡、逐例矩阵、运行历史 |
| `/eval` | L3 与基线配对、缺陷检出、官方答案误报 |
| `/api` | 通道、Base URL、模型、温度、Key（只写不读） |
| `/about` | 5 分钟评审路径与诚实声明 |

对话内四类生成式卡片：
1. `run`：六阶段进度、候选消息数、耗时、调用次数。
2. `approval`：HITL 审批卡（批准 / 取消），展示候选消息。
3. `result`：判定、L1/L3/gold、R1/R2/R3 违规路径、导出入口。
4. `abstain`：明确"未生成 IE 字段内容（阶段二未调用模型）"。

## 6. CopilotKit 表面

`useCopilotReadable`：
- `cases`（`GET /api/cases`）、`activeCase`、`lastJob`（含 verdict/stages）、`provider/model`、`data_source`。

Actions：

| name | 参数 | 行为 | 渲染 |
|---|---|---|---|
| `run_case` | `case`, `hitl?`, `dry_run?` | `POST /api/run` → SSE `/api/job/<id>/stream`，断线退避轮询 | `run` 卡 |
| `approve_candidates` | `decision` | `POST /api/job/<id>/approve` | `approval` 卡（`renderAndWaitForResponse`） |
| `get_case_evidence` | `case` | `GET /api/case/<id>` | `result` 卡 |
| `get_metrics` | 无 | `GET /api/metrics` | 指标卡 |
| `open_case` | `case` | 客户端导航到 `/case/[id]` | 文本确认 |

Instructions 硬约束：
- 只决定调用哪个 action，**所有数字与判定必须来自后端响应**，不得自行生成。
- 弃权（abstained）与拒收（reject）不得表述为"通过"；失败任务直接展示错误。
- 不编造用例号；范围外请求明确说明只覆盖 §6.7 的 8 个用例。

## 7. 数据流

1. 用户在对话里发起请求；模型返回 action 调用。
2. action handler 调 `POST /api/run`，拿到 `job_id`，立即渲染 `run` 卡。
3. 卡片订阅 `EventSource`；每帧更新阶段/日志；终态 `done|failed` 关闭连接。
4. 若 `state=awaiting_approval`，切换到 `approval` 卡等待用户点击，未批准不调用模型。
5. 终态后 handler resolve 摘要与结构化结果，模型基于**后端返回的数据**生成一句话结论。
6. SSE 中断时按 1s→1.5×→3s 退避轮询 `GET /api/job/<id>`。

## 8. 后端契约

复用现有接口，不新增字段：`/api/health|settings|models|cases|explain|case/<id>|run|job/<id>|job/<id>/stream|
job/<id>/approve|metrics|runs|conversations*`，以及 `/data/*`、`/results/*` 静态快照。

对话意图由 CopilotKit runtime 直接处理（模型决定调用哪个 action），`/api/chat` 不再被新前端使用，
仅保留给旧页面与回退；迁移完成后可评估是否下线。Python 服务继续负责静态数据与快照，
但不再托管 UI（`/web/` 在迁移完成后删除）。

## 9. 测试与验收

- Python：现有 `py -3.12 -m pytest -q` 必须保持全绿（当前 62 项）。
- 前端：`npm run build`（含 `tsc --noEmit`）通过。
- Playwright E2E（`webapp/e2e`）：
  1. dry-run 跑 6.7.1.3，看到 `run` 卡走到 score，判定为 pass；
  2. HITL 取消：出现 `approval` 卡 → 点取消 → 结果为 canceled 且文案不含"通过"；
  3. 弃权用例 6.7.1.4 → `abstain` 卡、不计分；
  4. `/api/settings` 与 `/data/secret.bin` 前端不可达。
- 演示路径（DEMO-SCRIPT）按新 IA 重写。

## 10. 风险与回退

| 风险 | 处置 |
|---|---|
| AnthropicAdapter 对代理流式格式有额外要求 | 已验证 SSE + tool delta；不一致时改用 OpenAIAdapter 或 LangGraph 远程 agent |
| Next 16 / React 19 与旧组件冲突 | 降 Next 15（仍支持 App Router） |
| 演示机无 Node 或装不进依赖 | `webapp/node_modules` 本地预装、不入库；`start.bat` 检测缺失时给出明确提示 |
| 双进程启动复杂 | `start.bat` 先起 Python :8000，再起 Next :3000，任一失败即提示 |
| 迁移期间两套前端并存 | `app/` 冻结不再改，仅 `webapp/` 迭代；对齐后一次删除 |

## 11. 未决问题

- 演示机是否允许运行 `npm install`（离线/网络受限时的影响）——按"预装 node_modules"处理。
- 模型名是否固定 `claude-sonnet-4-6[1M]` 还是跟随 `/api/settings` 的用户选择——初版固定，设置页改动不影响 copilot runtime。
