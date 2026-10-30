# 架构与文件所有权

## 目录职责
```
tools/     核心链路（唯一入口，纯 Python，无 Web 框架）
docs/      决策与报告（ADR、基线、评测定义）
docs/writing/  方案书/简介/视频脚本草稿（只放文字产出）
scripts/   复现与环境脚本（一键跑通）
data/      运行产物（不入库）
```

## 依赖方向（单向，禁止反向）
```
benchmark(规范PDF) → ctx(裁剪后上下文) → generate/baseline → out(IR)
                                        → validate(校验器) → score(评分)
```
- `validate` **只读 IR 与符号表**，不读自然语言、不调模型（ADR-0002 的底线）。
- `score` 只读 `out/` 与 gold（`data/ir/*`），不修改任何输入。
- `llm` 是对外唯一模型入口，三通道（proxy/openai/anthropic），上层不得直接发 HTTP。

## 接口契约（改动须先改本文件）
| 模块 | 契约 |
|---|---|
| `llm.complete(messages, temperature, max_tokens) -> str` | 返回纯文本；内部过滤 thinking、剥 ```json 围栏；结果附带实际模型名 |
| `validate` | 输出 `{case_id, violations:[{rule, path, detail}]}`，rule ∈ R1/R2/R3 |
| `score` | 输出逐例矩阵 `[{case, L1, L3, gold_ie, pred_ie, ...}]` + `l2_qualitative.json`；**不输出均值** |

## 智能体运行时（当前实现）

```
自然语言输入
  → 意图层 /api/chat
      工作记忆：最近 8 轮 + 会话状态（active_case / last_job_id / last_verdict）
      LLM 只做两件事：选用例（run）或自然引导（reply）
  → 用例解析
      本地精确命中 → 直接跑；LLM 语义命中 → HITL 确认卡；无法确定 → 引导
  → 运行层 /api/run
      同会话单任务（409）、全局并发 4（429）、job 落盘 data/jobs/<id>.json
  → 六阶段 worker（子进程）
      ingest → context → candidates → generate → validate → score
  → 校验闸门（确定性）
      pass / reject / abstain；LLM 不参与裁决
  → 证据束
      条款原文、符号表路径、gold 命中、违规、LLM 解读
  → 输出与记忆写回
      conversation messages + state、runs.jsonl、/api/metrics
```

**状态机**：`queued → running → done | failed`。进程重启时 `running/queued` 一律标记
`failed(error=restarted)`；前端凭 `sessionStorage` 的 job 锚点重连 SSE 或回退轮询。

**工作记忆**（有界、可审计）：
| 层 | 内容 | 位置 | 用途 |
|---|---|---|---|
| 工作记忆 | 最近 8 条消息 + active_case/last_job/last_verdict | `data/conversations/*.json` 的 `state` | 消解“它/刚才那个/再跑一次” |
| 情节记忆 | 会话、job、运行历史 | `conversations/`、`jobs/`、`runs.jsonl` | 按 case/job 精确检索 |
| 语义记忆 | ctx/out/gold/符号表 | `data/`、`results/` | 事实来源，按 key 取，不做向量检索 |
| 偏好记忆 | provider/model/temperature | `data/settings.json` + `data/secret.bin` | 复现实验口径 |

**不变量**
1. LLM 只提案，校验器裁决；任何“通过”必须由确定性规则给出。
2. 每一句解释必须能指回 artifact（条款/字段路径/gold/违规）。
3. 信息不足允许弃权；弃权不是失败，不计 0 分。
4. 工作记忆有界（8 轮 / 单条 300 字），不写入密钥与规范原文。
5. 任务状态落盘，重启可查、可恢复、可标记中断。
6. API Key 不写明文：DPAPI/keyring → 环境变量 → 旧配置兜底。

## 文件所有权（并行作业边界）

| 范围 | 独占文件 | 说明 |
|---|---|---|
| 算法链路 | `tools/`、`data/` 产物 | 六阶段与校验器；改动同步 `EVAL.md`/`BENCHMARK.md` |
| 运行时 | `scripts/serve.py`、`scripts/secret_store.py`、`scripts/run_one.py` | 任务/API/密钥；改动同步 `WEB-SPEC.md` |
| 前端 | `app/src`、`app/public`、`web/`（构建产物） | 视图与交互；构建由主线程统一执行 |
| 测试与快照 | `tests/`、`results/`、`.github/` | 可复现性证据 |

跨范围改动先改本文件；并行 agent 不得同时改同一文件。

## 数据契约（`data/score/`，改动须同步使用方）

`report.json`（数组，逐例）：
| 字段 | 含义 |
|---|---|
| `case` / `status` | 用例号 / `generated` 或 `abstained` |
| `calls` | 该例模型调用次数（弃权必为 0） |
| `L1` / `L1_base` | 结构合法率（0–1） |
| `L3_recall` | 数字、`null`（该例无 gold）或字符串 `abstained` |
| `L3_base` | 恒为 `null`（基线不产出结构化 IE，不可计） |
| `gold_ie_n` | gold **叶子字段**数（合计 42） |

`abstain.json`（数组，逐例）：
| 字段 | 含义 |
|---|---|
| `in_msg` | 输入侧抽到的消息名数量（0 则必然弃权） |
| `calls` / `sys_ies` | 系统调用数 / 产出的 IE 条数 |
| `base_status` | `prose`（基线输出了散文）或 `absent` |
| `base_chars` / `base_ies` | 基线散文字数 / 结构化 IE 数（恒 0） |
| `gold_ies` | 同 `gold_ie_n`，**必须由同一函数计算** |

一致性由 `tools/check_consistency.py` 强制（gold 合计、逐例 gold、逐例 calls）。

## 全局禁令
1. 规范原文与切分结果不入库（ADR-0003）。
2. 不得编造数字；拿不到就写“未获取”。
3. 不提交密钥、`data/` 运行产物；`results/` 快照入库。
4. 不新增第三方依赖（已装 pdfplumber；dev 依赖 pytest）。
