"use client";

import { useState } from "react";
import type { Job } from "../lib/api";
import { buildStages, type StageView } from "../lib/stages";

const DOT: Record<StageView["status"], string> = {
  ok: "bg-ok",
  skipped: "bg-muted",
  failed: "bg-bad",
  pending: "bg-line",
};

const LABEL: Record<StageView["status"], string> = {
  ok: "完成",
  skipped: "跳过",
  failed: "失败",
  pending: "等待",
};

export function StageTimeline({ job }: { job?: Job }) {
  const stages = buildStages(job);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <ol className="mt-3 space-y-1.5 border-l border-line pl-4">
      {stages.map((s) => {
        const expanded = open === s.key;
        const dim = s.status === "pending";
        return (
          <li key={s.key} className={dim ? "opacity-50" : ""}>
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : s.key)}
              className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left hover:bg-line/30"
              aria-expanded={expanded}
            >
              <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${DOT[s.status]}`} />
              <span className="w-24 shrink-0 text-sm font-medium">{s.label}</span>
              <span className="shrink-0 text-xs text-muted">{LABEL[s.status]}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted">
                {s.summary}
              </span>
            </button>
            {expanded && s.lines.length > 0 && (
              <div className="ml-5 mt-1 space-y-0.5 border-l border-line pl-3">
                {s.lines.map((ln, i) => (
                  <div key={i} className="prose-cn font-mono /* taste-skill-ignore */ text-xs text-muted">
                    {ln}
                  </div>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function skippedNote(job?: Job) {
  const skipped = buildStages(job).filter((s) => s.status === "skipped").length;
  if (skipped < 3) return null;
  return (
    <div className="mt-2 rounded border border-line bg-canvas px-3 py-2 text-xs text-muted">
      未生成 IE 字段内容，字段级 calls=0；弃权不计分（不是 0 分）。
    </div>
  );
}
