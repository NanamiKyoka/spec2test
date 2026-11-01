import { api, pollJob, type Job } from "./api";
import { setJob } from "./jobStore";

export type FollowResult = { job: Job; sseOk: boolean };

/** 订阅任务；stopAtApproval 时在待审批处提前返回。SSE 断开返回 sseOk=false 由调用方轮询。 */
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

    function done(sseOk: boolean) {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      es?.close();
      resolve({ job: last, sseOk });
    }

    function onAbort() {
      done(false);
    }

    if (signal.aborted) return done(false);
    if (typeof EventSource === "undefined") return done(false);

    try {
      es = new EventSource(`/api/job/${jobId}/stream`);
    } catch {
      return done(false);
    }

    es.onmessage = (ev) => {
      try {
        const job = JSON.parse(ev.data) as Job;
        last = job;
        setJob(jobId, { ...job, id: jobId, case: caseId });
        const terminal = job.state === "done" || job.state === "failed";
        if (terminal || (stopAtApproval && job.state === "awaiting_approval")) done(true);
      } catch {
        /* 坏帧忽略 */
      }
    };
    es.onerror = () => done(false);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function startRun(caseId: string, hitl: boolean, conversationId?: string) {
  const { job_id } = await api.run(caseId, `运行用例 ${caseId}`, conversationId, hitl);
  setJob(job_id, { id: job_id, state: "queued", log: [], case: caseId });
  return job_id;
}

export async function waitTerminal(jobId: string, caseId: string, signal: AbortSignal) {
  const r = await followJob(jobId, caseId, signal, false);
  if (!r.sseOk) {
    return pollJob(jobId, (j) => setJob(jobId, { ...j, id: jobId, case: caseId }), signal);
  }
  return r.job;
}
