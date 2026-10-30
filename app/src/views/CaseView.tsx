import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Info, MessageSquare, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { Button, Card, CardBody, CardHead, Chip, Empty, Modal, Table, Td, Term, Th } from "../ui";
import {
  goldForMessage,
  loadSymbols,
  normName,
  pathsFor,
  violationsFor,
  type IeFileLite,
  type SymbolTable,
} from "../lib/evidence";
import {
  DASH,
  fetchJson,
  fmtL3,
  fmtNum,
  loadAbstain,
  loadScore,
  statusChip,
  type AbstainRow,
  type ReportRow,
} from "./DataView";

type IeField = { name: string; value?: string; comment?: string; condition?: string; raw?: string };
type IeTable = {
  table_ref?: string;
  message?: string;
  step?: number | null;
  derivation_path?: string;
  ies?: IeField[];
  leaf_ies?: ({ name: string } & Partial<IeField>)[];
};
type IeFile = { case_id: string; message_tables: IeTable[] };

type CtxFile = {
  case_id: string;
  title?: string;
  test_purpose?: string;
  conformance_requirements?: string;
  pre_test_conditions?: string;
};

type ExplainFile = {
  case_id: string;
  provider?: string;
  model?: string;
  generated_at?: string;
  headline?: string;
  sections?: { key: string; title: string; body: string }[];
  numbers?: Record<string, unknown>;
  grounded_on?: string[];
};

type OutStep = { st: number | string; actor?: string; direction?: string; message?: string; tp_ref?: number[] };
type OutMsg = { message?: string; ies?: IeField[]; table_ref?: string; derivation_path?: string };
type OutFile = {
  case_id: string;
  status?: string;
  reason?: string;
  verdict?: string | null;
  violations?: { rule: string; path: string; detail: string }[];
  steps?: OutStep[];
  messages?: OutMsg[];
};

type Stage = {
  key: string;
  label: string;
  status: "ok" | "skipped" | "failed" | "pending";
  summary: string;
};

function leafFields(t: IeTable): string[] {
  if (t.leaf_ies?.length) return t.leaf_ies.map((i) => i.name);
  return (t.ies || []).map((i) => i.name);
}

function buildStages(report?: ReportRow, abstain?: AbstainRow, ie?: IeFile | null, out?: OutFile | null): Stage[] {
  const abstained =
    report?.status === "abstained" || out?.status === "abstained" || abstain?.status === "abstained";
  const inMsg = abstain?.in_msg ?? 0;
  const violations = out?.violations?.length ?? 0;
  const reason = out?.reason || (abstained ? "inputs contain no message/SIB names" : "");

  return [
    {
      key: "ingest",
      label: "读取规范",
      status: ie === undefined ? "pending" : ie ? "ok" : "failed",
      summary: ie ? `解析到 ${ie.message_tables.length} 张信令表` : "未找到该用例的规范切片",
    },
    {
      key: "context",
      label: "上下文裁剪",
      status: ie ? "ok" : "pending",
      summary: ie ? "裁剪后上下文已生成" : "等待规范切片",
    },
    {
      key: "candidates",
      label: "候选消息",
      status: abstained && inMsg === 0 ? "skipped" : "ok",
      summary:
        inMsg === 0
          ? `候选为空 → 弃权（${reason || "输入中没有消息/SIB 名"}）`
          : `抽取到 ${inMsg} 个候选消息`,
    },
    {
      key: "generate",
      label: "生成 IR",
      status: abstained ? "skipped" : out?.messages ? "ok" : "pending",
      summary: abstained
        ? "弃权：未调用模型（calls=0）"
        : out?.messages
        ? `生成 ${out.steps?.length ?? 0} 步 / ${out.messages.length} 条消息`
        : "等待生成",
    },
    {
      key: "validate",
      label: "校验",
      status: abstained ? "skipped" : violations > 0 ? "failed" : out ? "ok" : "pending",
      summary: abstained
        ? "弃权：无产物可校验"
        : violations > 0
        ? `发现 ${violations} 条违规 → 已拒收`
        : out
        ? "无违规"
        : "等待校验",
    },
    {
      key: "score",
      label: "评分",
      status: abstained ? "skipped" : report ? "ok" : "pending",
      summary: abstained
        ? "弃权：不计分（不是 0 分）"
        : report
        ? `L1 ${fmtNum(report.L1)} · L3 ${fmtL3(report.L3_recall)}`
        : "等待评分",
    },
  ];
}

