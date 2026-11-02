# A/B 实验快照

两组实验都走真实模型通道，逐例记录，不报质量平均数。重新生成：

```bash
py -3.12 scripts/ab_repair.py --defects data/defects --arms 0,1 --out data/ab/repair_defects.json
py -3.12 scripts/ab_orchestration.py --free-budget 8
```

| 文件 | 内容 |
|---|---|
| `repair_defects.md` / `.json` | 缺陷注入全量：同一份缺陷产物「不修 vs 修 1 轮」的前后违规数 |
| `sample_repair_3defects.md` | 抽样 3 条缺陷的对照（历史快照） |
| `orchestration.md` / `.json` | 固定六阶段管线 vs 模型自由编排：判定、L1/L3、模型调用数、耗时 |

读法：

- 判定与违规数来自确定性校验器；L3 只在生成字段时才有值，弃权或只生成步骤记为「—」。
- 修复轮数为 0 的那一行是「同一份产物不修」的对照，不是重新生成。
- 耗时受模型缓存影响：同一批次内可比，跨批次不可直接比较。
