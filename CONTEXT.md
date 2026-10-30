# 6G 一致性测试用例生成智能体

一个面向 3GPP 规范的一致性测试用例生成智能体，参加"AI+6G 创新产品"赛题。本文件只记录项目术语，不记录实现方案。

## Language

**一致性测试用例生成 (Conformance Test Case Generation)**:
从规范条款出发，产出可被执行/评审的测试意图（测试目的、前置条件、测试步骤、期望信令）。
_Avoid_: 测试脚本生成、自动化测试、协议问答

**测试用例描述 (Test Case Description)**:
3GPP 规范正文中公开的用例定义，包含 test purpose、preconditions、test procedure、specific message contents。它是本项目的标准答案来源。
_Avoid_: 测试代码、TTCN-3 源码（后者受限，不等同于描述）

**规范条款 (Spec Clause)**:
规范中被引用的最小可定位单元，由一个条款编号唯一标识。是本系统的输入锚点。
_Avoid_: 段落、章节（过泛）

**测试意图 (Test Intent)**:
用例要验证的规范行为，是生成物的语义核心，独立于具体编码语言。
_Avoid_: 测试用例（那是完整产物）

**测试目的 (Test Purpose, TP)**:
3GPP 规范中每个用例开头的准形式化声明，形如 `with { } ensure that { when { } then { } }`。是本系统输入侧的语义锚点，也是答案键的一部分。
_Avoid_: 测试目标、验证点（过泛）

**具体信令内容 (Specific Message Contents)**:
规范中按步骤给出的 ASN.1 IE 表，通常由默认模板加差分（Derivation Path）得到。是本系统输出侧最难也最有价值的生成物。
_Avoid_: 报文、消息（过泛）

**基准用例集 (Benchmark Set)**:
由公开规范自动切出的「输入 / 官方答案」对集合，用于可复现地给本系统打分。是项目的核心可信资产。
_Avoid_: 测试集、数据集（过泛）

**校验器 (Validator)**:
确定性组件，依据符号表与规则判定生成物是否合法（IE 是否存在、步骤方向是否合理、TP 条件是否被步骤覆盖）。不是 LLM。
_Avoid_: 检查器、审校模型

**缺陷检出率 (Defect Detection Rate)**:
向校验器注入故意写错的用例，统计其正确拒收的比例。是校验器自身的质量指标。
_Avoid_: 准确率（易与生成指标混淆）
