"use client";

import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { getJob, setJob, subscribeJobs } from "@/lib/jobStore";

export function TracePanel({
  jobId,
  caseId,
  onClose,
}: {
  jobId?: string;
  caseId?: string;
  onClose: () => void;
}) {
  const job = useSyncExternalStore(
    subscribeJobs,
    () => (jobId ? getJob(jobId) : undefined),
    () => undefined
  );

  useEffect(() => {
    if (jobId && !getJob(jobId) && caseId) {
      api
        .job(jobId)
        .then((j) => setJob(jobId, { ...j, id: jobId, case: caseId }))
        .catch(() => {});
    }
  }, [jobId, caseId]);

  return (
    <aside aria-label="运行 trace" className="flex w-80 shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3 py-2 text-sm">
        <span>运行 trace · {caseId ?? "—"}</span>
        <button className="text-xs text-muted" onClick={onClose}>
          关闭
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3 text-xs">
        {!job && <p className="text-muted">暂无运行记录。</p>}
        {(job?.log ?? []).map((l, i) => (
          <div key={i} className="border-b border-line/60 py-1 font-mono">
            {l.msg}
          </div>
        ))}
      </div>
    </aside>
  );
}
