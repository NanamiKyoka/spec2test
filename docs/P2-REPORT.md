# P2 可验证性证据（对外）

## 三个数字

| 指标 | 结果 | 说明 |
|---|---|---|
| 校验器对**官方答案**误报 | **0 / 8** | 把规范原文的结构化答案喂给校验器，不报任何违规 |
| 校验器对**生成输出**误报 | **0 / 8** | 8 例生成结果全量校验，0 条假阳性 |
| 缺陷检出 | **31 / 31** | R1 8/8、R2 7/7、R3 16/16（修正 4 条无效注入后重跑） |

缺陷集为人工注入的 31 条错误（缺消息、伪造字段、TP 未覆盖等），每条标注期望触发的规则；检出按"是否命中该规则"计。

## 复现
```
python tools/validate.py data/gold_ir data/symbols/rrc_symbols.json data/validate/gold_ir_report.json
python tools/validate.py data/out     data/symbols/rrc_symbols.json data/validate/out_report.json
python tools/validate.py data/defects data/symbols/rrc_symbols.json data/validate/defects_report.json
python tools/test_normalize.py    # 归一层单测，8/8
```

## 已知限制
- 符号表为 **NR + LTE 混合**（15 个消息，其中 LTE 8 个，取自 TS 36.331），覆盖范围以入选用例为准，**非全量**。
- LTE 条目标记 `_partial`，仅用于 R1（消息存在性）；R2（字段合法性）对 LTE 消息跳过，避免用不完整字段集误判官方答案。
