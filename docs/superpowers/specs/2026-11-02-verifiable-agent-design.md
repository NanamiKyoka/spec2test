# 可验证智能体改造设计（2026-11-02）

状态：已逐项确认，待实现
上一版：`docs/superpowers/specs/2026-11-01-copilotkit-frontend-redesign.md`（前端与 CopilotKit 接入，已完成）

## 1. 背景与问题

现状是「模型嵌在固定六阶段的 generate 格子里」：输入用例 → 跑一遍 → 给一个输出。
评委看到的是脚本，体现不出模型、工具、技能之间的编排关系，也看不到智能体的决策。

目标：**模型负责提议与修复，确定性规则一票判定**；把工程特有的参数外置到对话里由人选；
把阶段能力做成工具（HTTP + MCP），让编排过程可见、可审计、可对照。

## 2. 已确认的决策

| 决策点 | 选择 |
|---|---|
| 智能体层级 | 编排层：模型决定下一步做什么，规则只判对错 |
| 工具粒度 | 阶段级：六阶段拆成可调用工具，可跳过/重试 |
| 工具形态 | 双轨：HTTP 工具 API（供 UI）+ MCP server（供外部/评委），共用同一实现 |
| 创新主线 | 可验证智能体 |
| 创新点结构 | 判定架构 + 自诊断闭环 + 边界（弃权/证据链） |
| HITL 参数 | 候选消息、生成范围、修复策略、校验严格度 |
| 参数传递 | 审批文件从 `{decision}` 扩展为 `{decision, options}` |
| 参数 UI | 输入框「+」菜单（CopilotChat 自定义 `Input` 组件），选中项以 chip 显示 |
| 参数生效 | 前端 store 直传 `run_case`，不经过模型，避免丢参/幻觉 |
| 证明指标 | 修复增益、编排消融、决策轨迹 |
| 实施顺序 | 参数外置 + 编排 → 修复闭环 + 指标 → MCP + 技能 |

## 3. 对外创新点（三条）

1. **判定架构：规则即工具，模型不能自证。**
   模型自由编排生成与修复，但通过与否由确定性校验器（R1/R2/R3）一票判定；
   校验器自身异常按 R0 拒收（fail-closed），不存在“模型说自己对就算对”。
   可证产物：`tools/validate.py`、`results/validate/*`、31/31 缺陷注入与 0/8 官方答案误报。
2. **自诊断修复闭环。**
   校验失败后，模型读取违规清单，定向重修失败消息并再次校验；修复前后的 L1/L3/违规数可对比。
   可证产物：同一用例「一次生成 vs 修复后」的 A/B 结果与调用次数。
3. **边界：证据不足主动弃权，结论可回指。**
   输入没有可识别消息名时不调用模型、不计分；每条判定可回指符号表路径与违规位置。
   可证产物：`data/out_rejected`、弃权样本 6.7.1.4、字段级证据页。

## 4. 架构

```
浏览器
  ├─ CustomInput「+」参数菜单 ──> runParams store ──┐
  ├─ CopilotChat（消息/卡片/分析窗）                │
  └─ run_case action ───────────────────────────────┤
                                                     ▼
Next /api/copilotkit（CopilotKit runtime）
  └─ tools 调用（HTTP）──> Python :8000 /api/tools/<name>
                              └─ 与 MCP server 共用同一套实现
```

- 工具层：Python 实现，纯函数 + 文件读写；不依赖前端状态。
- HTTP：`POST /api/tools/<name>`，统一返回 `{ok, data|error}`。
- MCP：同一批函数的 JSON-RPC 包装（`tools/list`、`tools/call`），先只读工具。
- 前端：自定义输入组件 + 参数 store + action 读取参数 + trace 面板展示工具调用序列。

## 5. 数据结构

运行参数（前端 store 与 `/api/run` 共用）：

