# Benchmark v0（NTN 测试意图）

## 来源
3GPP TS 38.523-1 v19.6.0 §6.7 Non-Terrestrial Network，共 14 个用例，选 8 个。
规范正文不入库（见 ADR-0003），本地由 `tools/extract_cases.py` 从官方 PDF 文本生成。

## 复现
```
# 1. 从 ETSI 下载（公开）
#    https://www.etsi.org/deliver/etsi_ts/138500_138599/13852301/19.06.00_60/ts_13852301v190600p.pdf
pdftotext -layout ts_13852301v190600p.pdf v19.txt
# 2. 切分
python tools/extract_cases.py v19.txt data/benchmark/v0
```

## Schema
```json
{
  "case_id": "6.7.1.3",
  "title": "...",
  "inputs":  { "test_purpose", "conformance_requirements", "pre_test_conditions" },
  "answers": { "test_procedure_sequence", "specific_message_contents" },
  "source":  { "spec", "section" }
}
```
评测时**只把 `inputs` 给系统**，`answers` 用于比对（ADR-0002）。

## 选样与切分
按过程类型取样，避免同族重复：

| case | 过程 | 输入字数 | 答案字数 | 信令表 |
|---|---|---|---|---|
| 6.7.1.1 | Cell Selection / GNSS location | 10999 | 1195 | **无（None）** |
| 6.7.1.2 | Cell Selection / MultiTAC | 3351 | 4331 | 有 |
| 6.7.1.3 | Cell Selection / 服务小区不可用 | 6327 | 3338 | 有 |
| 6.7.1.4 | PLMN selection / 周期重选 | 9270 | 5426 | 有 |
| 6.7.1.5 | 重选 Sintrasearch / 位置触发 | 7851 | 6348 | 有 |
| 6.7.1.6 | 重选 Sintrasearch / 时间触发 | 5443 | 8989 | 有 |
| 6.7.1.10 | 重选 / TN 测量跳过 | 2833 | 4004 | 有 |
| 6.7.1.12 | 跨 RAT E-UTRA TN → NR NTN | 11035 | 12170 | 有 |

**dev / test 切分**（防 prompt 调参泄漏，必须在方案中披露）：
- dev：6.7.1.1、6.7.1.2、6.7.1.3、6.7.1.10
- test：6.7.1.4、6.7.1.5、6.7.1.6、6.7.1.12

## 已知限制
1. **6.7.1.1 无 specific message contents（原文写 None）**，不计入 L3 指标，L3 分母为 7。
2. 步骤表必须用 **pdfplumber 按坐标**提取；`pdftotext -layout` 的文本流会丢失方向箭头（实测 8 例仅 16 个箭头）。文本层只用于 TP 与条款。
3. **L2 基准很薄**：全库 59 个步骤中仅 **16 个**「方向+消息」交换，单例 0–4 个，6.7.1.5 为 0。故 L2 **退出计分**，只做定性并排展示（见 ADR-0004）。
4. 样本量 8，**不报平均数**，只报逐例矩阵（见基线）。
5. 官方答案侧规模（修订后）：**59 步 / 16 个交换 / 25 张信令表 / 42 个叶子字段**。早前记录的 116 步、33 交换、166 字段系跨用例污染所致，已废弃。

## 提取工具链
| 脚本 | 作用 | 依赖 |
|---|---|---|
| `tools/extract_cases.py` | 从 `pdftotext -layout` 文本切出用例五段结构 | 纯标准库 |
| `tools/ir.py` | 确定性解析 Test Purpose（with/when/then） | 纯标准库 |
| `tools/pdf_steps.py` | 按坐标提取 Main behaviour 表 | pdfplumber（Python 3.12） |



## 度量口径（最终，2026-10-29 裁定）

- gold 叶子字段 **42**：.10=2 / .12=14 / .2=4 / .3=3 / .4=3 / .5=7 / .6=9（.1 原文 None，不计）
- 去重键 = (消息, 字段名, 归一取值)；同一字段的 GSO/NGSO 条件取值不重复计数（如需更严口径可另报 condition-level recall，本次不报）
- 分母：L1 = 8 例；L3 = 7 例；基线 L3 = **N/A**（基线不产出结构化 IE，0 个字段）

### 口径变更史（自我更正记录）
1. 166 → 42：剔除 SEQUENCE/CHOICE 容器与类型定义行，只保留有取值的叶子字段
2. 104 → 42：叶子过滤回归（此前误把容器名计入）
3. 基线 L3 由词袋虚高（如 0.308）改为 **N/A**：词袋在任何英文词上都会命中，不是 IE 命中
