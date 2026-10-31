# 前端规格（全链条智能体流程）

目标：让评委在浏览器里看到**一条完整的智能体链路**，而不是一堆静态数字。

## 新增 API（v2，对话管理 / 模型列表 / 运行历史）

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/models` | query: `provider`,`base_url`,`api_key?` | `{models:[str], source:"live"\|"catalog"\|"error", note?}` |
| GET | `/api/conversations` | — | `[{id,title,updated,turns,last_case}]`，按 `updated` 倒序 |
| POST | `/api/conversations` | `{title?}` | `{id,title,created}` |
| GET | `/api/conversations/<id>` | — | `{id,title,created,updated,messages:[{role,content,at,job_id?,case?,stages?,verdict?,L1?,L3?,status?}]}`；`verdict ∈ pass\|reject\|abstained\|canceled` |
| PATCH | `/api/conversations/<id>` | `{title}` | `{ok}` |
| DELETE | `/api/conversations/<id>` | — | `{ok}` |
| POST | `/api/conversations/<id>/messages` | `{role,content}` | `{ok,at}` |
| GET | `/api/runs` | query: `limit`(默认20) | `[{job_id,case,state,verdict,started,finished,seconds}]` |

**模型列表语义**
- `openai`：`GET {base_url}/models`（Bearer）；`anthropic`：`GET {base_url}/v1/models`（`x-api-key` + `anthropic-version`）。
- `proxy`：本地代理的 `/v1/models` 返回空数组，**不要报错**；`source=catalog` 并返回内置目录 `["claude-sonnet-4-6[1M]","claude-opus-4-8[1M]","claude-haiku-4-5"]`，`note` 说明"本地代理不支持枚举，显示内置目录"。
- 调用失败 → `source="error"`，`models=[]`，`note` 带原因；**不得抛 500**。

**会话存储**：`data/conversations/<id>.json`（已在 `.gitignore` 的 `data/` 内）；`id` 为 8 位十六进制。**API Key 绝不写入会话文件**。

**`/api/run` 扩展**：`{case, instruction?, conversation_id?, hitl?, dry_run?}`；若带 `conversation_id`，任务完成后把一条 `role=assistant` 的摘要消息追加到该会话（含 `job_id`、`case`、`verdict`、`stages`）。`hitl=true` 时在 `candidates` 之后暂停等待审批（见下）；`dry_run=true` 走确定性桩，不调用模型。

## 页面与路由
| 路由 | 文件 | 内容 |
|---|---|---|
| `/web/` | `web/index.html` | 概览：逐例矩阵 + 弃权 vs 无依据对照 |
| `/web/case.html?case=6.7.1.3` | `web/case.html` | 单例全链条：六个阶段的输入/输出/耗时/状态 |
| `/web/chat.html` | `web/chat.html` | **对话式智能体**：自然语言 → 定位用例 → 六阶段 → 结论/拒收 |
| `/web/settings.html` | `web/settings.html` | **设置**：模型通道、Base URL、模型名、温度、API Key（可写不可读） |

所有页面顶部共用导航：`概览 · 对话 · 设置`（当前页高亮）。**规范标记（三个页面必须逐字一致，由 H4 提供样式）**：

```html
<nav class="topnav">
  <a href="./index.html">数据</a>
  <a href="./chat.html">对话</a>
  <a href="./settings.html">API</a>
</nav>
```

当前页由 JS 或服务端给对应 `<a>` 加 `aria-current="page"`；`style.css` 中 `.topnav` 与 `.topnav a[aria-current="page"]` 的样式由 H4 统一定义，H2/H3 不得自定义。

## 后端 API（`scripts/serve.py`）
| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/health` | — | `{ok, python, provider, model, data_source:"live"\|"snapshot"}` |
| GET | `/api/settings` | — | `{provider, base_url, model, temperature, key_set:bool, key_masked:"sk-…abcd"}`（**永不返回明文**） |
| POST | `/api/settings` | `{provider, base_url, model, temperature, api_key?}` | `{ok}`；`api_key` 缺省则不覆盖旧值 |
| POST | `/api/test` | `{provider?, base_url?, model?, api_key?}` | `{ok, latency_ms, model_seen, error?}`（发一次最小请求） |
| GET | `/api/cases` | — | `[{case, title, status, gold_ies}]` |
| GET | `/api/case/<id>` | — | `{stages:[{stage, status, summary, detail}]}`，stage 顺序固定见上表 |
| POST | `/api/run` | `{case, instruction?, conversation_id?, hitl?, dry_run?}` | `{job_id}`；`hitl=true` 时候选阶段后暂停等审批。错误码：`400`（缺/未知 case、无凭据）、`404`（会话不存在）、`409`（同会话已有任务）、`429`（全局并发已满） |
| GET | `/api/job/<id>` | — | `{state:"queued\|running\|awaiting_approval\|done\|failed", stage, log:[{t,msg}], approval?, verdict?:"pass\|reject\|abstained\|canceled", result?}` |
| GET | `/api/job/<id>/stream` | — | SSE，`data: <整份 Job JSON>`；任务进入 `done\|failed` 后关闭；断开时前端回退轮询 |
| POST | `/api/job/<id>/approve` | `{decision:"approve"\|"reject"}` | `{ok}`；仅 `awaiting_approval` 可审批，否则 `409`；`approve` → `running`，`reject`/超时 → `state=done`、`verdict=canceled`，**不调用模型** |
| POST | `/api/chat` | `{message, conversation_id?}` | `{action:"run"\|"reply", case?, say, model?, source:"llm"\|"fallback"\|"timeout"\|"error"}`；意图识别失败不抛 5xx |
| GET | `/api/metrics` | — | `{runs_total, by_state, by_verdict, seconds_p50, seconds_p95, runs_last_24h, recent_failures}` |

