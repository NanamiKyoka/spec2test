import { Button, Card, CardBody, CardHead, Chip, Table, Td, Th } from "../ui";
import { ArrowRight, ShieldCheck } from "lucide-react";

const ROWS: [string, string][] = [
  ["问题", "3GPP 测试用例要靠人从规范里抄条款、拼步骤、填 ASN.1 字段，规范每版更新都要重做。"],
  ["方案", "把条款编译成结构化测试意图，再用确定性校验器判对错：消息是否存在、字段是否合法、TP 是否被覆盖。"],
  ["效果", "结构合法率 100%（8/8）；校验器对官方答案误报 0/8，对生成输出误报 0/8；缺陷注入检出 31/31（修正 4 条无效注入后）。"],
  ["局限", "切片仅 8 个 NTN 用例；L3 召回受输入信息量限制；消息序列（L2）不计分。"],
];

const ROUTE: [string, string, string][] = [
  ["1", "看一条通过的用例", "6.7.1.3"],
  ["2", "看一条多字段的复杂用例", "6.7.1.10"],
  ["3", "看一条弃权的用例", "6.7.1.4"],
  ["4", "回数据页看逐例矩阵与失败筛选", ""],
];

const PERSONAS: [string, string, string, string][] = [
  [
    "终端 / 模组测试工程师",
    "拿到新 NTN 条款，手工拼步骤与 ASN.1 字段，容易漏 IE。",
    "生成测试意图初稿，校验器兜底；人工只核对字段级证据与差异。",
    "导出 Markdown / JSON 带入用例库",
  ],
  [
    "认证实验室 / 运营商测试团队",
    "需要可追溯、可复现的判定依据，模型输出不能黑箱。",
    "每条结论可回指条款、符号表路径与违规位置；HITL 审批控制模型调用。",
    "导出证据束归档与评审",
  ],
  [
    "工具链 / 自动化团队",
    "条款更新后回归成本高，难以判断生成物是否合法。",
    "同一套 CLI/API 跑批，确定性校验器给出可复现判定。",
    "接入 CI 做条款回归",
  ],
];

export function AboutView() {
  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="mx-auto max-w-[860px] px-6 py-8">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-accent" />
          <h1 className="text-xl font-semibold tracking-tight">五分钟了解</h1>
        </div>
        <p className="mt-1 max-w-prose text-sm text-muted">没看过这个项目的人，从这里开始。</p>

        <Card className="mt-6">
          <CardHead>
            <span className="text-sm font-medium">5 分钟评审路线</span>
            <Chip tone="accent" className="ml-auto">
              推荐
            </Chip>
          </CardHead>
          <CardBody className="space-y-2">
            <p className="max-w-prose text-sm leading-relaxed text-muted">
              按顺序看：先看通过的证据，再看拒收与弃权，最后回数据页看逐例矩阵。
            </p>
            {ROUTE.map(([n, label, caseId]) => (
              <button
                key={n}
                onClick={() => {
                  window.location.hash = caseId ? `#/case?case=${caseId}` : "#/data";
                }}
                className="flex w-full items-center gap-3 rounded-md border border-line px-3 py-2 text-left text-sm hover:border-accent/40 hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/10 text-xs font-medium text-accent-ink">
                  {n}
                </span>
                <span className="flex-1">{label}</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted" />
              </button>
            ))}
          </CardBody>
        </Card>

        <details className="mt-6 rounded-lg border border-line bg-canvas px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">5 分钟演示脚本（点击展开）</summary>
          <ol className="mt-3 max-w-prose list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
            <li>先看数据：8 例、L1 8/8、缺陷检出 31/31、官方误报 0/8；点指标卡 `?` 看口径。</li>
            <li>看通过证据：6.7.1.3 → 结论 → 字段抽屉 → 导出 Markdown/JSON。</li>
            <li>看弃权：6.7.1.4 → 未调用模型、不计 0 分。</li>
            <li>试对话：精确命中直接跑；语义输入触发 HITL 审批卡，批准后才调用模型。</li>
            <li>看局限：评测页底部「已知限制」，含切片、L3 分母、解读覆盖与未验证项。</li>
          </ol>
          <p className="mt-2 text-xs text-muted">详细版见仓库 `docs/PITCH.md`。</p>
        </details>

        <section className="mt-8 rounded-lg bg-surface px-4 py-3" aria-labelledby="about-summary">
          <h2
            id="about-summary"
            className="text-xs font-semibold uppercase tracking-wide text-muted"
          >
            问题 → 方案 → 效果 → 局限
          </h2>
          <div className="mt-3 space-y-3">
            {ROWS.map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <div className="w-12 shrink-0 pt-0.5 text-xs font-medium text-muted">{k}</div>
                <div className="max-w-prose text-sm leading-relaxed">{v}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8 rounded-lg bg-surface px-4 py-3" aria-labelledby="about-personas">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="about-personas"
              className="text-xs font-semibold uppercase tracking-wide text-muted"
            >
              适用人群与工作流
            </h2>
            <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
              设计假设 · 未做用户研究
            </span>
          </div>
          <div className="mt-3 overflow-x-auto">
            <Table className="min-w-[640px]">
              <thead>
                <tr>
                  <Th>角色</Th>
                  <Th>现在的做法</Th>
                  <Th>用了之后</Th>
                  <Th>带走什么</Th>
                </tr>
              </thead>
              <tbody>
                {PERSONAS.map(([role, before, after, output]) => (
                  <tr key={role}>
                    <Td className="whitespace-nowrap font-medium">{role}</Td>
                    <Td className="text-muted">{before}</Td>
                    <Td>{after}</Td>
                    <Td className="text-muted">{output}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <p className="mt-3 max-w-prose text-xs leading-relaxed text-muted">
            已实测指标：8 个用例、22 次模型调用、缺陷注入检出 31/31、官方答案误报 0/8。
            人工耗时节省尚未验证，不作为承诺。
          </p>
        </section>

        <section className="mt-8 rounded-lg bg-surface px-4 py-3" aria-labelledby="about-honest">
          <div className="flex items-center gap-2">
            <h2 id="about-honest" className="text-xs font-semibold uppercase tracking-wide text-muted">
              诚实声明
            </h2>
            <span className="rounded-full border border-line px-2 py-[1px] text-xs text-muted">必读</span>
          </div>
          <ul className="mt-2 max-w-prose list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
            <li>6G 尚未标准化（首个 6G 规范冻结计划 2028-12），本系统在 NR Rel-19 上验证。</li>
            <li>暂无专利或软件著作权，真实性由可复现性担保：脚本与基准可重跑。</li>
            <li>消息序列（L2）不计分：全库仅 16 个交换，样本量不支持统计结论。</li>
          </ul>
        </section>

        <div className="mt-8 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => (window.location.hash = "#/data")}>
            看数据 <ArrowRight className="h-4 w-4" />
          </Button>
          <Button onClick={() => (window.location.hash = "#/chat")}>试对话</Button>
          <Button onClick={() => (window.location.hash = "#/eval")}>看评测</Button>
          <Button onClick={() => (window.location.hash = "#/api")}>看口径与配置</Button>
        </div>
      </div>
    </div>
  );
}
