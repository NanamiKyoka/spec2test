"use client";

import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { useEffect, useState } from "react";
import { api, type CaseItem } from "@/lib/api";
import { followJob, startRun } from "@/lib/followJob";
import { RunCard } from "./RunCard";

export function CopilotActions() {
  const [cases, setCases] = useState<CaseItem[]>([]);

  useEffect(() => {
    api.cases().then(setCases).catch(() => setCases([]));
  }, []);

  useCopilotReadable({
    description: "当前系统支持的 §6.7 用例清单（case=用例号，title=标题）",
    value: cases.map((c) => ({ case: c.case, title: c.title })),
  });

  useCopilotAction({
    name: "run_case",
    description: "运行一个 §6.7 用例并返回判定结果。hitl=true 时会在候选消息处暂停等待人工批准。",
    parameters: [
      { name: "case", type: "string", description: "用例号，如 6.7.1.3", required: true },
      { name: "hitl", type: "boolean", description: "是否启用人工审批", required: false },
    ],
    handler: async ({ case: caseId, hitl }: { case: string; hitl?: boolean }) => {
      const known = cases.find((c) => c.case === caseId);
      if (!known) return JSON.stringify({ error: "unknown_case", case: caseId });

      const jobId = await startRun(caseId, Boolean(hitl));
      const ac = new AbortController();
      const { job, sseOk, stoppedAtApproval } = await followJob(jobId, caseId, ac.signal, true);

      if (!sseOk) {
        return JSON.stringify({ job_id: jobId, state: "unknown", note: "SSE 不可用，请打开结果卡片确认" });
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
