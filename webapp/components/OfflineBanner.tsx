"use client";

export function OfflineBanner({
  netOffline,
  backendOffline,
}: {
  netOffline: boolean;
  backendOffline: boolean;
}) {
  if (!netOffline && !backendOffline) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        "border-b px-4 py-1.5 text-xs " +
        (netOffline
          ? "border-warn/30 bg-warn/10 text-warn-ink"
          : "border-bad/30 bg-bad/10 text-bad-ink")
      }
    >
      {netOffline
        ? "离线：正在显示上次缓存的数据"
        : "无法连接后端（127.0.0.1:8000）。请先启动 scripts/serve.py。"}
    </div>
  );
}
