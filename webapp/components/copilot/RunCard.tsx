"use client";

import { useSyncExternalStore } from "react";
import { getJobByCase, subscribeJobs } from "@/lib/jobStore";
import { openCasePanel } from "@/lib/panel";
import {
  MODE_LABELS,
  STRICTNESS_LABELS,
  type RunMode,
  type Strictness,
} from "@/lib/runParams";

type Detail = { L1?: number; L3?: number | null; violations?: unknown[]; verdict?: string };

export function RunCard({ caseId }: { caseId: string }) {
  const job = useSyncExternalStore(
    subscribeJobs,
    () => getJobByCase(caseId),
    () => undefined
  );

  if (!job) {
    return <div className="rounded-md border border-line bg-surface p-3 text-sm text-muted">准备运行 {caseId}…</div>;
  }

  const done = job.state === "done" || job.state === "failed";
  const pct = done ? 100 : Math.min(95, (job.log?.length ?? 0) * 12);
  const detail = (job.result?.detail ?? {}) as Detail;
  const stages = (job as unknown as { stages?: { stage: string; status?: string }[] }).stages ?? [];
  const skipped = stages.some(
    (s) => (s.stage === "generate" || s.stage === "score") && s.status === "skipped"
  );
  const verdict = job.verdict ?? detail.verdict ?? (skipped ? "abstained" : null);
  const violations = detail.violations?.length ?? 0;

  const o = job.options;
  const paramChips: string[] = [];
  if (o?.engine === "agent") paramChips.push("模型自选编排");
  if (o?.mode && o.mode !== "full") paramChips.push(MODE_LABELS[o.mode as RunMode] ?? o.mode);
  if (typeof o?.repairs === "number" && o.repairs !== 1)
    paramChips.push(o.repairs === 0 ? "不修复" : `修复 ${o.repairs} 轮`);
  if (o?.strictness && o.strictness !== "strict")
    paramChips.push(STRICTNESS_LABELS[o.strictness as Strictness] ?? o.strictness);
  if (o?.messages?.length) paramChips.push(`消息 ${o.messages.join(" / ")}`);

  const label =
    verdict === "pass"
      ? "通过"
      : verdict === "reject"
        ? "已拒收"
        : verdict === "abstained"
          ? "弃权"
          : verdict === "canceled"
            ? "已取消"
            : verdict === "incomplete"
              ? "产物不完整"
              : job.state === "failed"
                ? "运行失败"
                : "运行中";
  const dot =
    verdict === "pass"
      ? "bg-ok"
      : verdict === "reject" || verdict === "incomplete" || job.state === "failed"
        ? "bg-bad"
        : "bg-muted";

  return (
    <div className="rounded-md border border-line bg-surface p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">用例 {caseId}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">{job.state}</span>
          <button
            className="text-xs text-accent-ink disabled:opacity-40"
            disabled={!job.id}
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("s2t-trace", { detail: { jobId: job.id ?? "", case: caseId } })
              )
            }
          >
            trace
          </button>
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded bg-line">
        <div className="h-full bg-accent-solid transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      {paramChips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {paramChips.map((c) => (
            <span key={c} className="rounded bg-line/60 px-1.5 py-0.5 text-[11px] text-muted">
              {c}
            </span>
          ))}
        </div>
      )}
      <ul className="scroll-thin mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs text-muted">
        {(job.log ?? []).slice(-8).map((l, i) => (
          <li key={i}>{l.msg}</li>
        ))}
      </ul>
      {job.state === "awaiting_approval" && (
        <div className="mt-2 rounded border border-line bg-canvas p-2">
          <div className="text-xs">
            候选消息：{((job.approval?.candidates ?? []).map((c) => (typeof c === "string" ? c : c.message || c.name || ""))).join(" / ") || "—"} /* taste-skill-ignore */
          </div>
          <div className="mt-1 text-xs text-muted">在对话里确认后继续；也可用审批卡操作。</div>
        </div>
      )}
      {done && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-canvas px-3 py-2 text-xs">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
            {label}
          </span>
          <span className="text-muted">L1 {detail.L1 ?? "—"}</span> /* taste-skill-ignore */
          <span className="text-muted">L3 {detail.L3 ?? "—"}</span> /* taste-skill-ignore */
          <span className="text-muted">违规 {violations}</span>
          <button
            type="button"
            onClick={() => openCasePanel(caseId)}
            className="ml-auto whitespace-nowrap text-accent-ink hover:underline"
          >
            查看拆解 →
          </button>
        </div>
      )}
    </div>
  );
}
