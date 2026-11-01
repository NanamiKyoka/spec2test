"use client";

import { useSyncExternalStore } from "react";
import { getJobByCase, subscribeJobs } from "@/lib/jobStore";

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

  return (
    <div className="rounded-md border border-line bg-surface p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">用例 {caseId}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">{job.state}</span>
          <button
            className="text-xs text-accent-ink"
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
        <div className="h-full bg-accent-solid transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ul className="scroll-thin mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs text-muted">
        {(job.log ?? []).slice(-8).map((l, i) => (
          <li key={i}>{l.msg}</li>
        ))}
      </ul>
      {job.state === "awaiting_approval" && (
        <div className="mt-2 rounded border border-line bg-canvas p-2">
          <div className="text-xs">
            候选消息：{((job.approval?.candidates ?? []).map((c) => (typeof c === "string" ? c : c.message || c.name || ""))).join(" / ") || "—"}
          </div>
          <div className="mt-1 text-xs text-muted">在对话里确认后继续；也可用审批卡操作。</div>
        </div>
      )}
      {job.state === "failed" && <div className="mt-2 text-xs text-bad">运行失败，未生成结果。</div>}
    </div>
  );
}
