"use client";

import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, type CaseItem } from "@/lib/api";
import { followJob, startRun, waitTerminal } from "@/lib/followJob";
import { getJob, setJob } from "@/lib/jobStore";
import { ApprovalCard } from "./ApprovalCard";
import { ResultCard } from "./ResultCard";
import { RunCard } from "./RunCard";

type Stage = { stage: string; status?: string; summary?: string; detail?: Record<string, any> };

export function CopilotActions() {
  const [cases, setCases] = useState<CaseItem[]>([]);

  useEffect(() => {
    api.cases().then(setCases).catch(() => setCases([]));
  }, []);

  const casesRef = useRef<CaseItem[]>([]);
  useEffect(() => {
    casesRef.current = cases;
  }, [cases]);

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
      const known = casesRef.current.find((c) => c.case === caseId);
      if (casesRef.current.length && !known) return JSON.stringify({ error: "unknown_case", case: caseId });

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
            setJob(jobId, { ...first, id: jobId, case: caseId });
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
    name: "get_case_evidence",
    description: "读取某个用例的六阶段证据（不调用模型）。",
    parameters: [{ name: "case", type: "string", description: "用例号", required: true }],
    handler: async ({ case: caseId }: { case: string }) => {
      const res = await fetch(`/api/case/${caseId}`);
      const body = await res.json();
      return JSON.stringify({ case: caseId, stages: body.stages ?? [] });
    },
    render: ({ result }) => {
      if (!result) return <div className="text-xs text-muted">读取证据中…</div>;
      let parsed: { case: string; stages: Stage[] } | null = null;
      try {
        parsed = JSON.parse(String(result));
      } catch {
        return <div className="text-xs text-bad">证据解析失败</div>;
      }
      if (!parsed) return <></>;
      const stages = parsed.stages ?? [];
      const byStage = Object.fromEntries(stages.map((s) => [s.stage, s]));
      const score = (byStage.score?.detail ?? {}) as { L1?: number; L3?: number | null };
      const verdict =
        byStage.candidates?.status === "skipped" || byStage.generate?.status === "skipped"
          ? "abstained"
          : byStage.validate?.status === "rejected"
            ? "reject"
            : "pass";
      const violations = (byStage.validate?.detail?.violations ?? []) as {
        rule: string;
        path: string;
        detail: string;
      }[];
      return (
        <ResultCard
          caseId={parsed.case}
          stages={stages}
          verdict={verdict}
          violations={violations}
          L1={score.L1 ?? null}
          L3={score.L3 ?? null}
        />
      );
    },
  });

  useCopilotAction({
    name: "approve_candidates",
    description: "对处于 awaiting_approval 的任务做人工审批：approve 继续生成，reject 取消且不调用模型。",
    parameters: [
      { name: "job_id", type: "string", description: "run_case 返回的 job_id", required: true },
      { name: "case", type: "string", description: "用例号", required: true },
    ],
    renderAndWaitForResponse: ({ args, respond, status }) => {
      const [busy, setBusy] = useState(false);
      const jobId = args.job_id ?? "";
      const caseId = args.case ?? "";
      const job = getJob(jobId);

      const decide = async (decision: "approve" | "reject") => {
        if (busy) return;
        setBusy(true);
        try {
          await api.approveJob(jobId, decision);
          const ac = new AbortController();
          const { job: finalJob, sseOk } = await followJob(jobId, caseId, ac.signal, false);
          const final = sseOk ? finalJob : await waitTerminal(jobId, caseId, ac.signal);
          respond?.(JSON.stringify({ job_id: jobId, state: final.state, verdict: final.verdict ?? null }));
        } catch (e) {
          setBusy(false);
          if (e instanceof ApiError && e.status === 409) {
            respond?.(JSON.stringify({ state: "approval_expired", next: "审批窗口已关闭，勿再调用 approve_candidates；需要结果请重新 run_case" }));
          } else {
            respond?.(JSON.stringify({ error: String(e) }));
          }
        }
      };

      return (
        <ApprovalCard
          jobId={jobId}
          candidates={job?.approval?.candidates ?? []}
          busy={busy || status !== "executing"}
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
