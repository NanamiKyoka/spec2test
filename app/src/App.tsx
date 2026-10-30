import { useEffect, useState } from "react";
import { Moon, Sun, MonitorSmartphone } from "lucide-react";
import { api } from "./lib/api";
import { Button, Chip, TopBar, type ViewKey } from "./ui";
import { DataView } from "./views/DataView";
import { ChatView } from "./views/ChatView";
import { ApiView } from "./views/ApiView";
import { AboutView } from "./views/AboutView";
import { CaseView } from "./views/CaseView";

type Theme = "system" | "light" | "dark";
const VIEWS: ViewKey[] = ["data", "chat", "api", "about"];

/** 单例页使用独立 hash：#/case?case=6.7.1.3（不占用主导航的四个视图） */
function readCaseId(): string | null {
  const m = /^#\/?case(?:\/([0-9.]+))?(?:\?(.*))?$/.exec(window.location.hash);
  if (!m) return null;
  const fromPath = m[1];
  const fromQuery = new URLSearchParams(m[2] || "").get("case");
  return fromPath || fromQuery || null;
}

function readHash(): ViewKey {
  const h = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  return (VIEWS as string[]).includes(h) ? (h as ViewKey) : "data";
}

function applyTheme(t: Theme) {
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export default function App() {
  const [view, setView] = useState<ViewKey>(readHash);
  const [caseId, setCaseId] = useState<string | null>(readCaseId);
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("s2t-theme") as Theme) || "system");
  const [health, setHealth] = useState<any>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const onHash = () => {
      setView(readHash());
      setCaseId(readCaseId());
    };
    window.addEventListener("hashchange", onHash);
    if (!window.location.hash) window.location.replace("#/data");
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem("s2t-theme", theme);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const fn = () => theme === "system" && applyTheme("system");
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [theme]);

  useEffect(() => {
    const check = () =>
      api.health().then((h) => { setHealth(h); setOffline(false); }).catch(() => setOffline(true));
    check();
    // 后端可能晚于前端启动；轮询让离线横幅在恢复后自动消失
    const id = window.setInterval(check, 15000);
    return () => window.clearInterval(id);
  }, []);

  const nav = (v: ViewKey) => {
    if (v === "chat") {
      const id = localStorage.getItem("s2t-current-conv");
      window.location.hash = "#/chat" + (id ? `?c=${id}` : "");
    } else {
      window.location.hash = "#/" + v;
    }
  };

  return (
    <div className="flex h-full flex-col">
      <TopBar
        view={caseId ? "data" : view}
        onNav={nav}
        status={
          <Chip tone={offline ? "bad" : "ok"}>
            <span className={`h-1.5 w-1.5 rounded-full ${offline ? "dot-bad" : "dot-ok"}`} />
            {offline ? "后端未连接" : `${health?.provider ?? "—"} · ${health?.model ?? "—"}`}
          </Chip>
        }
        right={
          <Button
            variant="subtle"
            size="icon"
            title={`主题：${theme === "system" ? "跟随系统" : theme === "light" ? "浅色" : "深色"}`}
            aria-label="切换主题"
            onClick={() => setTheme(theme === "system" ? "light" : theme === "light" ? "dark" : "system")}
          >
            {theme === "dark" ? <Moon className="h-4 w-4" /> : theme === "light" ? <Sun className="h-4 w-4" /> : <MonitorSmartphone className="h-4 w-4" />}
          </Button>
        }
      />

      {offline && (
        <div className="border-b border-bad/30 bg-bad/10 px-4 py-1.5 text-[12px] text-bad">
          无法连接后端（127.0.0.1:8000）。请先启动 <code className="font-mono">scripts/serve.py</code>。
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-hidden">
        {caseId ? (
          <CaseView caseId={caseId} />
        ) : (
          <>
            {view === "data" && <DataView />}
            {view === "chat" && <ChatView />}
            {view === "api" && <ApiView />}
            {view === "about" && <AboutView />}
          </>
        )}
      </main>
    </div>
  );
}
