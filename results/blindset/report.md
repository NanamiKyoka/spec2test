# 真实错误集盲测（19 条核心错误）

来源：真实模型输出，非注入模板。标注在运行前固定。

| 口径 | 检出 | 漏检 | 检出率 | 范围内 | 范围外 |
|---|---|---|---|---|---|
| 旧校验器 | 2 | 17 | 10% | 2/16 | 0/3 |
| 当前校验器 | 16 | 3 | 84% | 16/16 | 0/3 |

## 逐条

| id | 用例 | 位置 | 错误 | 规则 | 范围 | 旧 | 新 |
|---|---|---|---|---|---|---|---|
| B01 | 6.7.1.10 | `steps[7].message` | 把状态描述 RRC_IDLE on TN NR Cell 10 当作 RRC 消息名 | R1 | 内 | ✓ | ✓ |
| B02 | 6.7.1.10 | `steps[1].message` | 把 System Information (SIB25..., SIB4...) 这段说明文字当作消息名 | R1 | 内 | ✗ | ✓ |
| B03 | 6.7.1.10 | `steps[3].message` | 把配置动作 TN NR Cell 10 configured with... 当作消息名 | R1 | 内 | ✗ | ✓ |
| B04 | 6.7.1.10 | `steps[4].message` | 把排名变化描述 TN NR Cell 10 becomes higher ranked... 当作消息名 | R1 | 内 | ✗ | ✓ |
| B05 | 6.7.1.10 | `steps[6].message` | 把重选动作 Cell reselection to TN NR Cell 10 当作消息名 | R1 | 内 | ✗ | ✓ |
| B06 | 6.7.1.12 | `steps[1].message` | E-UTRA SIB1 不是 ASN.1 消息名（应为 SystemInformationBlockType1 或 SI 承载） | R1 | 内 | ✗ | ✓ |
| B07 | 6.7.1.12 | `steps[2].message` | E-UTRA SIB3 不是 ASN.1 消息名 | R1 | 内 | ✗ | ✓ |
| B08 | 6.7.1.12 | `steps[3].message` | E-UTRA SIB24 不是 ASN.1 消息名 | R1 | 内 | ✗ | ✓ |
| B09 | 6.7.1.12 | `steps[4].message` | NR SIB1 不是 ASN.1 消息名（应为 SIB1 或 SystemInformationBlockType1） | R1 | 内 | ✗ | ✓ |
| B10 | 6.7.1.2 | `steps[3].message` | 把 IE 字段名 trackingAreaList 当作消息名 | R1 | 内 | ✗ | ✓ |
| B11 | 6.7.1.10 | `messages[SIB4].ies[1].name` | freqBandIndicatorNR 属于 SIB1 的 frequencyBandList，不属于 SIB4 | R2 | 内 | ✗ | ✓ |
| B12 | 6.7.1.10 | `messages[SIB4].ies[3].name` | tn-AreaIdList 不是 SIB4 的 ASN.1 字段名（应为 tn-AreaIdList-r18） | R2 | 内 | ✗ | ✓ |
| B13 | 6.7.1.10 | `messages[SIB25].ies[0].name` | coverageAreaInfoList 不是 SIB25 的 ASN.1 字段名（应为 coverageAreaInfoList-r18） | R2 | 内 | ✗ | ✓ |
| B14 | 6.7.1.10 | `messages[SIB25].ies[1].name` | tn-DistanceRadius 不是 SIB25 的 ASN.1 字段名（应为 tn-DistanceRadius-r18） | R2 | 内 | ✗ | ✓ |
| B15 | 6.7.1.6 | `messages[SIB19].ies[1].name` | cellReferenceLocation 不是 SIB19 的字段（应为 referenceLocation-r17） | R2 | 内 | ✓ | ✓ |
| B16 | 6.7.1.5 | `messages[SIB2].ies[4].name` | distanceThresh-r17 属于 SIB19，不属于 SIB2 | R2 | 内 | ✗ | ✓ |
| B17 | 6.7.1.10 | `steps[3..6].direction` | direction 取值 N/A，IR 只允许 S->U / U->S / none | - | 外 | ✗ | ✗ |
| B18 | 6.7.1.10 | `steps[7].message` | Paging 出现在 SIB25/SIB4 配置之后；gold 在 step 2 先发 Paging 通知系统信息变更 | - | 外 | ✗ | ✗ |
| B19 | 6.7.1.5 | `messages（缺失）` | 缺少 SIB4（gold 含 dl-CarrierFreq 与 cellReselectionPriority） | - | 外 | ✗ | ✗ |

## 边界样本（不计入核心 19 条）

| id | 用例 | 错误 | 新 | 说明 |
|---|---|---|---|---|
| E01 | 6.7.1.10 | ue-Identity 只能出现在 PagingRecord 内，不能作为 Paging 顶层 IE | ✗ | 符号表把嵌套字段拍平，当前 R2 无法区分顶层/嵌套；记为已知漏检。 |
| E02 | 6.7.1.12 | ntn-Config 属于 SIB19，不属于 SIB1 | ✓ | 消息名 NR SIB1 本身被 R1 拒收；字段级 R2 未运行。整条输出被拒，但字段错位未被单独指出。 |

## 读法

- 范围内 = R1/R2/R3 声明覆盖的错误；范围外 = 方向、顺序、完整性等未声明检查。
- 旧校验器 = 改动前的 R1 前缀守卫 + R2 精确名/全局集合；当前校验器 = 本次改动后。
- 漏检不隐藏：范围外漏检在表中逐条列出。
