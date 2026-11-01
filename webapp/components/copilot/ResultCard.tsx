"use client";

import Link from "next/link";

type Stage = { stage: string; status?: string; summary?: string; detail?: Record<string, unknown> };
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
        <span>L1：{L1 ?? "—"}</span>
        <span>L3：{L3 ?? "—"}</span>
        <span>违规：{violations.length}</span>
      </div>
      <ul className="mt-2 space-y-1 text-xs">
        {stages.map((s) => (
          <li key={s.stage} className="flex justify-between gap-2">
            <span>{s.stage}</span>
            <span className={s.status === "ok" ? "text-ok-ink" : s.status === "skipped" ? "text-muted" : "text-bad"}>
              {s.summary || s.status}
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
      <Link className="mt-2 inline-block text-xs text-accent-ink" href={`/case/${caseId}`}>
        查看完整证据 →
      </Link>
    </div>
  );
}
