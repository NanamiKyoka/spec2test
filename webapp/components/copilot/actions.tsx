"use client";

import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, type CaseItem } from "@/lib/api";
import { currentConversationId } from "@/lib/conversation";
import { followJob, startRun, waitTerminal } from "@/lib/followJob";
import { getJob, setJob } from "@/lib/jobStore";
import { getRunOptions } from "@/lib/runParams";

const DISABLED = JSON.stringify({ error: "tool_disabled" });

function toolEnabled(name: string) {
  const sel = getRunOptions().mcpTools;
  return !Array.isArray(sel) || sel.includes(name);
}

function disabledError(name: string) {
  return JSON.stringify({ error: "tool_disabled", tool: name });
}

function DisabledNote() {
  return (
    <div className="text-xs text-warn">
      该只读工具已在输入框「+」菜单里关闭，勾选后可继续调用。
    </div>
  );
}
import { AnalysisCard } from "./AnalysisCard";
import { ApprovalCard } from "./ApprovalCard";
import { ResultCard, type Stage } from "./ResultCard";
import { RunCard } from "./RunCard";
import { LoadingCard } from "./LoadingCard";
import { SkillCard, type Skill } from "./SkillCard";

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
        jobId = await startRun(
          caseId,
          Boolean(hitl),
          currentConversationId() ?? undefined,
          false,
          getRunOptions()
        );
      } catch (e) {
        const code = e instanceof ApiError ? e.code ?? "" : "";
        const message =
          code === "run_in_progress"
            ? "该会话已有任务在运行或等待审批，先处理或取消它"
            : code === "too_many_runs"
              ? "同时运行的任务已达上限，稍后再试"
              : code === "no_credential"
                ? "当前模型通道未配置可用凭据"
                : String(e);
        const errId = `err-${caseId}-${Date.now()}`;
        setJob(errId, { id: errId, state: "failed", log: [{ t: 0, msg: message }], case: caseId });
        return JSON.stringify({ error: "start_failed", detail: message });
      }
      const ac = new AbortController();
      const { job, sseOk, stoppedAtApproval } = await followJob(jobId, caseId, ac.signal, true);

      if (!sseOk) {
        if (hitl) {
          const deadline = Date.now() + 60000;
          while (Date.now() < deadline) {
            const snap = await api.job(jobId);
            setJob(jobId, { ...snap, id: jobId, case: caseId });
            if (snap.state === "awaiting_approval") {
              return JSON.stringify({
                job_id: jobId,
                state: "awaiting_approval",
                candidates: snap.approval?.candidates ?? [],
                next: "请让用户确认候选消息，然后调用 approve_candidates",
              });
            }
            if (snap.state === "done" || snap.state === "failed") {
              return JSON.stringify(summarize(jobId, snap));
            }
            await new Promise((r) => setTimeout(r, 1000));
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
      if (!toolEnabled("prepare_case")) return disabledError("prepare_case");
      const res = await fetch(`/api/case/${caseId}`);
      if (!res.ok) return JSON.stringify({ case: caseId, stages: [], error: res.status });
      const body = await res.json();
      return JSON.stringify({ case: caseId, stages: body.stages ?? [] });
    },
    render: ({ result }) => {
      if (!result) return <LoadingCard title="读取六阶段证据" />;
      let parsed: { case: string; stages: Stage[] } | null = null;
      try {
        parsed = typeof result === "string" ? JSON.parse(result) : (result as typeof parsed);
      } catch {
        return <div className="text-xs text-bad">证据读取失败</div>;
      }
      if (!parsed || typeof parsed !== "object") return <></>;
      if ((parsed as { error?: string }).error === "tool_disabled") return <DisabledNote />;
      const stages = parsed.stages ?? [];
      const byStage = Object.fromEntries(stages.map((s) => [s.stage, s]));
      const score = (byStage.score?.detail ?? {}) as { L1?: number; L3?: number | null };
      const violations = (byStage.validate?.detail?.violations ?? []) as {
        rule: string;
        path: string;
        detail: string;
      }[];
      const bad = ["candidates", "generate", "validate", "score"].some(
        (k) => !byStage[k] || byStage[k].status === "unavailable"
      );
      const verdict =
        !stages.length || bad
          ? "undetermined"
          : byStage.candidates?.status === "skipped" || byStage.generate?.status === "skipped"
            ? "abstained"
            : violations.length > 0
              ? "reject"
              : "pass";
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
    name: "analyze_case",
    description: "对某个用例做评测分析，并在对话里展示判定、L1/L3 与违规分布图表。",
    parameters: [{ name: "case", type: "string", description: "用例号", required: true }],
    handler: async ({ case: caseId }: { case: string }) => {
      if (!toolEnabled("validate_intent")) return disabledError("validate_intent");
      const res = await fetch(`/api/case/${caseId}`);
      if (!res.ok) return JSON.stringify({ error: res.status, case: caseId });
      const body = await res.json();
      return JSON.stringify({ case: caseId, stages: body.stages ?? [] });
    },
    render: ({ result }) => {
      if (!result) return <LoadingCard title="分析评测数据" />;
      let parsed: { case: string; stages: Stage[] } | null = null;
      try {
        parsed = typeof result === "string" ? JSON.parse(result) : (result as typeof parsed);
      } catch {
        return <div className="text-xs text-bad">分析数据读取失败</div>;
      }
      if (!parsed || typeof parsed !== "object") return <></>;
      if ((parsed as { error?: string }).error === "tool_disabled") return <DisabledNote />;
      return <AnalysisCard caseId={parsed.case} stages={parsed.stages ?? []} />;
    },
  });

  useCopilotAction({
    name: "list_skills",
    description: "列出可用技能（过程说明）。不确定规则细节时先看这个。",
    parameters: [],
    handler: async () =>
      toolEnabled("list_skills")
        ? JSON.stringify({ skills: (await api.skills()).skills ?? [] })
        : disabledError("list_skills"),
    render: ({ result }) => {
      if (!result) return <LoadingCard title="读取技能库" />;
      let parsed: { skills?: { name: string; description?: string }[] } | null = null;
      try {
        parsed = typeof result === "string" ? JSON.parse(result) : (result as typeof parsed);
      } catch {
        return <div className="text-xs text-bad">技能库读取失败</div>;
      }
      const list = parsed?.skills ?? [];
      return (
        <div className="rounded-md border border-line bg-surface p-3 text-sm">
          <div className="font-medium">技能库 · {list.length}</div>
          <ul className="mt-1.5 space-y-1 text-xs">
            {list.map((s) => (
              <li key={s.name}>
                <span className="font-mono /* taste-skill-ignore */">{s.name}</span>
                <span className="text-muted"> — {s.description}</span> /* taste-skill-ignore */
              </li>
            ))}
          </ul>
        </div>
      );
    },
  });

  useCopilotAction({
    name: "use_skill",
    description: "加载指定技能的完整说明。遇到 R1/R2/R3 违规、字段取舍或 SIB19 字段问题时调用。",
    parameters: [
      { name: "name", type: "string", description: "技能名，如 sib19-required-fields", required: true },
    ],
    handler: async ({ name }: { name: string }) => {
      if (!toolEnabled("use_skill")) return disabledError("use_skill");
      try {
        const r = await api.callTool("use_skill", { name });
        return JSON.stringify(r.data ?? { error: r.error });
      } catch (e) {
        return JSON.stringify({ error: String(e) });
      }
    },
    render: ({ result }) => {
      if (!result) return <LoadingCard title="加载技能" />;
      let parsed: Skill | null = null;
      try {
        parsed = typeof result === "string" ? JSON.parse(result) : (result as Skill);
      } catch {
        return <div className="text-xs text-bad">技能加载失败</div>;
      }
      if ((parsed as { error?: string } | null)?.error === "tool_disabled") return <DisabledNote />;
      if (!parsed?.body) return <div className="text-xs text-bad">技能不存在</div>;
      return <SkillCard skill={parsed} />;
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

      const decide = async (decision: "approve" | "reject", messages: string[] = []) => {
        if (busy) return;
        setBusy(true);
        try {
          await api.approveJob(jobId, decision, { ...getRunOptions(), messages });
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
