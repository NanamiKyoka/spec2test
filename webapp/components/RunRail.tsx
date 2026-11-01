"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type CaseItem, type RunRec } from "@/lib/api";

export function RunRail({ onPickRun }: { onPickRun: (run: RunRec) => void }) {
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [runs, setRuns] = useState<RunRec[]>([]);

  useEffect(() => {
    api.cases().then(setCases).catch(() => setCases([]));
    api.runs(8).then(setRuns).catch(() => setRuns([]));
  }, []);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-line">
      <div className="px-3 pt-3 text-xs uppercase tracking-wide text-muted">用例</div>
      <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-1 text-sm">
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
        {runs.map((r) => (
          <li key={r.job_id}>
            <button
              className="w-full truncate rounded px-2 py-1 text-left hover:bg-surface"
              onClick={() => onPickRun(r)}
              title={r.summary || r.state}
            >
              {r.case} · {r.verdict ?? r.state}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