```ts
type RunOptions = {
  messages?: string[];              // 选中的候选消息；空/缺省=全选
  mode?: "steps" | "full" | "repair_only"; // 默认 full
  repairs?: 0 | 1 | number;         // 修复轮数，默认 1
  strictness?: "strict" | "skip_lte_r2" | "r1_only"; // 默认 strict
};
```

审批文件（`data/jobs/<job>.approval`）：

```json
{"decision": "approve", "options": {"messages": ["SIB19"], "mode": "full", "repairs": 1, "strictness": "strict"}}
```

`/api/run` 请求体扩展：`{case, instruction?, conversation_id?, hitl?, dry_run?, options?}`。

## 6. 阶段级工具

| 工具 | 输入 | 输出 | 调模型 |
|---|---|---|---|
| `prepare_case` | case | 切片、TP、上下文摘要 | 否 |
| `list_candidates` | case | 候选消息列表 | 否 |
| `generate_steps` | case / 上下文 | 步骤序列 | 是 |
| `generate_ies` | 步骤 + 候选消息（可筛选） | 每条消息的 IE | 是 |
| `validate_intent` | IR + strictness | R1/R2/R3 违规 | 否 |
| `repair_intent` | IR + 违规 + repairs | 修复后的 IR | 是 |
| `compare_gold` | case + IR | L1/L3/与 gold 的差异 | 否 |
| `export_intent` | IR | JSON / Markdown | 否 |

约束：`compare_gold` 只在评测时可用，运行时不暴露给模型，避免“看答案”。

## 7. HITL 交互

- 输入框左侧「+」菜单，分组：
  - 生成：候选消息（多选）、生成范围（仅步骤 / 步骤+IE / 只重修）
  - 校验：严格度（严格 / 跳过 LTE R2 / 只查 R1）
  - 修复：轮数（不修 / 1 轮 / 到通过上限 N）
  - 技能、连接器：先做灰置占位，MCP 接入后启用
- 选中项在输入框上方以 chip 显示，可移除；默认值与后端一致。
- 审批卡展示本次参数摘要（消息数、范围、修复轮数、严格度），批准后按参数执行。
- 参数只影响执行，不进入对话正文；模型只负责选用例与解释结果。

## 8. 证明不是脚本

| 指标 | 方法 | 样本 |
|---|---|---|
| 修复增益 | 同一用例：一次性生成 vs 自诊断修复后的 L1/L3/违规数 | 8 例，各两种模式 |
| 编排消融 | 固定管线 vs 模型自由编排：耗时、模型调用数、成功率、弃权率 | 8 例 × 2 组 |
| 决策轨迹 | 工具调用序列、重修次数、弃权原因，进 trace 面板 | 演示用例 2–3 个 |

## 9. 实施顺序

1. **Phase 1（1–4 天）**：阶段工具 HTTP 化；CopilotChat 自定义 Input + 「+」菜单 + 参数 store；
   `/api/run` 与审批文件带 options；`run_one` 应用 mode/repairs/strictness/messages；trace 展示工具调用。
2. **Phase 2（5–8 天）**：自诊断修复闭环；修复增益 A/B 脚本；编排消融脚本。
3. **Phase 3（9–12 天）**：MCP server（只读工具先行）；2–3 个技能沉淀；连接器占位启用。
4. **Phase 4（13–16 天）**：三条创新点文案与图；演示脚本；回归（pytest / vitest / e2e）。

## 10. 风险与回退

- CopilotChat 自定义 Input 与库升级冲突 → 保留默认输入组件开关，出问题切回。
- 自由编排导致质量下降 → 保留「一键跑完」兜底，并作为消融对照组。
- 参数不生效 → 审批文件与 `/api/run` 加契约测试（options 逐项断言）。
- MCP 调试成本 → 先只读工具（prepare/list/validate/compare），写操作后置。
- 成本与时长 → 默认 `dry_run` 用于演示编排，真实模型跑批单独开关。

## 11. 未决