const STATUS_META: Record<Stage["status"], { label: string; cls: string; dot: string }> = {
  ok: { label: "完成", cls: "border-ok/40 text-ok bg-ok/10", dot: "bg-ok" },
  skipped: { label: "skipped", cls: "border-line text-muted bg-surface", dot: "bg-muted/40" },
  failed: { label: "有违规", cls: "border-bad/40 text-bad bg-bad/10", dot: "bg-bad" },
  pending: { label: "待执行", cls: "border-line text-muted bg-surface", dot: "bg-muted/40" },
};

function StageList({ stages }: { stages: Stage[] }) {
  return (
    <ol className="divide-y divide-line">
      {stages.map((s) => {
        const meta = STATUS_META[s.status];
        return (
          <li key={s.key} className="flex items-start gap-3 px-4 py-2.5">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium">{s.label}</span>
                <span className="font-mono text-[11px] text-muted">{s.key}</span>
                <span className={`rounded-full border px-1.5 py-[1px] text-[10.5px] ${meta.cls}`}>{meta.label}</span>
              </div>
              <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{s.summary}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function RawJson({ value }: { value: unknown }) {
  return (
    <details className="px-4 py-3">
      <summary className="cursor-pointer text-[12.5px] text-muted hover:text-ink">
        <ChevronDown className="mr-1 inline h-3.5 w-3.5" />
        原始数据（只读）
      </summary>
      <pre className="scroll-thin mt-2 max-h-[320px] overflow-auto rounded-md border border-line bg-surface p-3 font-mono text-[11.5px] leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

export function CaseView({ caseId }: { caseId: string }) {
  const [report, setReport] = useState<ReportRow | undefined>();
  const [abstain, setAbstain] = useState<AbstainRow | undefined>();
  const [ie, setIe] = useState<IeFile | null | undefined>(undefined);
  const [out, setOut] = useState<OutFile | null | undefined>(undefined);
  const [ctx, setCtx] = useState<CtxFile | null>(null);
  const [explain, setExplain] = useState<ExplainFile | null>(null);
  const [sym, setSym] = useState<SymbolTable | null>(null);
  const [picked, setPicked] = useState<{ msg: string; ie: IeField } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const hadPicked = useRef(false);
  useEffect(() => {
    if (picked) {
      hadPicked.current = true;
    } else if (hadPicked.current) {
      hadPicked.current = false;
      triggerRef.current?.focus();
    }
  }, [picked]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const [score, abs, ieFile, outFile, rejFile, ctxFile, explainFile] = await Promise.all([
        loadScore(),
        loadAbstain(),
        fetchJson<IeFile>(`/data/ir/ie/${caseId}.json`, `/results/ir/ie/${caseId}.json`),
        fetchJson<OutFile>(`/data/out/${caseId}.json`, `/results/out/${caseId}.json`),
        fetchJson<OutFile>(`/data/out_rejected/${caseId}.json`, `/results/out_rejected/${caseId}.json`),
        fetchJson<CtxFile>(`/data/ctx/${caseId}.json`, `/results/ctx/${caseId}.json`),
        fetchJson<ExplainFile>(`/data/explain/${caseId}.json`, `/results/explain/${caseId}.json`),
      ]);
      if (!alive) return;
      setReport((score.data || []).find((r) => r.case === caseId));
      setAbstain((abs.data || []).find((r) => r.case === caseId));
      setIe(ieFile.data);
      setCtx(ctxFile.data);
      setExplain(explainFile.data);
      // 正式产物无判定时，优先用被拒收运行的结论，避免把拒收显示成通过/已生成
      const primary = outFile.data;
      const rejected = rejFile.data;
      const chosen =
        primary && (primary.verdict || primary.status === "abstained") ? primary : rejected || primary;
      setOut(chosen);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [caseId]);

  // 符号表 670KB：不阻塞首屏，打开字段证据抽屉时才按需加载
  useEffect(() => {
    setSym(null);
  }, [caseId]);

  useEffect(() => {
    if (!picked || sym) return;
    let alive = true;
    loadSymbols().then((s) => {
      if (alive) setSym(s);
    });
    return () => {
      alive = false;
    };
  }, [picked, sym]);

  const stages = useMemo(() => buildStages(report, abstain, ie, out), [report, abstain, ie, out]);

  const verdict = useMemo(() => {
    if (out?.verdict === "reject") return "reject";
    if (out?.status === "abstained" || report?.status === "abstained") return "abstained";
    if (out?.verdict === "pass") return "pass";
    if ((out?.violations?.length ?? 0) > 0) return "reject";
    // 没有判定就是没有判定：不得由 report.status 推断为通过
    return "unknown";
  }, [out, report]);

  const conclusion = useMemo(() => {
    if (verdict === "abstained")
      return { text: "已弃权：输入信息不足，未发起模型调用，也不计分。", tone: "muted" as const };
    if (verdict === "reject")
      return {
        text: `已拒收：校验发现 ${out?.violations?.length ?? 0} 条违规，未写入正式结果。`,
        tone: "bad" as const,
      };
    if (verdict === "pass") return { text: "通过：结构合法且校验器未发现违规。", tone: "ok" as const };
    if (verdict === "unknown" && out)
      return { text: "未判定：该产物未记录校验器判定，请重跑该用例生成判定。", tone: "muted" as const };
    return { text: "该用例没有可用的运行产物。", tone: "muted" as const };
  }, [verdict, out]);

  const goldTables = ie?.message_tables || [];
  const goldCount = goldTables.reduce((s, t) => s + leafFields(t).length, 0);
  const sysMsgs = out?.messages || [];
  const violations = out?.violations || [];

  // 首屏关键字段：生成物里前 6 个不重复 IE，点开即看证据
  const keyIes: { msg: string; ie: IeField }[] = (() => {
    const seen = new Set<string>();
    const outList: { msg: string; ie: IeField }[] = [];
    for (const m of sysMsgs) {
      for (const f of m.ies || []) {
        const k = (m.message || "") + "|" + f.name;
        if (seen.has(k)) continue;
        seen.add(k);
        outList.push({ msg: m.message || "", ie: f });
        if (outList.length >= 6) return outList;
      }
    }
    return outList;
  })();

  const pickedGoldSet = useMemo(
    () => (picked ? goldForMessage(ie as IeFileLite | null | undefined, picked.msg) : null),
    [ie, picked]
  );
  const pickedPaths = picked ? pathsFor(sym, picked.msg, picked.ie.name) : [];
  const pickedGold = picked && pickedGoldSet ? pickedGoldSet.has(normName(picked.ie.name)) : null;
  const pickedViolations = picked ? violationsFor(violations, picked.ie.name) : [];
  const pickedDerivation = picked
    ? sysMsgs.find((m) => (m.message || "") === picked.msg)?.derivation_path || ""
    : "";

  if (loading) {
    return <div className="flex h-full items-center justify-center text-[13px] text-muted">正在读取用例 {caseId}…</div>;
  }

  if (ie === null && out === null && !report) {
    return (
      <div className="h-full overflow-y-auto scroll-thin">
        <div className="mx-auto max-w-[1100px] px-6 py-6">
          <Button variant="subtle" onClick={() => (window.location.hash = "#/data")}>
            <ArrowLeft className="h-4 w-4" /> 返回数据面板
          </Button>
          <Card className="mt-4">
            <Empty
              title={`快照中没有 ${caseId} 的产物数据。运行 scripts/repro.sh 生成后再查看。`}
              action={
                <Button variant="primary" onClick={() => (window.location.hash = "#/data")}>
                  返回数据面板
                </Button>
              }
            />
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="mx-auto max-w-[1100px] px-6 py-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="subtle" onClick={() => (window.location.hash = "#/data")}>
            <ArrowLeft className="h-4 w-4" /> 数据面板
          </Button>
          <span className="num font-mono text-[13px] text-muted">{caseId}</span>
          <div className="ml-auto">
            <Button variant="primary" onClick={() => (window.location.hash = "#/chat")}>
              <MessageSquare className="h-4 w-4" /> 在对话中继续
            </Button>
          </div>
        </div>

        {/* 条款依据：先让人知道这条用例在验什么，再看生成物 */}
        {ctx && (
          <Card className="mt-4">
            <CardHead>
              <span className="text-[13px] font-medium">条款依据</span>
              <span className="ml-auto font-mono text-[12px] text-muted">TS 38.523-1 §{caseId}</span>
            </CardHead>
            <CardBody className="space-y-2">
              <div className="text-[13px] font-semibold">{ctx.title || "（无标题）"}</div>
              {ctx.test_purpose && (
                <details className="rounded-md border border-line">
                  <summary className="cursor-pointer px-3 py-2 text-[12px] text-muted">
                    测试目的（TP 原文）
                  </summary>
                  <pre className="scroll-thin max-h-[220px] overflow-auto whitespace-pre-wrap border-t border-line bg-surface px-3 py-2 font-mono text-[11.5px] leading-relaxed">
                    {ctx.test_purpose}
                  </pre>
                </details>
              )}
              {ctx.conformance_requirements && (
                <details className="rounded-md border border-line">
                  <summary className="cursor-pointer px-3 py-2 text-[12px] text-muted">
                    符合性要求（规范引文）
                  </summary>
                  <pre className="scroll-thin max-h-[220px] overflow-auto whitespace-pre-wrap border-t border-line bg-surface px-3 py-2 font-mono text-[11.5px] leading-relaxed">
                    {ctx.conformance_requirements}
                  </pre>
                </details>
              )}
            </CardBody>
          </Card>
        )}
        {!ctx && !loading && (
          <Card className="mt-4">
            <CardBody>
              <p className="text-[12.5px] text-muted">
                该用例没有条款上下文快照（data/ctx/{caseId}.json），只能看到生成与校验结果。
              </p>
            </CardBody>
          </Card>
        )}

        {/* 结论行 */}
        <Card className="mt-4">
          <CardBody className="flex flex-wrap items-center gap-3">
            {verdict === "pass" ? (
              <ShieldCheck className="h-5 w-5 text-ok" />
            ) : verdict === "reject" ? (
              <XCircle className="h-5 w-5 text-bad" />
            ) : (
              <ShieldAlert className="h-5 w-5 text-muted" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-semibold">{conclusion.text}</span>
                {verdict === "unknown" ? (
                  <Chip tone="muted">未判定</Chip>
                ) : (
                  statusChip(report?.status, verdict)
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-4 text-[12.5px] text-muted">
                <span>
                  <Term term="L1" desc="结构合法率：生成物能否解析成 IR，且每步有主体/方向/消息。" />{" "}
                  <span className="num font-mono text-ink">{fmtNum(report?.L1)}</span>
                </span>
                <span>
                  <Term term="L3" desc="关键 IE 命中率：生成字段对官方叶子字段的召回。" />{" "}
                  <span className="num font-mono text-ink">{fmtL3(report?.L3_recall)}</span>
                </span>
                <span>
                  <Term term="gold" desc="官方答案的叶子字段数。" />{" "}
                  <span className="num font-mono text-ink">{report?.gold_ie_n ?? goldCount}</span>
                </span>
                <span>
                  调用数 <span className="num font-mono text-ink">{report?.calls ?? DASH}</span>
                </span>
              </div>
              {explain?.headline && (
                <p className="mt-2 text-[13px] font-medium text-ink">{explain.headline}</p>
              )}
              {keyIes.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11.5px] text-muted">关键字段</span>
                  {keyIes.map(({ msg, ie }) => (
                    <button
                      key={msg + "|" + ie.name}
                      onClick={(e) => {
                        triggerRef.current = e.currentTarget;
                        setPicked({ msg, ie });
                      }}
                      className="rounded-full border border-line bg-canvas px-2 py-0.5 font-mono text-[11.5px] text-ink hover:border-accent/40 hover:bg-accent/5"
                      title="查看证据"
                    >
                      {ie.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        {/* 智能解读：LLM 用自然语言解释结果与数据 */}
        <Card className="mt-4 border-accent/30 bg-accent/5">
          <CardHead>
            <span className="flex items-center gap-1.5 text-[13px] font-medium">
              <Info className="h-3.5 w-3.5" /> 智能解读（LLM）
            </span>
            <span className="ml-auto text-[11.5px] text-muted">
              {explain ? `${explain.model || "model"}${explain.generated_at ? " · " + explain.generated_at.slice(0, 10) : ""}` : "未生成"}
            </span>
          </CardHead>
          <CardBody className="space-y-3">
            {explain ? (
              <>
                {explain.headline && <p className="text-[13.5px] font-semibold">{explain.headline}</p>}
                <div className="grid gap-3 md:grid-cols-2">
                  {(explain.sections || []).map((s) => (
                    <div key={s.key} className="rounded-md border border-line bg-canvas px-3 py-2">
                      <div className="mb-1 text-[12px] font-medium text-accent">{s.title}</div>
                      <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink/90">{s.body}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[11.5px] text-muted">
                  由 LLM 基于本页数据生成；判定以校验器与官方答案为准，可对照下方证据逐条核对。
                </p>
              </>
            ) : (
              <p className="text-[12.5px] text-muted">
                尚未生成智能解读。运行 <code className="font-mono">py -3.12 tools/explain.py {caseId}</code> 生成后再刷新。
              </p>
            )}
          </CardBody>
        </Card>

        {/* 六阶段 */}
        <Card className="mt-4">
          <CardHead>
            <span className="text-[13px] font-medium">全链条 · 六阶段</span>
            <span className="ml-auto text-[12px] text-muted">弃权路径以灰色 skipped 标注</span>
          </CardHead>
          <CardBody className="p-0">
            <StageList stages={stages} />
          </CardBody>
        </Card>

        {/* 三面板 */}
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <Card>
            <CardHead>
              <span className="text-[13px] font-medium">gold 字段（官方答案）</span>
              <span className="ml-auto num text-[12px] text-muted">{goldCount}</span>
            </CardHead>
            <CardBody className="scroll-thin max-h-[320px] overflow-auto">
              {!goldTables.length ? (
                <p className="text-[12.5px] text-muted">
                  该用例原文的信令内容为 None，没有 gold 字段（不参与 L3 分母）。
                </p>
              ) : (
                <div className="space-y-2">
                  {goldTables.map((t, i) => (
                    <div key={i}>
                      <div className="text-[12px] font-medium">
                        {t.message || t.table_ref || `表 ${i + 1}`}
                        {t.step ? <span className="ml-1 text-muted">（步骤 {t.step}）</span> : null}
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {leafFields(t).map((n) => (
                          <li key={n} className="flex justify-between gap-2 font-mono text-[11.5px]">
                            <span className="truncate">{n}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHead>
              <span className="text-[13px] font-medium">系统产出</span>
              <span className="ml-auto text-[11.5px] text-muted">点字段看证据 · {sysMsgs.length} 条消息</span>
            </CardHead>
            <CardBody className="scroll-thin max-h-[320px] overflow-auto">
              {!out ? (
                <p className="text-[12.5px] text-muted">快照中不含该用例的系统产出。</p>
              ) : out.status === "abstained" ? (
                <p className="text-[12.5px] text-muted">
                  已弃权：{out.reason || "输入中没有消息/SIB 名"}。未调用模型，未产出信令内容。
                </p>
              ) : !sysMsgs.length ? (
                <p className="text-[12.5px] text-muted">没有产出消息。</p>
              ) : (
                <div className="space-y-2">
                  {sysMsgs.map((m, i) => (
                    <div key={i}>
                      <div className="text-[12px] font-medium">{m.message || "（未命名消息）"}</div>
                      <ul className="mt-1 space-y-0.5">
                        {(m.ies || []).map((f, k) => (
                          <li key={k}>
                            <button
                              onClick={(e) => {
                                triggerRef.current = e.currentTarget;
                                setPicked({ msg: m.message || "", ie: f });
                              }}
                              title="查看该字段的证据"
                              className="group flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left font-mono text-[11.5px] hover:bg-surface"
                            >
                              <span className="truncate">{f.name}</span>
                              <span className="flex shrink-0 items-center gap-1 text-muted">
                                {f.value || ""}
                                <Info className="h-3 w-3 opacity-40 group-hover:opacity-100" />
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHead>
              <span className="text-[13px] font-medium">校验违规</span>
              <span className="ml-auto num text-[12px] text-muted">{violations.length}</span>
            </CardHead>
            <CardBody className="scroll-thin max-h-[320px] overflow-auto">
              {out?.status === "abstained" ? (
                <p className="text-[12.5px] text-muted">弃权：无产物可校验。</p>
              ) : !violations.length ? (
                <p className="text-[12.5px] text-muted">无违规（R1 消息存在 / R2 字段合法 / R3 覆盖完整）。</p>
              ) : (
                <ul className="space-y-2">
                  {violations.map((v, i) => (
                    <li key={i} className="text-[12px]">
                      <div className="flex items-center gap-1.5">
                        <Chip tone="bad">{v.rule}</Chip>
                        <span className="font-mono text-[11.5px]">{v.path}</span>
                      </div>
                      <div className="mt-0.5 text-muted">{v.detail}</div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        {/* 步骤表 */}
        {!!out?.steps?.length && (
          <Card className="mt-4">
            <CardHead>
              <span className="text-[13px] font-medium">生成的步骤序列</span>
              <span className="ml-auto num text-[12px] text-muted">{out.steps.length} 步</span>
            </CardHead>
            <CardBody className="p-0">
              <Table>
                <thead>
                  <tr>
                    <Th className="w-12 text-right">#</Th>
                    <Th>主体</Th>
                    <Th>方向</Th>
                    <Th>消息</Th>
                    <Th>关联 TP</Th>
                  </tr>
                </thead>
                <tbody>
                  {out.steps.map((s) => (
                    <tr key={s.st}>
                      <Td className="num text-right">{s.st}</Td>
                      <Td>{s.actor || DASH}</Td>
                      <Td className="font-mono text-[12px]">{s.direction || DASH}</Td>
                      <Td className="max-w-[420px] truncate" title={s.message || ""}>
                        {s.message || DASH}
                      </Td>
                      <Td className="num">{s.tp_ref?.length ? s.tp_ref.join(", ") : DASH}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          </Card>
        )}

        <Card className="mt-4">
          <CardBody className="p-0">
            <RawJson value={{ report, abstain, ie, out }} />
          </CardBody>
        </Card>

        <Modal
          open={!!picked}
          onClose={() => setPicked(null)}
          title={picked ? `${picked.msg} · ${picked.ie.name}` : ""}
        >
          {picked && (
            <div className="space-y-3 text-[12.5px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted">取值</span>
                <span className="font-mono">{picked.ie.value || DASH}</span>
                {pickedGold === true ? (
                  <Chip tone="ok">命中官方叶子字段</Chip>
                ) : pickedGold === false ? (
                  <Chip tone="muted">该消息的官方答案未包含此字段</Chip>
                ) : (
                  <Chip tone="muted">官方答案未单列该消息</Chip>
                )}
              </div>

              <div>
                <div className="mb-1 text-muted">符号表路径（本地收录的 TS 38.331 子集）</div>
                {pickedPaths.length ? (
                  <ul className="space-y-1">
                    {pickedPaths.map((p) => (
                      <li
                        key={p}
                        className="break-all rounded border border-line bg-surface px-2 py-1 font-mono text-[11.5px]"
                      >
                        {p}
                      </li>
                    ))}
                  </ul>
                ) : !sym ? (
                  <p className="text-muted">符号表加载中…</p>
                ) : (
                  <p className="text-muted">
                    本地符号表未收录 {picked.msg} 的 {picked.ie.name} 路径（不代表规范中没有）。
                  </p>
                )}
              </div>

              {picked.ie.condition && (
                <div>
                  <div className="mb-1 text-muted">模型给出的适用条件</div>
                  <p className="whitespace-pre-wrap rounded border border-line bg-surface px-2 py-1">
                    {picked.ie.condition}
                  </p>
                </div>
              )}

              {pickedDerivation && (
                <div>
                  <div className="mb-1 text-muted">模板来源（derivation path）</div>
                  <p className="break-words font-mono text-[11.5px]">{pickedDerivation}</p>
                </div>
              )}

              <div>
                <div className="mb-1 text-muted">校验器</div>
                {pickedViolations.length ? (
                  <ul className="space-y-1">
                    {pickedViolations.map((v, i) => (
                      <li key={i} className="rounded border border-bad/30 bg-bad/5 px-2 py-1">
                        <span className="font-mono text-[11.5px] text-bad">{v.rule}</span>{" "}
                        <span className="font-mono text-[11.5px]">{v.path}</span>
                        <div className="text-muted">{v.detail}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted">无针对该字段的违规。</p>
                )}
              </div>
            </div>
          )}
        </Modal>
      </div>
    </div>
  );
}

export default CaseView;
