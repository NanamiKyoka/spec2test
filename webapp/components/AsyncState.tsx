"use client";

import { Info, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "../ui";

type Kind = "loading" | "error" | "empty";

/*
 * 统一加载/错误/空态。
 * 三种状态共用：同一圆角与边框、同一标题字号（13px）、同一内边距节奏。
 * 差异只由颜色、图标与文案承担，避免同一页面出现三种"盒子"。
 */
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
  const pad = compact ? "p-3" : "p-5";

  if (state === "loading") {
    return (
      <div role="status" aria-live="polite" className={`rounded-md border border-line bg-surface ${pad}`}>
        <div className="text-sm text-muted">{title || "正在读取…"}</div>
        <div className="mt-3 space-y-2" aria-hidden>
          <div className="h-3 w-1/3 rounded bg-line/60" />
          <div className="h-3 w-2/3 rounded bg-line/40" />
          <div className="h-3 w-1/2 rounded bg-line/30" />
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div role="alert" className={`rounded-md border border-bad/40 bg-bad/5 ${pad}`}>
        <div className="flex items-start gap-2">
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-bad/10 text-bad">
            <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-bad-ink">{title || "读取失败"}</div>
            {message && (
              <div className="mt-1 max-w-[52ch] text-xs leading-relaxed text-bad-ink">{message}</div>
            )}
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
    <div className={`rounded-md border border-line bg-surface text-center ${pad}`}>
      <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-canvas text-muted">
        <Info className="h-5 w-5" aria-hidden />
      </div>
      <div className="mt-2 text-sm font-medium text-ink">{title || "暂无数据"}</div>
      {message && (
        <div className="mx-auto mt-1 max-w-[52ch] text-xs leading-relaxed text-muted">{message}</div>
      )}
      {action && <div className="mt-3 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
