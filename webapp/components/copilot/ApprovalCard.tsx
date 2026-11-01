"use client";

import type { JobCandidate } from "@/lib/api";

export function ApprovalCard({
  jobId,
  candidates,
  onDecide,
  busy,
}: {
  jobId: string;
  candidates: JobCandidate[];
  onDecide: (d: "approve" | "reject") => void;
  busy?: boolean;
}) {
  return (
    <div className="rounded-md border border-warn/40 bg-surface p-3 text-sm">
      <div className="font-medium">需要人工确认</div>
      <p className="mt-1 text-xs text-muted">确认前不会调用模型；取消则不生成任何 IE 字段内容。</p>
      <div className="mt-2 rounded border border-line bg-canvas p-2 text-xs">
        候选消息：{candidates.map((c) => (typeof c === "string" ? c : c.message || c.name || "")).join(" / ") || "—"}
      </div>
      <div className="mt-2 flex gap-2">
        <button className="rounded bg-accent-solid px-3 py-1.5 text-xs text-white disabled:opacity-50" disabled={busy} onClick={() => onDecide("approve")}>
          批准并生成
        </button>
        <button className="rounded border border-line px-3 py-1.5 text-xs disabled:opacity-50" disabled={busy} onClick={() => onDecide("reject")}>
          取消
        </button>
      </div>
      <span className="sr-only">{jobId}</span>
    </div>
  );
}
