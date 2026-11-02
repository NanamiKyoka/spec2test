"use client";

import { useAgent } from "@copilotkit/react-core/v2";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { currentConversationId, setCurrentConversationId } from "@/lib/conversation";

function toAgentMessages(convId: string, messages: { role: string; content: string }[]) {
  return messages.map((m, i) => ({
    id: `${convId}-${i}`,
    role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
    content: m.content,
  }));
}

/** 把选中的会话 / 用例历史载入聊天；新对话时清空线程。 */
export function ChatHistoryBridge() {
  const { agent } = useAgent();

  useEffect(() => {
    let alive = true;

    const loadConv = async (id: string) => {
      try {
        const detail = await api.conversation(id);
        if (!alive) return;
        setCurrentConversationId(id);
        agent.setMessages(toAgentMessages(id, detail.messages));
      } catch {
        /* 会话不存在时保持当前对话 */
      }
    };

    const onLoadConv = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) loadConv(id);
    };

    const onNewConv = () => {
      agent.setMessages([]);
    };

    const current = currentConversationId();
    if (current && agent.messages.length === 0) loadConv(current);

    window.addEventListener("s2t-load-conv", onLoadConv);
    window.addEventListener("s2t-new-conv", onNewConv);
    return () => {
      alive = false;
      window.removeEventListener("s2t-load-conv", onLoadConv);
      window.removeEventListener("s2t-new-conv", onNewConv);
    };
  }, [agent]);

  return null;
}
