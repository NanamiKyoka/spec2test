import * as React from "react";
import { ChevronDown, Search } from "lucide-react";
import { api, type CaseItem } from "../lib/api";
import { Chip } from "../ui";

export function CasePicker({ onPick, disabled }: { onPick: (caseId: string) => void; disabled?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<CaseItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");

  React.useEffect(() => {
    if (!open || items) return;
    let alive = true;
    api
      .cases()
      .then((list) => alive && setItems(list))
      .catch((e: Error) => alive && setError(e.message || "加载失败"));
    return () => {
      alive = false;
    };
  }, [open, items]);

  const filtered = (items || []).filter((c) => {
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return c.case.includes(t) || (c.title || "").toLowerCase().includes(t);
  });

  return (
    <div className="mb-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5 py-1 text-[11.5px] text-muted hover:bg-surface disabled:opacity-50"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
        选一个用例
        {items ? <span className="num">（{items.length}）</span> : null}
      </button>

      {open && (
        <div className="mt-1.5 rounded-md border border-line bg-canvas">
          <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索用例号或标题，如 NTN / 6.7.1.3"
              aria-label="搜索用例"
              className="w-full bg-transparent text-[12px] outline-none"
            />
          </div>
          <div className="scroll-thin max-h-[220px] overflow-y-auto p-1">
            {error ? (
              <p className="px-2 py-2 text-[12px] text-bad">用例列表加载失败：{error}</p>
            ) : !items ? (
              <p className="px-2 py-2 text-[12px] text-muted">正在读取用例…</p>
            ) : filtered.length === 0 ? (
              <p className="px-2 py-2 text-[12px] text-muted">没有匹配的用例，换个关键词试试。</p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.case}
                  type="button"
                  onClick={() => {
                    onPick(c.case);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-surface"
                >
                  <span className="num shrink-0 font-mono text-[11.5px] text-accent">{c.case}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px]">{c.title || "（无标题）"}</span>
                  <Chip tone={c.status === "abstained" ? "muted" : "ok"}>
                    {c.status === "abstained" ? "弃权" : "已生成"}
                  </Chip>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
