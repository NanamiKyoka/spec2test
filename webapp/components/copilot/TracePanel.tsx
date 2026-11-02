"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { api, type ToolTraceRow } from "@/lib/api";
import { getJob, setJob, subscribeJobs } from "@/lib/jobStore";

const TOOL_LABEL: Record<string, string> = {
  prepare_case: "读取用例切片",
  list_candidates: "抽取候选消息",
  validate_intent: "规则校验",
  compare_gold: "与官方答案对照",
  export_intent: "导出产物",
  generate_steps: "生成步骤",
  generate_ies: "生成 IE 字段",
  repair_intent: "定向重修",
};

export function TracePanel({
  jobId,
  caseId,
  onClose,
}: {
  jobId?: string;
  caseId?: string;
  onClose: () => void;
}) {
  const [error, setError] = useState(false);
  const [tools, setTools] = useState<ToolTraceRow[]>([]);
  const [scoped, setScoped] = useState(false);
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
        .catch(() => setError(true));
    }
  }, [jobId, caseId]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (jobId) {
        const own = await api.toolTrace(20, jobId);
        if (!alive) return;
        if ((own.rows ?? []).length) {
          setTools(own.rows);
          setScoped(true);
          return;
        }
      }
      const recent = await api.toolTrace(12);
      if (!alive) return;
      setTools(recent.rows ?? []);
      setScoped(false);
    };
    load().catch(() => {
      if (alive) setTools([]);
    });
    return () => {
      alive = false;
    };
  }, [jobId]);

  return (
    <aside aria-label="运行 trace" className="flex w-80 shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3 py-2 text-sm">
        <span>运行 trace · {caseId ?? "—"}</span> /* taste-skill-ignore */
        <button className="text-xs text-muted" onClick={onClose}>
          关闭
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3 text-xs">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
          {scoped ? "决策轨迹 · 本次运行" : "最近工具调用"}
        </div>
        {tools.length === 0 && <p className="mb-3 text-muted">还没有工具调用记录。</p>}
        <div className="mb-3 space-y-1">
          {tools.map((t, i) => (
            <div key={i} className="flex items-center gap-2 rounded border border-line/70 px-2 py-1">
              <span className="flex-1 truncate">{TOOL_LABEL[t.tool] ?? t.tool}</span>
              {t.case && <span className="font-mono /* taste-skill-ignore */ text-muted">{t.case}</span>}
              <span className="tabular-nums text-muted">{t.ms}ms</span>
            </div>
          ))}
        </div>
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">运行日志</div>
        {!job && (error ? <p className="text-bad">加载失败</p> : <p className="text-muted">暂无运行记录。</p>)}
        {(job?.log ?? []).map((l, i) => (
          <div key={i} className="border-b border-line/60 py-1 font-mono /* taste-skill-ignore */">
            {l.msg}
          </div>
        ))}
      </div>
    </aside>
  );
}
