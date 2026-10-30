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

## 文件所有权（并行作业边界）

| Owner | 独占范围 | 禁止触碰 |
|---|---|---|
| **A（核心链路）** | `tools/` 全部、`data/`、`docs/P1-REPORT.md`、`docs/P2-REPORT.md`、`docs/EVAL.md` | `docs/writing/`、`scripts/`、`README.md` |
| **B（方案写作）** | `docs/writing/` 全部 | `tools/`、`data/`、`docs/adr/`、任何数字 |
| **C（复现与环境）** | `README.md`、`requirements.txt`、`scripts/`、`web/`、`.gitignore` | `tools/`、`docs/writing/` |
| **D（外部证据）** | `docs/RESEARCH.md` | 其他全部 |

**跨 owner 修改一律禁止**；确需改契约，先改本文件并在报告里声明。

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
2. 不得编造数字；拿不到就写"未获取"。
3. 不 commit / 不 push / 不上传。
4. 不新增第三方依赖（已装 pdfplumber）。