**HITL 审批契约**：`POST /api/job/<id>/approve` 的 `decision` 只接受 `approve`/`reject`（否则 `400`）。`approve` 后任务回到 `running`；`reject` 或等待超时（默认 600s）都进入 `state=done`、`verdict=canceled`，后三阶段标记 `skipped`，**不发起任何模型调用**，也不写成 `failed`。前端凭 `awaiting_approval` 渲染审批卡，不自动批准。

**轮询语义**：无 SSE 或 SSE 断开时，前端轮询 `GET /api/job/<id>`——首次间隔 1s，按 1.5× 逐步退避，上限 3s；终态 `done\|failed` 停止。

**状态语义**：`stage ∈ ingest|context|candidates|generate|validate|score`；弃权时后三阶段为 `skipped`，`state=done`（**不是 failed**）。

## 设置与密钥规则（硬性）
1. 配置存 `data/settings.json`（已在 `.gitignore` 内），**不入库**；环境变量优先级低于该文件之外的显式配置时以文件为准。
2. **Key 只写不读**：`GET /api/settings` 只返回 `key_set` 与掩码（保留前 3 后 4）；任何日志、异常、页面都不得出现明文 Key。
3. Key 不得出现在 URL 查询串、不得写入 `data/score`、不得进入对话记录。
4. 写入后尽力 `chmod 600`（Windows 上退化为仅提示）。
5. 未配置 Key 时：`/api/run` 返回 `400 {error:"no_credential"}`，前端展示"去设置"链接，**不得静默失败**。

## 对话语义（`/web/chat.html`）
- 输入自由文本；后端按顺序解析：① 文本内出现的用例号（如 `6.7.1.3`）→ 直接定位；② 否则按标题/关键词在 `/api/cases` 里检索，命中唯一则用，多个则回问澄清，零个则明确说"未找到对应用例"。
- 定位后创建 job，前端按阶段流式展示（SSE 优先，轮询兜底）。
- 结束时的回复必须包含：结论一句话 + 校验结果（通过 / 违规条目 + 路径）+ 是否被拒收。
- **校验不通过时明确写"已拒收，未写入结果"**，不得把不合格产物当作成功展示。


## 六阶段（唯一权威定义，前后端共用）
| # | stage | 输入 | 输出 | 数据来源 |
|---|---|---|---|---|
| 1 | `ingest` | 规范 PDF | 用例五段结构 | `data/benchmark/v0/<case>.json` |
| 2 | `context` | inputs | 裁剪后上下文（字数、保留的条款号） | `data/ctx/<case>.json` |
| 3 | `candidates` | 上下文 | 候选消息清单（空 → 必须弃权） | `data/out/<case>.json` 的 `candidates` |
| 4 | `generate` | 上下文＋候选 | IR（steps + messages） | `data/out/<case>.json` |
| 5 | `validate` | IR＋符号表 | violations（R1/R2/R3） | `data/score` 或 `data/validate/report.json` |
| 6 | `score` | IR＋gold | L1 / L3 / 状态 | `data/score/report.json` |

**弃权是一条合法路径**：第 3 阶段候选为空 → 第 4–6 阶段标记为 `skipped(abstained)`，**不得显示为失败或 0 分**。

## 数据回落规则
- 静态根优先 `data/`，缺失时回落 `results/`（仓库自带快照）。
- 回落时页面顶部显示一行：「当前为仓库自带结果快照；运行 `scripts/repro.sh` 可生成你自己的结果」。
- **禁止**把 `undefined`、`null`、`NaN` 直接渲染到页面；一律显示 `—`，并 `console.warn` 一次。

## 可选：实时运行（live）
- 按钮「运行本用例」，调 `POST /api/run`，body `{"case":"6.7.1.3"}` → `{job_id}`；优先 `GET /api/job/<id>/stream`（SSE）接收整份 Job；SSE 不可用/断开时轮询 `GET /api/job/<id>`（1s 起、退避至 3s）→ `{state, stage, log[], started, finished}`；`state ∈ queued|running|awaiting_approval|done|failed`，`verdict ∈ pass|reject|abstained|canceled`。
- 不可用时（未检测到模型通道）按钮置灰，`title` 说明原因，**不得静默失败**。
- 运行结果写入 `data/out/<case>.json` 并刷新页面阶段视图。

## 硬约束
1. 零外链（`grep -c "http://\|https://" web/**` = 0）。
2. 无框架、无构建、无 npm 依赖；纯静态 + 标准库 `http.server`。
3. 服务根 = 仓库根（要能 fetch `data/`、`results/`）。
4. 任何异常必须在页面上可见（红字 + 原因），不许只有控制台。

## 文件所有权（并行作业边界）
| Owner | 文件 |
|---|---|
| **F1 后端** | `scripts/serve.py`（静态服务、`/api/*`、回落逻辑、任务执行器） |
| **F2 概览页** | `web/index.html`、`web/assets/style.css` |
| **F3 单例页** | `web/case.html`、`web/assets/case.js` |
| **C 启动与交付** | `start.bat`、`README.md`、`results/` |

`web/assets/style.css` 为两页共用，只由 F2 修改；F3 需要新样式时在 `case.js` 里内联，不得改 `style.css`。
