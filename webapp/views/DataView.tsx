"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  HelpCircle,
  History,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Table2,
  TriangleAlert,
} from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardHead,
  Chip,
  Empty,
  Modal,
  Table,
  Td,
  Term,
  Th,
} from "../ui";
import { api, type CaseItem, type RunRec } from "../lib/api";
import { fetchJson } from "@/lib/http";

/* ============================================================
   数据加载（data/ 优先，缺失回落 results/ 快照）
   ============================================================ */

export type Sourced<T> = { data: T | null; from: "live" | "snapshot" | "none"; error?: string };

export type ReportRow = {
  case: string;
  L1: number;
  status: "generated" | "abstained" | string;
  calls: number;
  L3_recall: number | null | "abstained";
  L1_base: number;
  L3_base: number | null;
  L3_base_relaxed?: number | null;
  gold_ie_n: number;
};

export type AbstainRow = {
  case: string;
  in_msg: number;
  status: string;
  calls: number;
  sys_ies: number;
  base_status: "prose" | "absent" | string;
  base_chars: number;
  base_ies: number;
  gold_ies: number;
  unsupported?: boolean;
};

export type ValidateRow = { file: string; case_id: string; violations: { rule: string; path: string; detail: string }[] };

export const loadScore = () => fetchJson<ReportRow[]>("/data/score/report.json", "/results/score/report.json");
export const loadAbstain = () => fetchJson<AbstainRow[]>("/data/score/abstain.json", "/results/score/abstain.json");
/** 官方答案误报的唯一正确来源：对 gold IR 跑校验的产物（0 违规才代表不冤枉正确答案）。 */
export const loadGoldValidate = () =>
  fetchJson<ValidateRow[]>("/data/validate/gold.json", "/results/validate/gold.json");

/* ============================================================
   格式化
   ============================================================ */

export const DASH = "—"; /* taste-skill-ignore */

const RUN_STATE: Record<string, string> = {
  queued: "排队",
  running: "运行中",
  done: "完成",
  failed: "失败",
};
const runState = (s: string) => RUN_STATE[s] ?? s;

export function fmtNum(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined || Number.isNaN(v)) return DASH;
  return v.toFixed(digits);
}

export function fmtL3(v: number | null | "abstained" | undefined): string {
  if (v === "abstained") return "弃权";
  if (v === null || v === undefined) return DASH;
  if (typeof v !== "number" || Number.isNaN(v)) return DASH;
  return v.toFixed(3);
}

export function statusChip(status: string | undefined, verdict?: string | null) {
  if (status === "abstained" || verdict === "abstained") return <Chip tone="muted">弃权</Chip>;
  if (verdict === "reject") return <Chip tone="bad">已拒收</Chip>;
  if (verdict === "pass") return <Chip tone="ok">通过</Chip>;
  if (status === "generated") return <Chip tone="ok">已生成</Chip>;
  return <Chip tone="muted">{status || DASH}</Chip>;
}

/* ============================================================
   指标卡（可点开查看说明）
   ============================================================ */

function MetricCard({
  label,
  value,
  sub,
  explain,
}: {
  label: React.ReactNode;
  value: string;
  sub?: string;
  explain: { title: string; formula: string; denominator: string; limit: string };
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="relative px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs text-muted">{label}</div>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label={`${explain.title} 的说明`}
              title="说明"
              className="rounded p-0.5 text-muted hover:bg-surface hover:text-ink"
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="num mt-1 text-2xl font-semibold leading-none">{value}</div>
          {sub && <div className="mt-1.5 text-xs leading-relaxed text-muted">{sub}</div>}
        </div>

      <Modal open={open} onClose={() => setOpen(false)} title={explain.title}>
        <dl className="space-y-3 text-sm leading-relaxed">
          <div>
            <dt className="text-xs font-medium text-muted">怎么算</dt>
            <dd className="mt-0.5">{explain.formula}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted">分母</dt>
            <dd className="mt-0.5">{explain.denominator}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted">已知限制</dt>
            <dd className="mt-0.5">{explain.limit}</dd>
          </div>
        </dl>
      </Modal>
    </>
  );
}

/* ============================================================
   主视图
   ============================================================ */

