import * as React from "react";
import { ChevronDown, RefreshCw, Search, X } from "lucide-react";
import { api, type CaseItem } from "../lib/api";
import { Button, Chip } from "../ui";

/** 用例选择器：触发器留在输入区内，列表向上浮出，不挤动 composer。 */
export function CasePicker({ onPick, disabled }: { onPick: (caseId: string) => void; disabled?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<CaseItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!open || items) return;
    let alive = true;
    setError(null);
    api
      .cases()
      .then((list) => alive && setItems(list))
      .catch((e: Error) => alive && setError(e.message || "加载失败"));
    return () => {
      alive = false;
    };
  }, [open, items, tick]);

  const query = q.trim().toLowerCase();
  const filtered = (items || []).filter((c) => {
    if (!query) return true;
    return c.case.includes(query) || (c.title || "").toLowerCase().includes(query);
  });

  const pick = (id: string) => {
    onPick(id);
    setOpen(false);
    setQ("");
  };

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-surface hover:text-ink disabled:opacity-50"
      >
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
        选一个用例
        {items ? <span className="num text-xs">（{items.length}）</span> : null}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-1.5 w-full max-w-[420px] overflow-hidden rounded-md border border-line bg-canvas shadow-card">
          <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
              }}
              placeholder="搜索用例号或标题，如 NTN / 6.7.1.3"
              aria-label="搜索用例"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="清空搜索"
                className="rounded p-0.5 text-muted transition-colors hover:bg-surface hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between px-2.5 py-1 text-xs text-muted">
            <span className="num">
              {error ? "加载失败" : !items ? "读取中…" : query ? `匹配 ${filtered.length} / ${items.length}` : `共 ${items.length} 个用例`}
            </span>
            <span>Esc 关闭</span>
          </div>

          <div className="scroll-thin max-h-[220px] overflow-y-auto p-1" role="group" aria-label="用例列表">
            {error ? (
              <div className="flex flex-col items-start gap-2 px-2 py-2">
                <p className="text-xs leading-relaxed text-bad-ink">用例列表加载失败：{error}</p>
                <Button variant="ghost" size="sm" onClick={() => setTick((v) => v + 1)}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  重新加载
                </Button>
              </div>
            ) : !items ? (
              <p className="px-2 py-2 text-xs text-muted">正在读取用例…</p>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-start gap-1 px-2 py-2">
                <p className="text-xs leading-relaxed text-muted">没有匹配「{q.trim()}」的用例。</p>
                <button
                  type="button"
                  onClick={() => setQ("")}
                  className="text-xs font-medium text-accent-ink hover:underline"
                >
                  清空搜索
                </button>
              </div>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.case}
                  type="button"
                  onClick={() => pick(c.case)}
                  title={c.title || c.case}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-surface"
                >
                  <span className="num shrink-0 font-mono text-xs text-accent-ink">{c.case}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">{c.title || "（无标题）"}</span>
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
