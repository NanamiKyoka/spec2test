"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Health = { provider?: string; model?: string; data_source?: string };

const NAV = [
  { href: "/", label: "对话" },
  { href: "/data", label: "数据与评测" },
  { href: "/api", label: "API" },
  { href: "/about", label: "关于" },
];

export function StatusBar() {
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);
  const seq = useRef(0);
  const pathname = usePathname();

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

  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-4 border-b border-line bg-canvas px-4">
      <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
        <span className="h-2 w-2 rounded-full bg-ink" aria-hidden />
        Spec2Test
      </Link>
      <nav className="flex items-center gap-1 text-sm">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active(n.href) ? "page" : undefined}
            className={`rounded-md px-2.5 py-1 transition-colors ${
              active(n.href) ? "bg-surface text-ink" : "text-muted hover:bg-surface/70 hover:text-ink"
            }`}
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <span
        className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-line/80 bg-surface px-2.5 py-1 text-xs text-muted"
        role="status"
        aria-live="polite"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${offline ? "bg-bad" : "bg-ok"}`} aria-hidden />
        {offline ? "后端未连接" : `${health?.provider ?? "—"} · ${health?.model ?? "—"}`} /* taste-skill-ignore */
      </span>
    </header>
  );
}
