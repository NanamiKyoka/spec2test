"use client";

import { useSyncExternalStore } from "react";
import { getJobByCase, subscribeJobs } from "@/lib/jobStore";
import { openCasePanel } from "@/lib/panel";

export type Stage = { stage: string; status?: string; summary?: string; detail?: Record<string, unknown> };

type Violation = { rule: string; path: string; detail: string };

const VERDICT_LABEL: Record<string, string> = {
  pass: "通过",
  reject: "已拒收",
  abstained: "弃权",
  canceled: "已取消",
};

function bar(value: number, color: string) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="h-2 overflow-hidden rounded bg-line">
      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function AnalysisCard({ caseId, stages }: { caseId: string; stages: Stage[] }) {
  const job = useSyncExternalStore(
    subscribeJobs,
    () => getJobByCase(caseId),
    () => undefined
  );
  const byStage = Object.fromEntries(stages.map((s) => [s.stage, s]));
  const score = (byStage.score?.detail ?? {}) as { L1?: number; L3?: number | null; gold_ies?: number };
  const stageViolations = ((byStage.validate?.detail ?? {}) as { violations?: Violation[] }).violations ?? [];
  const live = (job?.result?.detail ?? {}) as {
    L1?: number;
    L3?: number | null;
    violations?: Violation[];
    verdict?: string;
  };

  const L1 = live.L1 ?? score.L1 ?? null;
  const L3 = live.L3 ?? score.L3 ?? null;
  const violations = (live.violations ?? stageViolations) as Violation[];
  const skipped = [byStage.candidates, byStage.generate].some((s) => s?.status === "skipped");
  const verdict = job?.verdict ?? live.verdict ?? (skipped ? "abstained" : null);

  const counts = ["R1", "R2", "R3"].map((rule) => ({
    rule,
    n: violations.filter((v) => v.rule === rule).length,
  }));
  const maxCount = Math.max(1, ...counts.map((c) => c.n));

  return (
    <div className="rounded-md border border-line bg-surface p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">用例分析 · {caseId}</span>
        <span className="text-xs text-muted">{verdict ? VERDICT_LABEL[verdict] ?? verdict : "未判定"}</span>
      </div>

      <div className="mt-3 grid grid-cols-6 gap-2 text-xs">
        <div className="col-span-3 rounded border border-line bg-canvas p-2">
          <div className="text-muted">L1 结构合法率</div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums">{L1 ?? "—"}</div> /* taste-skill-ignore */
          <div className="mt-1">{bar(Number(L1 ?? 0), "bg-ok")}</div>
        </div>
        <div className="col-span-3 rounded border border-line bg-canvas p-2">
          <div className="text-muted">L3 字段召回</div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums">{L3 ?? "—"}</div> /* taste-skill-ignore */
          <div className="mt-1">{bar(Number(L3 ?? 0), "bg-accent-solid")}</div>
        </div>
      </div>

      <div className="mt-3">
        <div className="text-xs text-muted">违规分布（{violations.length} 条）</div>
        <div className="mt-1 space-y-1.5">
          {counts.map(({ rule, n }) => (
            <div key={rule} className="flex items-center gap-2 text-xs">
              <span className="w-6 font-mono /* taste-skill-ignore */">{rule}</span>
              <div className="h-2 flex-1 overflow-hidden rounded bg-line">
                <div
                  className={n > 0 ? "h-full bg-bad" : "h-full bg-transparent"}
                  style={{ width: `${Math.round((n / maxCount) * 100)}%` }}
                />
              </div>
              <span className="w-6 text-right tabular-nums text-muted">{n}</span>
            </div>
          ))}
        </div>
      </div>

      <ul className="mt-3 space-y-0.5 text-xs text-muted">
        {stages.map((s) => (
          <li key={s.stage} className="flex justify-between gap-2">
            <span>{s.stage}</span>
            <span className="truncate text-right">{s.summary || s.status}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => openCasePanel(caseId)}
        className="mt-3 inline-block text-xs text-accent-ink hover:underline"
      >
        查看用例面板 →
      </button>
    </div>
  );
}
