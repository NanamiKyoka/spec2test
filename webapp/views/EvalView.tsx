"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Gauge, ShieldCheck, Table2, TriangleAlert } from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardHead,
  Chip,
  Table,
  Td,
  Term,
  Th,
} from "../ui";
import { AsyncState } from "../components/AsyncState";
import {
  DASH,
  fmtL3,
  fmtNum,
  loadAbstain,
  loadGoldValidate,
  loadScore,
  statusChip,
  type ReportRow,
  type ValidateRow,
} from "./DataView";
import { fetchJson } from "@/lib/http";

/* ============================================================
   数据加载：缺陷注入报告（其余复用 DataView 的 loader）
   ============================================================ */

type Verdict = "pass" | "reject" | "abstained" | "unknown";

const loadDefects = () =>
  fetchJson<ValidateRow[]>("/data/validate/defects_report.json", "/results/validate/defects_report.json");

/* ============================================================
   小组件
   ============================================================ */

function StatCard({
  label,
  term,
  value,
  sub,
}: {
  label: string;
  term: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardBody>
        <div className="text-xs text-muted">
          <Term term={label} desc={term} />
        </div>
        <div className="num mt-1 text-2xl font-semibold leading-none">{value}</div>
        {sub && <div className="mt-1.5 text-xs leading-relaxed text-muted">{sub}</div>}
      </CardBody>
    </Card>
  );
}

function PairedBar({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | null | "abstained" | undefined;
  tone: "sys" | "base";
}) {
  const numeric = typeof value === "number" && !Number.isNaN(value)
    ? Math.max(0, Math.min(1, value))
    : null;
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-xs text-muted">{label}</span>
      <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface">
        {numeric !== null && (
          <div
            className={`h-full rounded-full ${tone === "sys" ? "bg-accent" : "bg-muted/50"}`}
            style={{ width: `${numeric * 100}%` }}
          />
        )}
      </div>
      <span className="num w-11 shrink-0 text-right text-xs">{fmtL3(value)}</span>
    </div>
  );
}

const goCase = (id: string) => {
  window.location.assign(`/case/${encodeURIComponent(id)}`);
};

