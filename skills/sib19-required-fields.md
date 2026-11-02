---
name: sib19-required-fields
description: SIB19（NTN 邻区/服务小区信息）常用必带字段的判断与取舍，避免全量灌入符号表字段。
when: 用例的测试目的或一致性要求涉及卫星覆盖、服务时间、参考位置、距离门限，需要为 SIB19 生成 IE 时。
---

# SIB19 必带字段

## 判断顺序

1. 先读该用例的测试目的与一致性要求，找出与 SIB19 相关的触发词：
   `t-Service`（服务时间）、`referenceLocation`（参考位置）、`distanceThresh`（距离门限）、
   `movingReferenceLocation`（移动参考位置）、`ntn-Config`（NTN 配置）。
2. 每个触发词只对应它自己的叶子字段；没有出现的语义不要补。
3. 多个触发词同时出现时，按出现顺序全部带上；字段之间没有隐式依赖。

## 常见组合

- 覆盖/服务时间类：`t-Service-r17`、`referenceLocation-r17`
- 距离/重选门限类：`distanceThresh-r17`
- 移动平台（无人机/低轨移动）：`movingReferenceLocation-r18`
- 邻区列表类：`ntn-NeighCellConfigList-r17`

以上字段名以 `data/symbols/rrc_symbols.json` 中 `messages.SIB19.fields` 为准；
`-r17` / `-r18` / `-r19` 后缀必须与符号表一致，不能改写成无后缀名。

## 判据

- 生成后用 `validate_intent` 校验，R2 无违规即字段作用域正确。
- 与 gold 对照时只看是否召回，不要求字段取值一致。

## 不要做

- 不要把 `messages.SIB19.fields` 全量写进 IE：符号表列的是“该消息可能出现的字段”，不是“本条用例必带字段”。
- 不要把其它消息的字段（例如 `cellReselectionPriority`）挪进 SIB19 来凑覆盖。
- 不确定该不该带时，宁可少带并在结论里说明，也不要编造字段。
