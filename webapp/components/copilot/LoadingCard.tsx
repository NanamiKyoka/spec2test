"use client";

import { useEffect, useState } from "react";

const STAGES = ["切片与上下文", "候选消息", "步骤与字段", "规则校验", "评分与对照"];

export function LoadingCard({ title = "读取证据" }: { title?: string }) {
  const [sec, setSec] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="rounded-md border border-line bg-surface p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">{title}</span>
        <span className="text-[11px] tabular-nums text-muted">已等待 {sec}s</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded bg-line">
        <div className="progress-indeterminate h-full rounded bg-accent-solid" />
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted">
        {STAGES.map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-line" aria-hidden />
            <span className="truncate">{s}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted">读取的是确定性证据，不调用模型；完成后本卡替换为结果。</p>
    </div>
  );
}