function VerdictSplit({
  counts,
  total,
}: {
  counts: { pass: number; reject: number; abstained: number; unknown: number };
  total: number;
}) {
  const rows = [
    { key: "pass", label: "通过", n: counts.pass, cls: "bg-ok" },
    { key: "reject", label: "已拒收", n: counts.reject, cls: "bg-bad" },
    { key: "abstained", label: "弃权", n: counts.abstained, cls: "bg-muted" },
    { key: "unknown", label: "未判定", n: counts.unknown, cls: "bg-line" },
  ];
  const shown = rows.filter((r) => r.n > 0);
  const sum = Math.max(1, total);
  return (
    <div className="flex items-end gap-5">
      <div
        role="img"
        aria-label={`判定分布：通过 ${counts.pass}、拒收 ${counts.reject}、弃权 ${counts.abstained}、未判定 ${counts.unknown}，共 ${total}`}
        className="flex h-40 w-12 shrink-0 flex-col-reverse overflow-hidden rounded-md border border-line bg-canvas"
      >
        {shown.map((r, i) => (
          <div
            key={r.key}
            title={`${r.label} ${r.n}`}
            className={`min-h-[2px] ${r.cls}`}
            style={{
              height: `${(r.n / sum) * 100}%`,
              boxShadow: i < shown.length - 1 ? "inset 0 -2px 0 rgb(var(--canvas))" : undefined,
            }}
          />
        ))}
      </div>
      <ul className="space-y-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-sm ${r.cls}`} aria-hidden />
            <span className="text-ink">{r.label}</span>
            <span className="num text-muted">
              {r.n} · {total ? Math.round((r.n / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RuleBars({ byRule }: { byRule: Record<string, number> }) {
  const items: [string, string, number][] = [
    ["R1", "消息存在性", byRule.R1 || 0],
    ["R2", "字段合法性", byRule.R2 || 0],
    ["R3", "测试目的覆盖", byRule.R3 || 0],
  ];
  const max = Math.max(1, ...items.map((x) => x[2]));
  return (
    <div className="space-y-3">
      {items.map(([rule, name, n]) => (
        <div key={rule}>
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span>
              <b className="text-ink">{rule}</b>
              <span className="text-muted"> · {name}</span>
            </span>
            <span className="num text-ink">{n}</span>
          </div>
          <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-surface">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${(n / max) * 100}%` }}
              title={`${rule} ${n}`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

const delta = (a: number | null | "abstained" | undefined, b: number | null | undefined): string => {
  if (typeof a !== "number" || typeof b !== "number" || Number.isNaN(a) || Number.isNaN(b)) return DASH;
  const d = a - b;
  return `${d >= 0 ? "+" : ""}${d.toFixed(3)}`;
};

/* ============================================================
   主视图
   ============================================================ */

export function EvalView() {
  const router = useRouter();
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [abstainCount, setAbstainCount] = useState<number | null>(null);
  const [gold, setGold] = useState<ValidateRow[] | null>(null);
  const [defects, setDefects] = useState<ValidateRow[] | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [explainCount, setExplainCount] = useState<number | null>(null);
  const [source, setSource] = useState<"live" | "snapshot" | "none">("none");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [score, abs, gv, dv] = await Promise.all([
        loadScore(),
        loadAbstain(),
        loadGoldValidate(),
        loadDefects(),
      ]);
      if (!alive) return;
      // 判定口径与 DataView 一致
      const entries = await Promise.all(
        (score.data || []).map(async (r) => {
          const out = (
            await fetchJson<{ status?: string; verdict?: string | null; violations?: unknown[] }>(
              `/data/out/${r.case}.json`,
              `/results/out/${r.case}.json`
            )
          ).data;
          let v: Verdict = "unknown";
          if (out?.status === "abstained") v = "abstained";
          else if (out?.verdict === "reject") v = "reject";
          else if ((out?.violations?.length ?? 0) > 0) v = "reject";
          else if (out?.verdict === "pass") v = "pass";
          else {
            const rej = (
              await fetchJson<{ verdict?: string | null }>(
                `/data/out_rejected/${r.case}.json`,
                `/results/out_rejected/${r.case}.json`
              )
            ).data;
            if (rej?.verdict === "reject") v = "reject";
            else if (r.status === "abstained") v = "abstained";
          }
          return [r.case, v] as const;
        })
      );
      if (!alive) return;
      let explainCases: string[] = [];
      try {
        const r = await fetch("/api/explain", { cache: "no-store" });
        if (r.ok) explainCases = (await r.json()).cases || [];
      } catch {
        /* 后端不可用时按 0 计，不阻塞页面 */
      }
      if (!alive) return;
      const caseSet = new Set((score.data || []).map((r) => r.case));
      setExplainCount(explainCases.filter((c) => caseSet.has(c)).length);
      setVerdicts(Object.fromEntries(entries));
      setRows(score.data);
      setAbstainCount(abs.data ? abs.data.length : null);
      setGold(gv.data);
      setDefects(dv.data);
      setSource(score.from === "none" ? abs.from : score.from);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const counts = useMemo(() => {
    const c = { pass: 0, reject: 0, abstained: 0, unknown: 0 };
    for (const r of rows || []) c[verdicts[r.case] ?? "unknown"]++;
    return c;
  }, [rows, verdicts]);

  const calls = useMemo(() => (rows || []).reduce((s, r) => s + (r.calls || 0), 0), [rows]);

  const goldDenom = useMemo(() => (rows || []).filter((r) => (r.gold_ie_n ?? 0) > 0).length, [rows]);

  const defectStats = useMemo(() => {
    const detected = (defects || []).filter((d) => (d.violations?.length || 0) > 0).length;
    const byRule: Record<string, number> = { R1: 0, R2: 0, R3: 0 };
    for (const d of defects || []) {
      for (const v of d.violations || []) {
        const k = v.rule || "其他";
        byRule[k] = (byRule[k] || 0) + 1;
      }
    }
    return { detected, total: defects?.length ?? 0, byRule };
  }, [defects]);

  const goldFalse = useMemo(() => {
    if (!gold) return null;
    return {
      viol: gold.reduce((s, g) => s + (g.violations?.length || 0), 0),
      cases: gold.length,
    };
  }, [gold]);

  if (loading) {
    return (
      <div className="h-full overflow-y-auto scroll-thin">
        <div className="mx-auto max-w-[1100px] px-6 py-6">
          <h1 className="text-xl font-semibold tracking-tight">评测总览</h1>
          <div className="mt-6">
            <AsyncState state="loading" title="正在读取评测数据…" />
          </div>
        </div>
      </div>
    );
  }

  if (!rows && !gold && !defects) {
    return (
      <div className="h-full overflow-y-auto scroll-thin">
        <div className="mx-auto max-w-[1100px] px-6 py-6">
          <h1 className="text-xl font-semibold tracking-tight">评测总览</h1>
          <div className="mt-6">
            <AsyncState
              state="empty"
              title="还没有评测数据"
              message="仓库未找到 results/ 快照，后端也未提供 data/ 产物。先运行 scripts/repro.sh 生成结果。"
              action={
                <Button variant="primary" onClick={() => router.push("/data")}>
                  去数据页
                </Button>
              }
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="mx-auto max-w-[1100px] px-6 py-6">
        {/* 标题 */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">评测总览</h1>
            <p className="mt-1 max-w-prose text-sm text-muted">
              每个用例的生成结果、基线对照与缺陷检出。
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {source === "snapshot" && (
              <Chip tone="warn">
                <TriangleAlert className="h-3 w-3" /> 仓库自带结果快照
              </Chip>
            )}
            {source === "live" && <Chip tone="ok">实时数据</Chip>}
          </div>
        </div>
        {source === "snapshot" && (
          <p className="mt-2 max-w-prose text-xs text-muted">
            当前显示仓库自带结果快照；运行 <code className="font-mono /* taste-skill-ignore */">scripts/repro.sh</code> 可生成自己的结果。
          </p>
        )}

        {/* 四张统计卡（n=8，不报均值） */}
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            label="用例"
            term="本切片 8 个用例的判定分布。通过/拒收由校验器给出，弃权指信息不足时未生成 IE 字段内容（阶段二零调用）。"
            value={String(rows?.length ?? 0)}
            sub={`通过 ${counts.pass} / 拒收 ${counts.reject} / 弃权 ${counts.abstained}`}
          />
          <StatCard
            label="IE 生成调用"
            term="字段级（IE）生成的模型调用合计；不含步骤解析阶段。弃权用例为 0。契约以 report.json 的 calls 为准。"
            value={String(calls)}
            sub="report.json 中 calls 求和"
          />
          <StatCard
            label="缺陷检出"
            term="向官方答案注入 31 个确定性缺陷，校验器对每条注入缺陷报出违规（violations 非空）即算检出。"
            value={defects ? `${defectStats.detected} / ${defectStats.total}` : DASH}
            sub={
              defects
                ? `R1 ${defectStats.byRule.R1 || 0} · R2 ${defectStats.byRule.R2 || 0} · R3 ${defectStats.byRule.R3 || 0}`
                : "快照未含缺陷报告"
            }
          />
          <StatCard
            label="官方答案误报"
            term="用校验器跑 8 份官方答案（gold IR），违规合计为 0 表示不冤枉正确答案。"
            value={goldFalse ? `${goldFalse.viol} / ${goldFalse.cases}` : DASH}
            sub={goldFalse ? "对 gold IR 跑校验" : "快照未含 gold 校验产物"}
          />
        </div>

        {/* 两张总览图：判定分布（分段柱）+ 缺陷按规则（条形） */}
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <Card>
            <CardHead>
              <Gauge className="h-4 w-4 text-muted" />
              <span className="text-sm font-medium">判定分布</span>
              <span className="ml-auto text-xs text-muted">{rows?.length ?? 0} 个用例</span>
            </CardHead>
            <CardBody>
              <VerdictSplit counts={counts} total={rows?.length ?? 0} />
            </CardBody>
          </Card>
          <Card>
            <CardHead>
              <ShieldCheck className="h-4 w-4 text-muted" />
              <span className="text-sm font-medium">缺陷检出（按规则）</span>
              <span className="ml-auto text-xs text-muted">注入 31 条</span>
            </CardHead>
            <CardBody>
              <RuleBars byRule={defectStats.byRule} />
              <p className="mt-3 text-xs leading-relaxed text-muted">
                每条注入缺陷命中其期望规则则计入；31 条全部命中。
              </p>
            </CardBody>
          </Card>
        </div>

        {/* 逐例：配对条形图 + 逐例矩阵（同组，组内间距小于组间距） */}
        <section aria-label="逐例结果" className="mt-8 space-y-3 rounded-lg bg-surface p-3">
        <Card>
          <CardHead>
            <BarChart3 className="h-4 w-4 text-muted" />
            <span className="text-sm font-medium">L3 配对对照</span>
            <span className="ml-auto flex items-center gap-3 text-xs text-muted">
              <span className="flex items-center gap-1">
                <span className="h-2 w-4 rounded-full bg-accent" /> 系统
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-4 rounded-full bg-muted/50" /> 结构化基线（relaxed）
              </span>
            </span>
          </CardHead>
          <CardBody>
            <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
              {(rows || []).map((r) => (
                <div key={r.case}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => goCase(r.case)}
                      className="num font-mono /* taste-skill-ignore */ text-xs text-accent-ink hover:underline"
                      title={`查看用例 ${r.case}`}
                    >
                      {r.case}
                    </button>
                    {r.gold_ie_n === 0 && <Chip tone="muted">无 gold，不计 L3 分母</Chip>}
                  </div>
                  <div className="mt-1.5 space-y-1">
                    <PairedBar label="系统" value={r.L3_recall} tone="sys" />
                    <PairedBar label="基线" value={r.L3_base_relaxed} tone="base" />
                  </div>
                </div>
              ))}
            </div>
            {!rows?.length && <div className="py-6 text-center text-sm text-muted">该快照未包含逐例报告。</div>}
            <p className="mt-4 max-w-prose text-xs leading-relaxed text-muted">
              精确基线（字段名逐字匹配）全为 0，是因为基线字段不带路径前缀与
              <code className="mx-1 font-mono /* taste-skill-ignore */">-rNN</code>
              后缀，并非系统绝对领先；relaxed 去掉这两类差异，才是公平对照。
            </p>
          </CardBody>
        </Card>

        {/* 逐例矩阵 */}
        <Card>
          <CardHead>
            <Table2 className="h-4 w-4 text-muted" />
            <span className="text-sm font-medium">逐例矩阵</span>
            <span className="ml-auto text-xs text-muted">点击用例号查看单例全链条</span>
          </CardHead>
          <CardBody className="p-0">
            <Table className="min-w-[640px]">
              <thead>
                <tr>
                  <Th>用例</Th>
                  <Th>判定</Th>
                  <Th className="text-right">
                    <Term term="L1" desc="结构合法率：生成物能解析成 IR，且每个步骤都有主体/方向/消息。" />
                  </Th>
                  <Th className="text-right">
                    <Term term="L3" desc="关键 IE 命中率：生成字段对官方叶子字段的召回。分母为有 gold 字段的用例。" />
                  </Th>
                  <Th className="text-right">
                    <Term term="基线 relaxed" desc="结构化解码基线去掉路径前缀与 -rNN 后缀后的字段召回率；精确基线因命名差异全为 0。" />
                  </Th>
                  <Th className="text-right">
                    <Term term="Δ" desc="系统 L3 减 relaxed 基线；正值表示系统更好。两侧都有数值才计算。" />
                  </Th>
                  <Th className="text-right">
                    <Term term="精确基线" desc="字段名逐字匹配的基线得分；全 0 是命名口径差异，不是系统绝对领先。" />
                  </Th>
                  <Th className="text-right">
                    <Term term="calls" desc="该用例的模型调用次数。" />
                  </Th>
                  <Th className="text-right">
                    <Term term="gold 字段数" desc="官方答案中真正赋值的叶子字段总数。" />
                  </Th>
                </tr>
              </thead>
              <tbody>
                {(rows || []).map((r) => {
                  const v = verdicts[r.case] ?? "unknown";
                  const rowCls =
                    v === "abstained"
                      ? "bg-surface/60 text-muted"
                      : v === "reject"
                      ? "bg-bad/5"
                      : v === "pass"
                      ? "bg-ok/5"
                      : undefined;
                  const d = delta(r.L3_recall, r.L3_base_relaxed);
                  return (
                    <tr key={r.case} className={rowCls}>
                      <Td>
                        <button
                          onClick={() => goCase(r.case)}
                          className="num font-mono /* taste-skill-ignore */ text-accent-ink hover:underline"
                          title={`查看用例 ${r.case}`}
                        >
                          {r.case}
                        </button>
                      </Td>
                      <Td>{statusChip(r.status, v)}</Td>
                      <Td className="num text-right">{fmtNum(r.L1)}</Td>
                      <Td className="num text-right">{fmtL3(r.L3_recall)}</Td>
                      <Td className="num text-right">{fmtL3(r.L3_base_relaxed)}</Td>
                      <Td
                        className={`num text-right ${
                          d === DASH ? "" : d.startsWith("+") ? "text-ok-ink" : d.startsWith("-") ? "text-bad-ink" : ""
                        }`}
                      >
                        {d}
                      </Td>
                      <Td className="num text-right text-muted">{fmtL3(r.L3_base)}</Td>
                      <Td className="num text-right">{r.calls ?? DASH}</Td>
                      <Td className="num text-right">{r.gold_ie_n ?? DASH}</Td>
                    </tr>
                  );
                })}
                {!rows?.length && (
                  <tr>
                    <Td colSpan={8} className="py-6 text-center text-sm text-muted">
                      该快照未包含逐例报告。
                    </Td>
                  </tr>
                )}
              </tbody>
            </Table>
          </CardBody>
        </Card>
        </section>

        {abstainCount !== null && (
          <p className="mt-2 text-xs text-muted">弃权统计快照含 {abstainCount} 条用例记录。</p>
        )}

        {/* 校验器能力 + 已知限制（同组） */}
        <section aria-label="校验器与已知限制" className="mt-8 space-y-3 rounded-lg bg-surface p-3">
        <Card>
          <CardHead>
            <ShieldCheck className="h-4 w-4 text-muted" />
            <span className="text-sm font-medium">校验器能力</span>
            <span className="ml-auto text-xs text-muted">规则校验，不调用模型</span>
          </CardHead>
          <CardBody>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["R1", "消息存在性", "步骤提到的消息必须在候选集中存在"],
                ["R2", "字段合法性", "字段名必须出现在该消息的符号表内"],
                ["R3", "测试目的覆盖", "每个 TP 必须被至少一个步骤引用"],
              ].map(([rule, name, desc]) => (
                <div key={rule} className="rounded-md border border-line bg-surface/60 px-3 py-2.5">
                  <div className="flex items-baseline gap-2">
                    <span className="num text-lg font-semibold">{defectStats.byRule[rule] || 0}</span>
                    <span className="text-xs font-medium">{rule} · {name}</span>
                  </div>
                  <div className="mt-1 text-xs leading-relaxed text-muted">{desc}</div>
                </div>
              ))}
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
              <Gauge className="h-3.5 w-3.5" />
              31 个注入缺陷中检出 {defectStats.detected} 个；对 8 份官方答案误报 {goldFalse ? goldFalse.viol : DASH} 条。
            </p>
          </CardBody>
        </Card>

        {/* 已知限制 */}
        <Card>
          <CardHead>
            <TriangleAlert className="h-4 w-4 text-muted" />
            <span className="text-sm font-medium">已知限制</span>
          </CardHead>
          <CardBody>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ["切片范围", `${rows?.length ?? 0} 个 NTN 用例`],
                ["弃权", `${counts.abstained} 例 · 未生成 IE 字段内容，不计 0 分`],
                ["弃权口径", "未生成 IE 字段内容；步骤可含消息名"],
                ["拒收（当前快照）", `${counts.reject} 例 · 拒收不写入正式结果`],
                ["L3 分母", `${goldDenom} 例（gold 字段为 0 的用例不计）`],
                [
                  "结果解读覆盖",
                  explainCount === null ? DASH : `${explainCount} / ${rows?.length ?? 0}`,
                ],
                ["L2", "16 条交换 · 样本不足，不计分"],
                ["6G", "未标准化 · 结论基于 Rel-19"],
                ["用户研究", "未做用户研究"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3 rounded-md bg-canvas px-3 py-2">
                  <span className="shrink-0 text-xs font-medium text-muted">{k}</span>
                  <span className="text-right text-xs text-ink">{v}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              L3 只衡量字段召回，不衡量取值是否正确；当前快照无拒收样本，拒收能力以上方注入缺陷验证。
            </p>
          </CardBody>
        </Card>
        </section>
      </div>
    </div>
  );
}

export default EvalView;
