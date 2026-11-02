"use client";

import type { JobCandidate } from "@/lib/api";
import { MODE_LABELS, STRICTNESS_LABELS, useRunOptions } from "@/lib/runParams";
import { useState } from "react";

function nameOf(c: JobCandidate) {
  return (typeof c === "string" ? c : c.message || c.name || "").trim();
}

export function ApprovalCard({
  jobId,
  candidates,
  onDecide,
  busy,
}: {
  jobId: string;
  candidates: JobCandidate[];
  onDecide: (d: "approve" | "reject", messages: string[]) => void;
  busy?: boolean;
}) {
  const names = candidates.map(nameOf).filter(Boolean);
  const [picked, setPicked] = useState<string[]>(names);
  const opts = useRunOptions();

  const toggle = (n: string) =>
    setPicked((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]));

  return (
    <div className="rounded-md border border-warn/40 bg-surface p-3 text-sm">
      <div className="font-medium">需要人工确认</div>
      <p className="mt-1 text-xs text-muted">确认前不会调用模型；取消则不生成任何 IE 字段内容。</p>

      <div className="mt-2 rounded border border-line bg-canvas p-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">候选消息（{picked.length}/{names.length}）</span>
          <button
            type="button"
            className="text-accent-ink hover:underline"
            onClick={() => setPicked(picked.length === names.length ? [] : names)}
          >
            {picked.length === names.length ? "全不选" : "全选"}
          </button>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {names.map((n) => {
            const on = picked.includes(n);
            return (
              <button
                key={n}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(n)}
                className={`rounded-full border px-2 py-0.5 font-mono /* taste-skill-ignore */ text-[11px] transition ${
                  on
                    ? "border-accent/50 bg-accent/10 text-accent-ink"
                    : "border-line text-muted hover:border-accent/40"
                }`}
              >
                {n}
              </button>
            );
          })}
          {!names.length && <span className="text-xs text-muted">未抽取到候选消息</span>}
        </div>
        {!picked.length && names.length > 0 && (
          <p className="mt-1.5 text-[11px] text-warn">未选任何消息：批准后会按弃权处理，不调用模型。</p>
        )}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] text-muted">
        <span>范围：{MODE_LABELS[opts.mode]}</span>
        <span>修复：{opts.repairs === 0 ? "不修复" : `${opts.repairs} 轮`}</span>
        <span>校验：{STRICTNESS_LABELS[opts.strictness]}</span>
      </div>

      <div className="mt-2 flex gap-2">
        <button
          className="rounded bg-accent-solid px-3 py-1.5 text-xs text-white disabled:opacity-50"
          disabled={busy}
          onClick={() => onDecide("approve", picked)}
        >
          批准并生成
        </button>
        <button
          className="rounded border border-line px-3 py-1.5 text-xs disabled:opacity-50"
          disabled={busy}
          onClick={() => onDecide("reject", [])}
        >
          取消
        </button>
      </div>
      <span className="sr-only">{jobId}</span>
    </div>
  );
}
