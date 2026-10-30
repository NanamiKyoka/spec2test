import { Info, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "../ui";

type Kind = "loading" | "error" | "empty";

export function AsyncState({
  state,
  title,
  message,
  onRetry,
  action,
  compact = false,
}: {
  state: Kind;
  title?: string;
  message?: string;
  onRetry?: () => void;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  if (state === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`rounded-md border border-line bg-surface ${compact ? "p-3" : "p-5"}`}
      >
        <div className="h-3 w-1/3 animate-pulse rounded bg-line/60" />
        <div className="mt-3 h-3 w-2/3 animate-pulse rounded bg-line/40" />
        <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-line/30" />
        <span className="sr-only">正在读取…</span>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div
        role="alert"
        className={`rounded-md border border-bad/40 bg-bad/5 ${compact ? "p-3" : "p-5"}`}
      >
        <div className="flex items-start gap-2 text-[13px] text-bad">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">{title || "读取失败"}</div>
            {message && <div className="mt-1 text-[12px] text-bad/80">{message}</div>}
            {onRetry && (
              <Button variant="subtle" size="sm" className="mt-2" onClick={onRetry}>
                <RefreshCw className="h-3.5 w-3.5" /> 重试
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-md border border-line bg-surface text-center ${compact ? "p-4" : "p-8"}`}
    >
      <Info className="mx-auto h-5 w-5 text-muted" />
      <div className="mt-2 text-[13px] font-medium text-ink">{title || "暂无数据"}</div>
      {message && <div className="mt-1 text-[12px] text-muted">{message}</div>}
      {action && <div className="mt-3 flex justify-center gap-2">{action}</div>}
    </div>
  );
}
