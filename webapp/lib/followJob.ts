import { api, pollJob, type Job } from "./api";
import { setJob } from "./jobStore";
import type { RunOptions } from "./runParams";

export type FollowResult = { job: Job; sseOk: boolean; stoppedAtApproval: boolean };

/**
 * 订阅任务；stopAtApproval 时在待审批处提前返回（stoppedAtApproval=true）。
 * 此时 SSE 已关闭但后端任务仍在运行，调用方需再次 followJob/waitTerminal 追终态。
 * SSE 断开/不可用返回 sseOk=false，由调用方回退轮询。
 */
export function followJob(
  jobId: string,
  caseId: string,
  signal: AbortSignal,
  stopAtApproval = false
): Promise<FollowResult> {
  return new Promise((resolve) => {
    let settled = false;
    let last: Job = { state: "queued", log: [] };
    let es: EventSource | null = null;

    function done(sseOk: boolean, stoppedAtApproval: boolean) {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      es?.close();
      resolve({ job: last, sseOk, stoppedAtApproval });
    }

    function onAbort() {
      done(false, false);
    }

    if (signal.aborted) return done(false, false);
    if (typeof EventSource === "undefined") return done(false, false);

    try {
      es = new EventSource(`/api/job/${jobId}/stream`);
    } catch {
      return done(false, false);
    }

    es.onmessage = (ev) => {
      try {
        const job = JSON.parse(ev.data) as Job;
        last = job;
        setJob(jobId, { ...job, id: jobId, case: caseId });
        const terminal = job.state === "done" || job.state === "failed";
        if (terminal) done(true, false);
        else if (stopAtApproval && job.state === "awaiting_approval") done(true, true);
      } catch {
        /* 坏帧忽略 */
      }
    };
    es.onerror = () => done(false, false);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function startRun(
  caseId: string,
  hitl: boolean,
  conversationId?: string,
  dryRun = false,
  options?: RunOptions
) {
  const { job_id } = await api.run(caseId, `运行用例 ${caseId}`, conversationId, hitl, dryRun, options);
  setJob(job_id, { id: job_id, state: "queued", log: [], case: caseId });
  return job_id;
}

export async function waitTerminal(jobId: string, caseId: string, signal: AbortSignal) {
  const r = await followJob(jobId, caseId, signal, false);
  // 已中止时 pollJob 会立刻返回假的 queued 快照，直接用 SSE 的最后快照。
  if (signal.aborted) return r.job;
  if (!r.sseOk) {
    return pollJob(jobId, (j) => setJob(jobId, { ...j, id: jobId, case: caseId }), signal);
  }
  return r.job;
}