- 技能库先放哪 2–3 个（候选：SIB19 必带字段、TP 引用修复、跨消息字段判定）。
- 弃权质量是否需要人工标注集（当前只有 6.7.1.4 一个弃权样本）。
- 工具调用是否全部落盘为审计日志（建议落 `data/trace/`，供导出）。
- MCP 传输方式（stdio 还是 SSE/HTTP）取决于评委侧怎么验证。

## 12. 实施状态（2026-11-02）

**Phase 1 已完成**
- 阶段工具 HTTP 化：`tools/stage_tools.py`；`GET/POST /api/tools[...]`、`GET /api/trace/tools`，每次调用落 `data/trace/tools.jsonl`。
- 运行参数：`RunOptions` 贯穿「+」菜单 → store → `/api/run` → 审批文件 → `run_one`；`--mode` / `--repairs` / `--strictness` / `--messages` 生效。
- UI：`ChatInput` 自定义输入框与参数 chip、审批卡候选多选与摘要、RunCard 参数标记、TracePanel 工具调用区。

**Phase 2 已完成**
- 修复闭环：`repair_step`（R1/R3 步骤层 + R2 字段层）与 `repair_intent`（多轮、无进展即停）；`run_one` 逐轮发 `repair` 事件。
- A/B：`scripts/ab_repair.py`（用例两组 + 缺陷注入受控两组）；`scripts/orchestrate.py` 自由编排；`scripts/ab_orchestration.py` 消融对照。
- 口径：自由编排缺步骤或缺字段判 `incomplete`（失败），不得算通过；`generate_ies` 不再静默复用历史产物。

**Phase 3 已完成**
- MCP server：`scripts/mcp_server.py`（stdio / JSON-RPC 2.0），默认只读工具，`--allow-model` 才放开生成类；
  `compare_gold` 不通过 MCP 暴露；配置与协议说明见 `docs/MCP.md`。
- 技能沉淀：`skills/` 三份（SIB19 必带字段、TP 引用修复、跨消息字段判定）；
  `list_skills` / `use_skill` 同时进入 HTTP 工具与 MCP 工具；前端新增 `use_skill` 对话动作与技能卡。
- 连接器占位启用：输入框「+」菜单显示技能清单与「MCP 连接器 · N 个只读工具」，数据来自 `/api/skills` 与 `/api/tools`。

**Phase 4 已完成**
- 关于页重写：问题 → 智能体结构图 → 三条可验证点 → 六阶段与工具 → 判定与证据链 → 指标 → 局限 → 6G → 复现。
- 演示脚本 `docs/DEMO.md`：6 分钟路线、评委常问、模型通道不可用时的兜底。
- 侧栏精简：移除用例栏与最近运行，只保留会话列表；对话结果经 `/api/runs` 的 L1/L3/违规数进入数据页，并有 e2e 回归。
- 技能与连接器改为可勾选：`RunOptions.skills` 随修复提示带入，`mcpTools` 未勾选的只读工具会被助手拒绝调用。
- 全量回归：pytest 105、vitest 9、e2e 8。
- 结果快照：`results/ab/`。缺陷全量修复增益 31 条：23 条归零、3 条减少、5 条未变（R1 未变 3 条属能力边界）。

## 13. 后续增量（2026-11-02）

- 「+」菜单新增「编排方式」：`pipeline`（固定六阶段）与 `agent`（模型自选工具顺序，预算 8 次）；
  `agent` 由 `scripts/orchestrate.py` 在任务管线里执行，事件落到 `agent`/`score` 两个阶段，
  `/data` 与运行卡可直接读判定与 L1/L3；`dry_run` 强制回落 `pipeline`，`agent + hitl` 返回 400。
- 实测：6.7.1.3 以 `agent` 跑通，4 次工具调用后判 pass、L1/L3=1.0；全量消融见 `results/ab/orchestration.md`。
- 决策轨迹按任务归档：子进程带 `SPEC2TEST_JOB`，工具调用写入 `data/trace/tools.jsonl` 时带上 job；
  `GET /api/trace/tools?job=<id>` 只返回该任务的调用，trace 面板优先展示「本次运行」，没有记录时回落到最近调用。
