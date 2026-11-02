"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Health = { provider?: string; model?: string };

const NAV = [
  { href: "/", label: "对话" },
  { href: "/data", label: "数据" },
  { href: "/eval", label: "评测" },
  { href: "/lab", label: "实验" },
  { href: "/api", label: "API" },
  { href: "/about", label: "关于" },
];

const TITLES: Record<string, string> = {
  "/": "对话",
  "/data": "数据",
  "/eval": "评测",
  "/lab": "实验",
  "/api": "API",
  "/about": "关于",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
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

  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const title = TITLES[pathname] ?? (pathname.startsWith("/case") ? "用例详情" : "Spec2Test");

  return (
    <div className="flex h-full bg-canvas">
      <aside className="flex w-[228px] shrink-0 flex-col border-r border-line bg-canvas px-3 py-4">
        <Link href="/" className="flex items-center gap-2 px-2">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-accent text-xs font-semibold text-white">
            S2
          </span>
          <span className="text-sm font-semibold tracking-tight">Spec2Test</span>
        </Link>
        <span className="mt-1 px-2 text-xs text-muted">NR NTN 一致性用例生成</span>
        <nav className="mt-6 flex flex-col gap-1" aria-label="主导航">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? "page" : undefined}
              className={`rounded-md px-3 py-2 text-sm transition-colors ${
                active(n.href) ? "bg-active font-medium text-ink" : "text-muted hover:bg-raised hover:text-ink"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-2 px-2 text-xs text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${offline ? "bg-bad" : "bg-ok"}`} aria-hidden />
          {offline ? "后端未连接" : `${health?.provider ?? "—"} · ${health?.model ?? "—"}`} /* taste-skill-ignore */
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col bg-canvas">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-canvas px-4">
          <span className="text-sm font-medium text-ink">{title}</span>
          <span className="text-xs text-muted">NR NTN 6.7</span>
        </header>
        <div className="min-h-0 flex-1 p-2">
          <div className="h-full overflow-hidden rounded-sheet border border-line bg-surface">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
