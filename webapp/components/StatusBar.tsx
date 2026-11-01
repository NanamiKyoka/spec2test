"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Health = { provider?: string; model?: string; data_source?: string };

export function StatusBar() {
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    let alive = true;
    let ac: AbortController | null = null;
    const check = () => {
      if (document.hidden) return;
      const my = ++seq.current;
      ac?.abort();
      ac = new AbortController();
      fetch("/api/health", { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((h) => {
          if (alive && my === seq.current) {
            setHealth(h);
            setOffline(false);
          }
        })
        .catch((e) => {
          if (alive && my === seq.current && (e as Error).name !== "AbortError") setOffline(true);
        });
    };
    check();
    const id = window.setInterval(check, 15000);
    const onVisible = () => {
      if (!document.hidden) check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      ac?.abort();
    };
  }, []);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
      <span className="font-semibold">Spec2Test</span>
      <nav className="flex gap-3 text-sm text-muted">
        <Link href="/">对话</Link>
        <Link href="/data">数据</Link>
        <Link href="/eval">评测</Link>
        <Link href="/api">API</Link>
        <Link href="/about">关于</Link>
      </nav>
      <span className="ml-auto text-xs text-muted" role="status" aria-live="polite">
        {offline ? "后端未连接" : `${health?.provider ?? "—"} · ${health?.model ?? "—"}`}
      </span>
    </header>
  );
}
