# 中间表示（IR）

生成的产物不是散文，而是结构化 IR。**生成器和校验器操作同一个 IR**，这是"能自证"的前提。

## 结构

```jsonc
{
  "case_id": "6.7.1.3",
  "tp": [                       // 测试目的，原文即准形式化，由确定性解析器产出
    { "index": 1, "given": "…", "when": "…", "then": "…" }
  ],
  "preconditions": {
    "cells": ["NR Cell 1"],     // 前置条件里声明的仿真器配置
    "refs": ["TS 38.508-1 Table 4.4.2.1"],
    "notes": "…"
  },
  "steps": [                    // 语义层：谁做了什么，不绑定具体消息文本
    { "st": 1, "actor": "SS", "action": "transmit", "message": "SIB19",
      "direction": "S->U", "tp_ref": [1, 2] },
    { "st": 2, "actor": "UE", "action": "expect",   "message": "(PRACH Preamble)",
      "direction": "U->S", "tp_ref": [2] }
  ],
  "messages": [                 // 信令层：具体 IE 取值，来自"模板+差分"
    { "step": 1, "message": "SIB19", "table_ref": "Table 6.7.1.3.3.3-1",
      "derivation_path": "TS 38.331 clause 6.3.2",
      "ies": [ { "name": "ntn-Config-r17", "value": "…", "condition": "NTN" } ] }
  ]
}
```

## 为什么这样切

| 层 | 谁校验 | 规则（确定性，非 LLM） |
|---|---|---|
| `tp` | 解析器 | 原文结构固定，`with/ensure that/when/then` 可直接括号匹配 |
| `steps` | **覆盖检查** | 每条 `then` 必须被至少一个 `actor=UE` 的期望步骤覆盖；方向必须与 actor 一致 |
| `messages` | **符号表** | `message` 必须是 RRC 消息名；`ies[].name` 必须存在于该消息的 ASN.1 字段路径下 |

## 硬约束
1. IR 由生成器产出，但**校验器只读 IR**，不读自然语言——否则又变成 LLM 自评。
2. `tp_ref` 把每个步骤绑回 TP 条目，这是"覆盖检查"能自动化的唯一依据。
3. 缺字段用 `null`，**不猜**。猜出来的值会被符号表打回。
