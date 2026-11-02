"use client";

import { Button, Card, CardBody, CardHead, Chip, Table, Td, Th } from "../ui";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { ArchitectureDiagram } from "../components/ArchitectureDiagram";
import { openCasePanel } from "@/lib/panel";

const PIPELINE: [string, string, string, string][] = [
  ["1 · ingest", "规范用例切片", "标题、测试目的、一致性要求、前置条件", "否"],
  ["2 · context", "用例三个文本字段", "裁剪后的上下文", "否"],
  ["3 · candidates", "上下文 + 符号表", "候选消息（SIB / RRC 名称）", "否"],
  ["4 · generate", "上下文 + 候选消息", "步骤序列 + 每条消息的 IE", "是（两段）"],
  ["5 · validate", "测试意图 + 符号表", "R1 / R2 / R3 违规清单", "否"],
  ["6 · score", "产物 + 官方 gold", "L1、L3、违规", "否"],
];

const METRICS: [string, string, string][] = [
  ["结构合法率 L1", "8 / 8", "步骤可解析为 IR（主体、方向、消息字段类型合法）"],
  ["缺陷注入检出", "31 / 31", "R1 8/8、R2 7/7、R3 16/16（修正 4 条无效注入后重跑）"],
  ["官方答案误报", "0 / 8", "校验器跑官方 gold IR，不误判"],
  ["真实错误集盲测", "16 / 19", "范围内 R1/R2/R3 16/16；3 条漏检为方向/顺序/完整性，校验器未声明检查"],
  ["L3 字段召回", "逐例", "与结构化解码基线配对，不报平均数（n=8 无统计意义）"],
];

