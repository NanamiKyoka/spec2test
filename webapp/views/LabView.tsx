"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type CaseItem, type RunRec } from "@/lib/api";
import { currentConversationId } from "@/lib/conversation";
import { startRun, waitTerminal } from "@/lib/followJob";
import { getJobByCase, subscribeJobs } from "@/lib/jobStore";
import { openCasePanel } from "@/lib/panel";
import { Button, Card, CardBody, CardHead, Chip } from "../ui";

type Detail = {
  L1?: number;
  L3?: number | null;
  violations?: unknown[];
  violationCount?: number;
  verdict?: string;
};

type Verdict = { state: string | null; verdict: string | null; detail: Detail };

const label: Record<string, string> = {
  pass: "通过",
  reject: "已拒收",
  abstained: "弃权",
  canceled: "已取消",
  incomplete: "产物不完整",
};

function violationCount(detail: Detail) {
  return detail.violationCount ?? detail.violations?.length ?? 0;
}

export function LabView() {
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [runs, setRuns] = useState<RunRec[]>([]);
  const [, setTick] = useState(0);
  const [running, setRunning] = useState<{ done: number; total: number; current?: string } | null>(null);
  const [dry, setDry] = useState(true);

  const loadRuns = useCallback(() => {
    api
      .runs(50)
      .then((rs) => setRuns(rs))
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.cases().then(setCases).catch(() => setCases([]));
    loadRuns();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeJobs(() => {
      setTick((v) => v + 1);
      // 任务完成会写入后端；合并时以内存为准，稍后再对齐一次持久化结果
      if (timer) clearTimeout(timer);
      timer = setTimeout(loadRuns, 800);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [loadRuns]);

  const latestByCase: Record<string, RunRec> = {};
  runs.forEach((r) => {
    if (r.case && !latestByCase[r.case]) latestByCase[r.case] = r;
  });

  const verdictOf = (caseId: string): Verdict => {
    const job = getJobByCase(caseId);
    if (job) {
      const detail = (job.result?.detail ?? {}) as Detail;
      return { state: job.state, verdict: job.verdict ?? detail.verdict ?? null, detail };
    }
    const r = latestByCase[caseId];
    if (r) {
      return {
        state: r.state,
        verdict: r.verdict ?? null,
        detail: { L1: r.L1 ?? undefined, L3: r.L3 ?? undefined, violationCount: r.violations ?? undefined },
      };
    }
    return { state: null, verdict: null, detail: {} };
  };

  const rows = cases.map((c) => ({ ...c, ...verdictOf(c.case) }));
  const withResults = rows.filter((r) => r.state === "done" || r.state === "failed");
  const hasResults = withResults.length > 0;

  const runAll = async () => {
    if (running) return;
    const list = cases.length ? cases : await api.cases();
    setRunning({ done: 0, total: list.length });
    for (const c of list) {
      setRunning((r) => r && { ...r, current: c.case });
      try {
        const jid = await startRun(c.case, false, currentConversationId() ?? undefined, dry);
        await waitTerminal(jid, c.case, new AbortController().signal);
      } catch {
        /* 单例失败不阻断其余用例 */
      }
      setRunning((r) => r && { ...r, done: r.done + 1, current: undefined });
    }
    setRunning(null);
  };

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="mx-auto max-w-[1100px] px-6 py-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">数据与评测</h1>
            <p className="mt-1 text-sm text-muted">一次跑完全部用例，逐个查看判定与字段覆盖。</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={dry} onChange={(e) => setDry(e.target.checked)} />
              快速模式（不调用模型）
            </label>
            <Button variant="primary" onClick={runAll} disabled={!!running}>
              {running ? `运行中 ${running.done}/${running.total}` : "一键测试全部用例"}
            </Button>
          </div>
        </div>

        {running && (
          <div className="mt-4 rounded-md border border-line bg-surface px-4 py-3 text-sm">
            正在运行：{running.current ?? "…"}（{running.done}/{running.total}）
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-line">
              <div
                className="h-full bg-accent-solid transition-[width]"
                style={{ width: `${Math.round((running.done / Math.max(1, running.total)) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {!hasResults && !running ? (
          <div className="mt-10 rounded-lg border border-dashed border-line bg-canvas px-6 py-14 text-center">
            <p className="text-sm text-muted">还没有运行结果。</p>
            <p className="mt-1 text-xs text-muted">
              点右上角「一键测试全部用例」后，这里会出现逐例判定、L1/L3 与违规图表。
            </p>
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {(["pass", "reject", "abstained"] as const).map((k) => {
                const n = withResults.filter((r) => (r.verdict ?? "") === k).length;
                return (
                  <div key={k} className="rounded-lg border border-line bg-surface px-4 py-3">
                    <div className="text-xs text-muted">{label[k]}</div>
                    <div className="mt-1 text-2xl font-semibold tabular-nums">{n}</div>
                  </div>
                );
              })}
            </div>

            <Card className="mt-6 overflow-x-auto">
              <CardBody className="p-0">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                      <th className="px-3 py-2 font-medium">用例</th>
                      <th className="px-3 py-2 font-medium">标题</th>
                      <th className="px-3 py-2 font-medium">判定</th>
                      <th className="px-3 py-2 text-right font-medium">L1</th>
                      <th className="px-3 py-2 text-right font-medium">L3</th>
                      <th className="px-3 py-2 text-right font-medium">违规</th>
                      <th className="px-3 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.case} className="border-b border-line/60">
                        <td className="px-3 py-2 font-mono /* taste-skill-ignore */ text-xs">{r.case}</td>
                        <td className="max-w-[280px] truncate px-3 py-2 text-muted">{r.title}</td>
                        <td className="px-3 py-2">
                          {r.verdict ? (
                            <Chip tone={r.verdict === "pass" ? "ok" : r.verdict === "reject" || r.verdict === "incomplete" ? "bad" : "muted"}>
                              {label[r.verdict] ?? r.verdict}
                            </Chip>
                          ) : (
                            <span className="text-xs text-muted">{r.state ?? "未运行"}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.detail.L1 ?? "—"}</td> /* taste-skill-ignore */
                        <td className="px-3 py-2 text-right tabular-nums">{r.detail.L3 ?? "—"}</td> /* taste-skill-ignore */
                        <td className="px-3 py-2 text-right tabular-nums">{violationCount(r.detail)}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => openCasePanel(r.case)}
                            className="text-xs text-accent-ink hover:underline"
                          >
                            拆解 →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>

            <Card className="mt-6">
              <CardHead>
                <span className="text-sm font-medium">逐例覆盖率</span>
              </CardHead>
              <CardBody className="space-y-3">
                {rows
                  .filter((r) => r.state === "done")
                  .map((r) => (
                    <div key={r.case} className="text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-mono /* taste-skill-ignore */">{r.case}</span>
                        <span className="text-muted">
                          L1 {r.detail.L1 ?? "—"} · L3 {r.detail.L3 ?? "—"} /* taste-skill-ignore */
                        </span>
                      </div>
                      <div className="mt-1 space-y-1">
                        <div className="h-1.5 overflow-hidden rounded bg-line">
                          <div
                            className="h-full bg-ok"
                            style={{ width: `${Math.round((Number(r.detail.L1 ?? 0) || 0) * 100)}%` }}
                          />
                        </div>
                        <div className="h-1.5 overflow-hidden rounded bg-line">
                          <div
                            className="h-full bg-accent-solid"
                            style={{ width: `${Math.round((Number(r.detail.L3 ?? 0) || 0) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
              </CardBody>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