export function DataView() {
  const router = useRouter();
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [abstain, setAbstain] = useState<AbstainRow[] | null>(null);
  const [gold, setGold] = useState<ValidateRow[] | null>(null);
  const [source, setSource] = useState<"live" | "snapshot" | "none">("none");
  const [cases, setCases] = useState<Record<string, string>>({});
  const [runs, setRuns] = useState<RunRec[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, "pass" | "reject" | "abstained" | "unknown">>({});
  const [filter, setFilter] = useState<"all" | "pass" | "reject" | "abstained" | "unknown">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [score, abs, gv] = await Promise.all([loadScore(), loadAbstain(), loadGoldValidate()]);
      if (!alive) return;
      // 逐例判定：正式产物优先，缺判定时回退 out_rejected（与单例页口径一致）
      const entries = await Promise.all(
        (score.data || []).map(async (r) => {
          const out = (
            await fetchJson<{ status?: string; verdict?: string | null; violations?: unknown[] }>(
              `/data/out/${r.case}.json`, `/results/out/${r.case}.json`
            )
          ).data;
          let v: "pass" | "reject" | "abstained" | "unknown" = "unknown";
          if (out?.status === "abstained") v = "abstained";
          else if (out?.verdict === "reject") v = "reject";
          else if ((out?.violations?.length ?? 0) > 0) v = "reject";
          else if (out?.verdict === "pass") v = "pass";
          else {
            const rej = (
              await fetchJson<{ verdict?: string | null }>(
                `/data/out_rejected/${r.case}.json`, `/results/out_rejected/${r.case}.json`
              )
            ).data;
            if (rej?.verdict === "reject") v = "reject";
            else if (r.status === "abstained") v = "abstained";
          }
          return [r.case, v] as const;
        })
      );
      if (!alive) return;
      setVerdicts(Object.fromEntries(entries));
      setRows(score.data);
      setAbstain(abs.data);
      setGold(gv.data);
      setSource(score.from === "none" ? abs.from : score.from);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .cases()
      .then((list: CaseItem[]) => {
        if (!alive) return;
        const map: Record<string, string> = {};
        list.forEach((c) => (map[c.case] = c.title));
        setCases(map);
      })
      .catch(() => {
        /* 标题缺失不阻塞矩阵渲染：退化为空标题 */
      });
    api
      .runs(20)
      .then((r) => alive && setRuns(r))
      .catch((e: Error) => alive && setRunsError(e.message || "后端不可达"));
    return () => {
      alive = false;
    };
  }, []);

  const abstainMap = useMemo(() => {
    const m: Record<string, AbstainRow> = {};
    (abstain || []).forEach((a) => (m[a.case] = a));
    return m;
  }, [abstain]);

  const metrics = useMemo(() => {
    const n = rows?.length ?? 0;
    const goldTotal = (rows || []).reduce((s, r) => s + (r.gold_ie_n || 0), 0);
    const abstained = (rows || []).filter((r) => r.status === "abstained").length;
    const vCases = gold?.length ?? 0;
    const vViol = (gold || []).reduce((s, r) => s + (r.violations?.length || 0), 0);
    const l1Ok = (rows || []).filter((r) => r.L1 === 1).length;
    return { n, goldTotal, abstained, vCases, vViol, l1Ok };
  }, [rows, gold]);

  const counts = useMemo(() => {
    const c = { all: 0, pass: 0, reject: 0, abstained: 0, unknown: 0 };
    for (const r of rows || []) {
      c.all++;
      c[verdicts[r.case] ?? "unknown"]++;
    }
    return c;
  }, [rows, verdicts]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        正在读取评测数据…
      </div>
    );
  }

  if (!rows && !abstain) {
    return (
      <div className="h-full overflow-y-auto scroll-thin">
        <div className="mx-auto max-w-[1100px] px-6 py-6">
          <h1 className="text-xl font-semibold tracking-tight">数据面板</h1>
          <Card className="mt-6">
            <Empty
              title="还没有评测数据。先在仓库根目录运行 scripts/repro.sh 生成数据，再刷新本页。"
              icon={<Table2 className="h-5 w-5" />}
              action={
                <Button variant="primary" onClick={() => window.location.reload()}>
                  <RefreshCw className="h-4 w-4" /> 刷新
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
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">数据面板</h1>
            <p className="mt-1 max-w-prose text-sm text-muted">
              8 个用例的逐例结果与运行历史。
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {source === "snapshot" && (
              <Chip tone="warn">
                <TriangleAlert className="h-3 w-3" /> 仓库自带快照
              </Chip>
            )}
            {source === "live" && <Chip tone="ok">实时数据</Chip>}
          </div>
        </div>

        {source === "snapshot" && (
          <p className="mt-2 max-w-prose text-xs text-muted">
            当前显示的是仓库自带的结果快照；运行 <code className="font-mono /* taste-skill-ignore */">scripts/repro.sh</code> 可生成你自己的结果。
          </p>
        )}

        {/* 指标 */}
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard
            label="用例数"
            value={String(metrics.n)}
            sub="本条切片的全部用例"
            explain={{
              title: "用例数",
              formula: "统计 data/score/report.json 中的用例条数。",
              denominator: `分母 = 入选用例总数（当前 ${metrics.n}）。`,
              limit: "切片仅覆盖 §6.7 的 8 个 NTN 用例，不代表整个 5G/6G 测试体系。",
            }}
          />
          <MetricCard
            label={
              <Term
                term="gold 字段"
                desc="官方答案里真正赋值的叶子字段总数。容器与类型定义行不计入。"
              />
            }
            value={String(metrics.goldTotal)}
            sub={`结构合法 ${metrics.l1Ok} / ${metrics.n}`}
            explain={{
              title: "gold 字段",
              formula: "按用例累加官方答案的叶子字段数（字段名去重，GSO/NGSO 条件分支不重复计数）。",
              denominator: `分母 = ${metrics.n} 个用例；字段合计 ${metrics.goldTotal}。`,
              limit: "6.7.1.1 原文的信令内容为 None，该例计 0，不参与 L3 分母。",
            }}
          />
          <MetricCard
            label={
              <Term
                term="弃权"
                desc="输入信息不足时，系统明确声明不生成，且不进入字段级生成——既不是失败，也不是 0 分。" /* taste-skill-ignore */
              />
            }
            value={String(metrics.abstained)}
            sub="未生成 IE 字段内容"
            explain={{
              title: "弃权",
              formula: "统计 status=abstained 的用例数：候选消息集为空即弃权，字段级调用为 0。",
              denominator: `分母 = ${metrics.n} 个用例。`,
              limit: "弃权是正确行为（拒绝编造），因此标记为灰色，不使用错误色。",
            }}
          />
          <MetricCard
            label={
              <Term
                term="官方答案误报"
                desc="用校验器跑官方答案，被误判为违规的条目数。0 表示校验器不冤枉正确答案。"
              />
            }
            value={
              gold
                ? `${metrics.vViol} / ${metrics.vCases}`
                : DASH
            }
            sub={gold ? "对 gold IR 跑校验" : "快照未含 gold 校验产物"}
            explain={{
              title: "官方答案误报",
              formula: "对官方答案（gold IR）运行校验器，统计违规条目总数。",
              denominator: `分母 = 被校验的用例数（当前 ${metrics.vCases}）。`,
              limit: "该项只检查 R1 消息存在性（官方字段路径未全部比对）；生成输出另有独立误报率。",
            }}
          />
        </div>

        {/* 用例矩阵 */}
        <Card className="mt-6">
          <CardHead>
            <Table2 className="h-4 w-4 text-muted" />
            <span className="text-sm font-medium">用例矩阵</span>
            <span className="ml-auto text-xs text-muted">点击行查看单例全链条</span>
          </CardHead>
          <CardBody className="p-0">
            <p className="border-b border-line px-3 py-2 text-xs leading-relaxed text-muted">
              绿=通过；灰=弃权；红=拒收。点用例号查看字段级证据。
            </p>
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
              {(
                [
                  ["all", "全部"],
                  ["pass", "通过"],
                  ["reject", "已拒收"],
                  ["abstained", "弃权"],
                  ["unknown", "未判定"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  aria-pressed={filter === k}
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    filter === k
                      ? "border-accent bg-accent/10 text-accent-ink"
                      : "border-line text-muted hover:bg-surface"
                  }`}
                >
                  {label} <span className="num">{counts[k]}</span>
                </button>
              ))}
            </div>
            <Table>
              <thead>
                <tr>
                  <Th>用例</Th>
                  <Th>标题</Th>
                  <Th>状态</Th>
                  <Th className="text-right">IE 调用</Th>
                  <Th className="text-right">
                    <Term term="L1" desc="结构合法率：生成物能否解析成 IR，且每个步骤都有主体/方向/消息。" />
                  </Th>
                  <Th className="text-right">
                    <Term term="L3" desc="关键 IE 命中率：生成字段对官方叶子字段的召回。分母为有 gold 字段的用例。" />
                  </Th>
                  <Th className="text-right">
                    <Term term="gold" desc="该用例官方答案的叶子字段数。" />
                  </Th>
                </tr>
              </thead>
              <tbody>
                {(rows || [])
                  .filter((r) => filter === "all" || (verdicts[r.case] ?? "unknown") === filter)
                  .map((r) => (
                  <tr
                    key={r.case}
                    tabIndex={0}
                    role="button"
                    aria-label={`查看用例 ${r.case} 的单例全链条`}
                    className="cursor-pointer hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
                    onClick={() => {
                      router.push(`/case/${encodeURIComponent(r.case)}`);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(`/case/${encodeURIComponent(r.case)}`);
                      }
                    }}
                  >
                    <Td className="num font-mono /* taste-skill-ignore */">{r.case}</Td>
                    <Td className="max-w-[380px] truncate" title={cases[r.case] || ""}>
                      {cases[r.case] || <span className="text-muted">（标题不可用）</span>}
                    </Td>
                    <Td>{statusChip(r.status, verdicts[r.case] ?? null)}</Td>
                    <Td className="num text-right">{r.calls ?? DASH}</Td>
                    <Td className="num text-right">{fmtNum(r.L1)}</Td>
                    <Td className="num text-right">{fmtL3(r.L3_recall)}</Td>
                    <Td className="num text-right">{r.gold_ie_n ?? DASH}</Td>
                  </tr>
                ))}
                {filter !== "all" &&
                  !(rows || []).some((r) => (verdicts[r.case] ?? "unknown") === filter) && (
                    <tr>
                      <Td colSpan={7} className="py-6 text-center text-sm text-muted">
                        没有符合条件的用例。
                      </Td>
                    </tr>
                  )}
              </tbody>
            </Table>
          </CardBody>
        </Card>

        {/* 运行历史 */}
        <Card className="mt-6">
          <CardHead>
            <History className="h-4 w-4 text-muted" />
            <span className="text-sm font-medium">运行历史</span>
            {runs?.length ? <span className="ml-auto text-xs text-muted">最近 {runs.length} 次</span> : null}
          </CardHead>
          <CardBody className="p-0">
            {runsError ? (
              <div className="flex items-center gap-2 px-4 py-4 text-sm text-bad-ink">
                <TriangleAlert className="h-4 w-4" /> 运行历史不可用：{runsError}
              </div>
            ) : !runs ? (
              <div className="px-4 py-4 text-sm text-muted">正在读取…</div>
            ) : runs.length === 0 ? (
              <Empty
                title="还没有运行记录。运行一次用例后，这里会出现 job、耗时与 verdict。"
                icon={<History className="h-5 w-5" />}
                action={
                  <Button variant="primary" onClick={() => router.push("/")}>
                    <MessageSquare className="h-4 w-4" /> 去对话跑一次
                  </Button>
                }
              />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>job</Th>
                    <Th>用例</Th>
                    <Th>状态</Th>
                    <Th>verdict</Th>
                    <Th>说明</Th>
                    <Th className="text-right">耗时</Th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((x) => (
                    <tr key={x.job_id}>
                      <Td className="font-mono /* taste-skill-ignore */ text-xs">{x.job_id}</Td>
                      <Td className="num font-mono /* taste-skill-ignore */">{x.case}</Td>
                      <Td>
                        <Chip tone={x.state === "done" ? "ok" : x.state === "failed" ? "bad" : "muted"}>{runState(x.state)}</Chip>
                      </Td>
                      <Td>{statusChip(undefined, x.verdict ?? null)}</Td>
                      <Td className="max-w-[360px] text-xs leading-relaxed text-muted">
                        {x.summary || DASH}
                      </Td>
                      <Td className="num text-right">{x.seconds != null ? `${Number(x.seconds).toFixed(2)}s` : DASH}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>

        {/* 弃权 vs 无依据 */}
        <Card className="mt-6">
          <CardHead>
            <ShieldCheck className="h-4 w-4 text-muted" />
            <span className="text-sm font-medium">弃权与基线对照</span>
            <span className="ml-auto text-xs text-muted">系统输出与基线输出的对照</span>
          </CardHead>
          <CardBody className="p-0">
            {!abstain?.length ? (
              <div className="px-4 py-4 text-sm text-muted">该快照未包含弃权统计。</div>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>用例</Th>
                    <Th className="text-right">输入消息名</Th>
                    <Th className="text-right">系统 调用 / IE</Th>
                    <Th>基线输出</Th>
                    <Th className="text-right">gold IE</Th>
                    <Th>标记</Th>
                  </tr>
                </thead>
                <tbody>
                  {abstain.map((a) => {
                    const zero = a.calls === 0 && a.sys_ies === 0;
                    return (
                      <tr key={a.case} className={zero ? "bg-surface/60" : undefined}>
                        <Td className="num font-mono /* taste-skill-ignore */">{a.case}</Td>
                        <Td className="num text-right">{a.in_msg ?? DASH}</Td>
                        <Td className="num text-right">
                          {a.calls} / {a.sys_ies}
                        </Td>
                        <Td className="text-sm">
                          {a.base_status === "prose" ? (
                            <span className="text-muted">
                              散文 {a.base_chars} 字 / {a.base_ies} IE
                            </span>
                          ) : (
                            DASH
                          )}
                        </Td>
                        <Td className="num text-right">{a.gold_ies ?? DASH}</Td>
                        <Td>
                          {zero ? (
                            <Chip tone="muted">0 调用 0 条 IE</Chip>
                          ) : a.unsupported ? (
                            <Chip tone="warn">unsupported</Chip>
                          ) : (
                            <span className="text-xs text-muted">{a.status}</span>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>

      </div>
    </div>
  );
}

export default DataView;
