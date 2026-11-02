"use client";

import { openCasePanel } from "@/lib/panel";

export type Stage = { stage: string; status?: string; summary?: string; detail?: Record<string, unknown> };
type Violation = { rule: string; path: string; detail: string };

export function ResultCard({
  caseId,
  stages,
  verdict,
  violations,
  L1,
  L3,
}: {
  caseId: string;
  stages: Stage[];
  verdict?: string | null;
  violations: Violation[];
  L1?: number | null;
  L3?: number | null;
}) {
  const tone =
    verdict === "pass" ? "border-ok/40" : verdict === "reject" ? "border-bad/40" : "border-line";

  return (
    <div className={`rounded-md border ${tone} bg-surface p-3 text-sm`}>
      <div className="flex items-center justify-between">
        <span className="font-medium">用例 {caseId}</span>
        <span className="text-xs text-muted">
          {verdict === "pass" ? "通过" : verdict === "abstained" ? "弃权" : verdict === "reject" ? "已拒收" : "未判定"}
        </span>
      </div>
      <div className="mt-2 flex gap-4 text-xs text-muted">
        <span>L1：{L1 ?? "—"}</span> /* taste-skill-ignore */
        <span>L3：{L3 ?? "—"}</span> /* taste-skill-ignore */
        <span>违规：{violations.length}</span>
      </div>
      <ul className="mt-2 space-y-1 text-xs">
        {stages.map((s) => (
          <li key={s.stage} className="flex justify-between gap-2">
            <span>{s.stage}</span>
            <span
              className={
                s.status === "ok"
                  ? "text-ok-ink"
                  : s.status === "rejected" || s.status === "failed"
                    ? "text-bad"
                    : "text-muted"
              }
            >
              {s.summary || s.status || "未知"}
            </span>
          </li>
        ))}
      </ul>
      {violations.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-bad">
          {violations.map((v, i) => (
            <li key={i}>
              {v.rule} · {v.path} · {v.detail}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => openCasePanel(caseId)}
        className="mt-3 flex w-full items-center justify-between rounded-md border border-line bg-canvas px-3 py-2 text-left text-xs transition-colors hover:border-accent/40 hover:bg-surface"
      >
        <span>打开用例面板 · 字段级证据</span>
        <span className="text-accent-ink">→</span>
      </button>
    </div>
  );
}
