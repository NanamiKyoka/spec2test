"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type CaseItem, type RunRec } from "@/lib/api";

export function RunRail({ onPickRun }: { onPickRun?: (run: RunRec) => void }) {
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [runs, setRuns] = useState<RunRec[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    Promise.all([api.cases(), api.runs(8)])
      .then(([c, r]) => {
        setCases(c);
        setRuns(r);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  return (
    <aside aria-label="用例与最近运行" className="flex w-64 shrink-0 flex-col border-r border-line">
      <div className="px-3 pt-3 text-xs uppercase tracking-wide text-muted">用例</div>
      <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-1 text-sm">
        {state === "loading" && <li className="px-2 py-1.5 text-muted">加载中…</li>}
        {state === "error" && <li className="px-2 py-1.5 text-muted">读取失败</li>}
        {state === "ready" && cases.length === 0 && <li className="px-2 py-1.5 text-muted">暂无用例</li>}
        {cases.map((c) => (
          <li key={c.case}>
            <Link
              href={`/case/${c.case}`}
              className="block truncate rounded px-2 py-1.5 hover:bg-surface"
              title={c.title}
            >
              <span className="font-mono text-xs">{c.case}</span>
              <span className="ml-2 text-muted">{c.title}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="border-t border-line px-3 py-2 text-xs uppercase tracking-wide text-muted">最近运行</div>
      <ul className="max-h-48 overflow-y-auto px-2 pb-2 text-xs">
        {state === "ready" && runs.length === 0 && <li className="px-2 py-1 text-muted">暂无运行</li>}
        {runs.map((r) => (
          <li key={r.job_id}>
            {onPickRun ? (
              <button
                className="w-full truncate rounded px-2 py-1 text-left hover:bg-surface"
                onClick={() => onPickRun(r)}
                title={r.summary || r.state}
              >
                {r.case} · {r.verdict ?? r.state}
              </button>
            ) : (
              <div className="w-full truncate rounded px-2 py-1" title={r.summary || r.state}>
                {r.case} · {r.verdict ?? r.state}
              </div>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
