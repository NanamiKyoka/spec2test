"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CaseView } from "@/views/CaseView";

/** 右侧抽屉：打开用例面板，不离开当前页面。 */
export function CaseDrawer() {
  const [caseId, setCaseId] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setShown(false);
    const t = setTimeout(() => {
      setCaseId(null);
      returnFocus.current?.focus?.();
    }, 220);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (!id) return;
      returnFocus.current = document.activeElement as HTMLElement | null;
      setCaseId(id);
      requestAnimationFrame(() => setShown(true));
    };
    window.addEventListener("s2t-open-case", onOpen);
    return () => window.removeEventListener("s2t-open-case", onOpen);
  }, []);

  useEffect(() => {
    if (!caseId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [caseId, close]);

  if (!caseId) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="case-drawer-title">
      <div
        aria-hidden
        onClick={close}
        className={`absolute inset-0 bg-ink/30 transition-opacity duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          shown ? "opacity-100" : "opacity-0"
        }`}
      />
      <section
        className={`absolute right-0 top-0 flex h-full w-[min(880px,94vw)] flex-col rounded-l-2xl border-l border-line/80 bg-canvas border-l border-line shadow-overlay transition-transform duration-[280ms] ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform ${
          shown ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center gap-3 border-b border-line/80 px-5 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span id="case-drawer-title" className="text-sm font-medium">用例面板</span>
              <span className="num font-mono /* taste-skill-ignore */ text-xs text-muted">{caseId}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted">判定、字段级证据与违规位置</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label="关闭用例面板"
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-full text-muted transition hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1">
          <CaseView caseId={caseId} embedded />
        </div>
      </section>
    </div>
  );
}