const ROUTE: [string, string, string][] = [
  ["1", "看一条通过的用例", "6.7.1.3"],
  ["2", "看一条多字段的复杂用例", "6.7.1.10"],
  ["3", "看一条弃权的用例", "6.7.1.4"],
  ["4", "回数据页看逐例矩阵", ""],
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8" aria-labelledby={id}>
      <h2 id={id} className="text-xs font-medium text-muted">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

export function AboutView() {
  const router = useRouter();

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="mx-auto max-w-[860px] px-6 py-8">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-accent" />
          <h1 className="text-xl font-semibold tracking-tight">项目说明</h1>
        </div>

        <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted">
          Spec2Test 把 3GPP 测试条款编译成可校验的测试意图：步骤、消息序列、每条消息的 IE 字段，
          再由确定性校验器逐条判定。当前覆盖 TS 38.523-1 §6.7 的 8 个 NR NTN 空闲态小区选择/重选用例。
          模型负责生成，规则负责判对错，两者职责分开。
        </p>

        <Section id="about-problem" title="问题">
          <p>
            3GPP 测试用例是给人读的规范文本：测试目的写成准形式化的 given / when / then，
            步骤和 ASN.1 字段散落在条款里。工程师要把它们抄成可执行的用例，逐条补 IE，
            规范每出一个 release 就要重做一遍。这个转换过程没有机器可读的中间产物，也无法自动判断对错。
          </p>
        </Section>

        <Section id="about-agent" title="智能体怎么工作">
          <p>
            默认执行是一条固定链路：读切片、抽候选、生成步骤、生成字段、校验、定向修复、评分。
            链路里的每一步都以工具形式提供，模型可以自行选择顺序与重试；
            规则细节做成技能说明（SIB19 字段取舍、TP 引用修复、跨消息字段判定），
            需要时由模型显式加载，而不是把规则塞进提示词里。
          </p>
          <Card>
            <CardBody className="px-2 py-3 sm:px-4">
              <ArchitectureDiagram />
            </CardBody>
          </Card>
          <p className="text-muted">
            工具走两条通道：页面使用的 HTTP 接口，与供外部智能体、评测脚本使用的 MCP。
            两条通道共用同一份实现。判定始终由校验器完成，模型只负责提出与修复，
            因此换模型、换编排方式都不会改变“通过”的含义。输入框「+」菜单里可以直接切换
            「固定管线」与「模型自选」：后者由模型决定调用哪些工具、按什么顺序，判定不变。
          </p>
        </Section>

        <Section id="about-innovation" title="三条可验证的点">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <b>规则即工具，模型不能自证。</b>
              生成与修复交给模型，通过与否由确定性规则判定；校验器自身异常按 R0 拒收，
              不存在“模型说对就算对”。
              <span className="text-muted">
                {" "}证据：缺陷注入 31/31 检出、官方答案 0/8 误报、真实错误集范围内 16/16。
              </span>
            </li>
            <li>
              <b>自诊断修复闭环。</b>
              违规清单回灌给模型，字段按消息重修，TP 引用只改引用、不增删步骤；
              每轮前后违规数可查，没有进展就立即停止，不重复烧调用。
              <span className="text-muted">
                {" "}证据：31 条受控缺陷中 23 条修复后违规归零，3 条减少、5 条未变，逐例可查。
              </span>
            </li>
            <li>
              <b>证据不足就弃权，结论可回指。</b>
              输入里没有可识别消息名时不调用模型、不计分；每条判定都能回指字段路径与违规位置。
              <span className="text-muted"> 证据：6.7.1.4 弃权，产物不会写成通过。</span>
            </li>
          </ul>
          <p className="text-muted">
            固定管线只是对照组：把同一批工具交给模型自选顺序，与固定管线在调用数、耗时、
            判定上并排对照，用来回答“这到底是不是脚本”。
          </p>
        </Section>

        <Section id="about-pipeline" title="六阶段与工具">
          <p>
            默认链路分成六个阶段。前三个阶段完全确定性，只做解析、裁剪与候选抽取；
            模型只在生成阶段被调用；校验与评分又回到确定性规则。
            这六步同时也是工具：模型自由编排时可以先读候选，再决定生成多少、要不要重修。
          </p>
          <Card className="overflow-x-auto">
            <CardBody className="p-0">
              <Table className="min-w-[640px]">
                <thead>
                  <tr>
                    <Th>阶段</Th>
                    <Th>输入</Th>
                    <Th>输出</Th>
                    <Th>调用模型</Th>
                  </tr>
                </thead>
                <tbody>
                  {PIPELINE.map(([stage, input, output, model]) => (
                    <tr key={stage}>
                      <Td className="whitespace-nowrap font-medium">{stage}</Td>
                      <Td className="text-muted">{input}</Td>
                      <Td className="text-muted">{output}</Td>
                      <Td className="whitespace-nowrap">{model}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          </Card>
        </Section>

        <Section id="about-generate" title="两段式生成与弃权">
          <p>
            生成分两段：先只生成步骤序列，保证结构合法；再针对每条消息生成 IE 字段。
            两段分开，某一段失败时不会把另一段的产物带坏。第二段开始前先做候选消息抽取：
            只有输入里真的出现 SIB / RRC 名称（或能由符号表反查回所属消息的字段），才会发起模型调用。
          </p>
          <p className="text-muted">
            候选为空时系统弃权：不调用模型、不生成 IE 字段内容、不计 0 分。
            弃权是明确结论，不是失败，也不会被写成“通过”。
          </p>
        </Section>

        <Section id="about-validate" title="确定性校验器">
          <p>校验器只读测试意图与符号表，不调用模型，规则固定为三条：</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <b>R1 消息存在</b>：步骤里的消息名必须能在符号表中解析，支持 SIB / 全名互转与复合写法。
            </li>
            <li>
              <b>R2 字段合法</b>：IE 字段必须属于该消息，按叶子名判定；明确区分“ASN.1 里有、但不属于这条消息”的情况。
            </li>
            <li>
              <b>R3 测试目的覆盖</b>：每条 TP 至少被一个步骤引用，引用列可核。
            </li>
          </ul>
          <p className="text-muted">
            校验器自身异常时按拒收处理（R0），不会把“没校验成功”写成“通过”。
            校验器给出的每条违规都带规则、路径与原因，可直接回指到条款与字段。
          </p>
        </Section>

        <Section id="about-verdict" title="判定与产物">
          <p>每个用例只会有一种判定，语义固定：</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <b>通过</b>：校验器无违规，产物写入正式结果，可导出 JSON / Markdown。
            </li>
            <li>
              <b>拒收</b>：发现违规，产物写入拒收区，绝不覆盖正式结果；违规清单随产物保存。
            </li>
            <li>
              <b>弃权</b>：输入不足以定位消息，阶段二未调用模型，不计分。
            </li>
            <li>
              <b>失败</b>：运行中断，不产生判定，也不会继承之前的通过结论。
            </li>
          </ul>
          <p className="text-muted">
            人工审批（HITL）在候选消息之后、模型调用之前：未批准或超时都按取消处理，
            不发起任何模型调用，产物与判定都不生成。
          </p>
        </Section>

        <Section id="about-evidence" title="证据链">
          <p>
            每个字段都能回指符号表路径，每条 TP 都能回指被哪个步骤引用，每条违规都有规则与位置。
            单例页面提供字段级证据与导出，数据页给出逐例矩阵，评测页给出与基线的配对对照。
            结论不是一段看起来合理的文字，而是可复核的产物。
          </p>
        </Section>

        <Section id="about-metrics" title="评测方法与结果">
          <p>
            L1 衡量结构是否可解析；L3 衡量生成字段对官方 gold 的召回；L2 只做序列并排，不计分。
            缺陷注入是自建模板上的检出；真实错误集盲测来自真实模型输出的人工标注，两者都不是第三方盲测。
          </p>
          <p className="text-muted">
            另外两组实验用来回答“模型和工具在起什么作用”：修复增益对比同一份缺陷产物修与不修；
            编排消融对比固定管线与模型自由编排。两组都逐例列出，结果随仓库保存。
          </p>
          <Card className="overflow-x-auto">
            <CardBody className="p-0">
              <Table className="min-w-[640px]">
                <thead>
                  <tr>
                    <Th>指标</Th>
                    <Th>结果</Th>
                    <Th>口径</Th>
                  </tr>
                </thead>
                <tbody>
                  {METRICS.map(([name, value, note]) => (
                    <tr key={name}>
                      <Td className="whitespace-nowrap font-medium">{name}</Td>
                      <Td className="whitespace-nowrap">{value}</Td>
                      <Td className="text-muted">{note}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          </Card>
        </Section>

        <Section id="about-limits" title="工程局限">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>切片只覆盖 §6.7 的 8 个 NTN 用例，符号表只有 15 个消息；换条款需要重建符号表与用例切片。</li>
            <li>LTE 条目只做 R1（消息存在性），R2 对未覆盖消息与 LTE 子集不检查，避免用不完整字段集误判。</li>
            <li>L3 召回受输入信息量限制；模型解读只作辅助，判定只由校验器给出。</li>
            <li>消息序列（L2）不计分：全库仅 16 次交换，样本量不支持统计结论。</li>
            <li>没有用户研究、专利或软件著作权；可信度由可复现性担保，脚本与基准可重跑。</li>
          </ul>
        </Section>

        <Section id="about-6g" title="与 6G 的关系">
          <p>
            6G 尚未标准化（首个 6G 规范冻结计划 2028-12），所以现在在 NR Rel-19 上做端到端验证，
            而不是宣称已经覆盖 6G。可迁移的是工程物而不是口号：符号表按 release 参数化，
            IR 与校验规则不绑定 NTN；6G 规范可解析后，增量工作是“新符号表 + 新用例切片 + 新适配器”，不是重写。
          </p>
        </Section>

        <Section id="about-repro" title="复现">
          <p className="text-muted">以下命令在仓库根目录执行：</p>
          <pre className="overflow-x-auto rounded-md border border-line bg-surface p-3 text-xs leading-relaxed">
{`py -3.12 -m pytest -q                         # 后端测试
bash scripts/verify_clean.sh                  # 干净克隆 + 快照一致性
py -3.12 tools/validate.py data/gold_ir data/symbols/rrc_symbols.json
py -3.12 tools/blindset.py                    # 真实错误集盲测
py -3.12 scripts/ab_repair.py --defects data/defects --arms 0,1   # 修复增益
py -3.12 scripts/ab_orchestration.py          # 编排消融`}
          </pre>
        </Section>

        <Card className="mt-8">
          <CardHead>
            <span className="text-sm font-medium">评审路线</span>
            <Chip tone="accent" className="ml-auto">
              推荐
            </Chip>
          </CardHead>
          <CardBody className="space-y-2">
            {ROUTE.map(([n, label, caseId]) => (
              <button
                key={n}
                onClick={() => {
                  if (caseId) openCasePanel(caseId);
                  else router.push("/data");
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

        <div className="mt-8 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => router.push("/data")}>
            看数据 <ArrowRight className="h-4 w-4" />
          </Button>
          <Button onClick={() => router.push("/")}>试对话</Button>
          <Button onClick={() => router.push("/data")}>看数据与评测</Button>
          <Button onClick={() => router.push("/api")}>看配置</Button>
        </div>
      </div>
    </div>
  );
}
