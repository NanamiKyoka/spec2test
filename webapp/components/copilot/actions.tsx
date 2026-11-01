"use client";

import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { useEffect, useMemo, useState } from "react";
import { api, type CaseItem } from "@/lib/api";
import { followJob, startRun, waitTerminal } from "@/lib/followJob";
import { getJob } from "@/lib/jobStore";
import { ApprovalCard } from "./ApprovalCard";
import { RunCard } from "./RunCard";

export function CopilotActions() {
  const [cases, setCases] = useState<CaseItem[]>([]);

  useEffect(() => {
    api.cases().then(setCases).catch(() => setCases([]));
  }, []);

  const caseList = useMemo(() => cases.map((c) => ({ case: c.case, title: c.title })), [cases]);
  useCopilotReadable({ description: "当前系统支持的 §6.7 用例清单（case=用例号，title=标题）", value: caseList });

  useCopilotAction({
    name: "run_case",
    description: "运行一个 §6.7 用例并返回判定结果。hitl=true 时会在候选消息处暂停等待人工批准。",
    parameters: [
      { name: "case", type: "string", description: "用例号，如 6.7.1.3", required: true },
      { name: "hitl", type: "boolean", description: "是否启用人工审批", required: false },
    ],
    handler: async ({ case: caseId, hitl }: { case: string; hitl?: boolean }) => {
      const known = cases.find((c) => c.case === caseId);
      if (cases.length && !known) return JSON.stringify({ error: "unknown_case", case: caseId });

      let jobId: string;
      try {
        jobId = await startRun(caseId, Boolean(hitl));
      } catch (e) {
        return JSON.stringify({ error: "start_failed", detail: String(e) });
      }
      const ac = new AbortController();
      const { job, sseOk, stoppedAtApproval } = await followJob(jobId, caseId, ac.signal, true);

      if (!sseOk) {
        if (hitl) {
          const first = await api.job(jobId);
          if (first.state === "awaiting_approval") {
            return JSON.stringify({
              job_id: jobId,
              state: "awaiting_approval",
              candidates: first.approval?.candidates ?? [],
              next: "请让用户确认候选消息，然后调用 approve_candidates",
            });
          }
        }
        const j = await waitTerminal(jobId, caseId, ac.signal);
        return JSON.stringify(summarize(jobId, j));
      }
      if (stoppedAtApproval) {
        return JSON.stringify({
          job_id: jobId,
          state: "awaiting_approval",
          candidates: job.approval?.candidates ?? [],
          next: "请让用户确认候选消息，然后调用 approve_candidates",
        });
      }
      return JSON.stringify(summarize(jobId, job));
    },
    render: ({ args }) => <RunCard caseId={args.case ?? ""} />,
  });

  useCopilotAction({
    name: "approve_candidates",
    description: "对处于 awaiting_approval 的任务做人工审批：approve 继续生成，reject 取消且不调用模型。",
    parameters: [
      { name: "job_id", type: "string", description: "run_case 返回的 job_id", required: true },
      { name: "case", type: "string", description: "用例号", required: true },
    ],
    renderAndWaitForResponse: ({ args, respond }) => {
      const [busy, setBusy] = useState(false);
      const jobId = args.job_id ?? "";
      const caseId = args.case ?? "";
      const job = getJob(jobId);

      const decide = async (decision: "approve" | "reject") => {
        setBusy(true);
        try {
          await api.approveJob(jobId, decision);
          const ac = new AbortController();
          const { job: finalJob, sseOk } = await followJob(jobId, caseId, ac.signal, false);
          const final = sseOk ? finalJob : await api.job(jobId);
          respond?.(JSON.stringify({ job_id: jobId, state: final.state, verdict: final.verdict ?? null }));
        } catch (e) {
          setBusy(false);
          respond?.(JSON.stringify({ error: String(e) }));
        }
      };

      return (
        <ApprovalCard
          jobId={jobId}
          candidates={job?.approval?.candidates ?? []}
          busy={busy}
          onDecide={decide}
        />
      );
    },
  });

  return null;
}

function summarize(
  jobId: string,
  job: {
    state?: string;
    verdict?: string | null;
    result?: { detail?: { L1?: number; L3?: number | null; violations?: unknown[] } };
  }
) {
  return {
    job_id: jobId,
    state: job.state,
    verdict: job.verdict ?? null,
    L1: job.result?.detail?.L1 ?? null,
    L3: job.result?.detail?.L3 ?? null,
    violations: job.result?.detail?.violations ?? [],
  };
}
