"use client";

import { useEffect, useState } from "react";
import { api, type Conversation } from "@/lib/api";
import { currentConversationId, newConversation } from "@/lib/conversation";

export function ConversationList() {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api
      .conversations()
      .then((list) => {
        setConvs(list);
        setActive(currentConversationId());
      })
      .catch(() => setConvs([]));
  };

  useEffect(() => {
    load();
    const onChanged = () => load();
    window.addEventListener("s2t-conv-changed", onChanged);
    return () => window.removeEventListener("s2t-conv-changed", onChanged);
  }, []);

  const create = async () => {
    if (busy) return;
    const current = convs.find((c) => c.id === currentConversationId());
    if (current && (current.turns ?? 0) === 0) {
      window.dispatchEvent(new Event("s2t-new-conv"));
      return;
    }
    setBusy(true);
    try {
      await newConversation();
      window.dispatchEvent(new Event("s2t-conv-changed"));
      window.dispatchEvent(new Event("s2t-new-conv"));
    } finally {
      setBusy(false);
    }
  };

  const pick = (id: string) => {
    setActive(id);
    window.dispatchEvent(new CustomEvent("s2t-load-conv", { detail: id }));
  };

  const remove = async (id: string) => {
    try {
      await api.deleteConversation(id);
    } catch {
      return;
    }
    if (id === currentConversationId()) {
      await newConversation();
      window.dispatchEvent(new Event("s2t-new-conv"));
    }
    window.dispatchEvent(new Event("s2t-conv-changed"));
  };

  return (
    <div className="flex flex-col border-b border-line pb-2">
      <div className="px-3 pt-3">
        <button
          className="w-full rounded-md border border-line px-3 py-2 text-sm text-ink transition-colors hover:bg-surface disabled:opacity-50"
          disabled={busy}
          onClick={create}
        >
          + 新对话
        </button>
      </div>
      <ul className="scroll-thin mt-2 max-h-56 overflow-y-auto px-2 text-sm">
        {convs.length === 0 && <li className="px-2 py-1 text-xs text-muted">暂无会话</li>}
        {convs.map((c) => (
          <li key={c.id} className="group flex items-center gap-1">
            <button
              className={`min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left transition-colors ${
                active === c.id ? "bg-surface text-ink" : "text-muted hover:bg-surface/70 hover:text-ink"
              }`}
              onClick={() => pick(c.id)}
              title={c.title}
            >
              {c.title || "未命名"}
            </button>
            <button
              className="shrink-0 rounded px-1 text-xs text-muted opacity-0 transition-opacity hover:text-bad group-hover:opacity-100"
              onClick={() => remove(c.id)}
              title="删除会话"
              aria-label={`删除会话 ${c.title || c.id}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
