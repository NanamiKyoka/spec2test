"use client";

import { CopilotChat } from "@copilotkit/react-ui";
import { useEffect, useState } from "react";
import { ChatHistoryBridge } from "@/components/copilot/ChatHistoryBridge";
import { ConversationList } from "@/components/copilot/ConversationList";
import { CopilotActions } from "@/components/copilot/actions";
import { ChatInput } from "@/components/copilot/ChatInput";
import { TracePanel } from "@/components/copilot/TracePanel";
import { ensureConversation } from "@/lib/conversation";
import { api } from "@/lib/api";

const INSTRUCTIONS = `你是 Spec2Test 的测试意图编译器助手，只覆盖 3GPP TS 38.523-1 §6.7 的 8 个 NR NTN 用例。
规则：
1. 用户给出用例号或能对应到某用例的场景时，调用 run_case；不确定就追问。
2. 所有数字与判定只能来自 action 返回结果，禁止自行生成。
3. abstained 是弃权、reject 是拒收，都不能说成“通过”；failed 直接说明失败原因。
4. 不编造不存在的用例号；范围外请求明确说明只覆盖 §6.7 的 8 个用例。
5. run_case 失败时如实说明原因；不得根据证据推测、还原或编造步骤与字段取值。
6. 用户要看分析/图表时调用 analyze_case；不要自己编造图表数据。
7. 运行参数（生成范围、修复轮数、严格度、候选消息）由输入框「+」菜单和审批卡决定，你不要向用户索要或自行设定。
8. 遇到校验违规（R1/R2/R3）或拿不准字段取舍时，先调用 list_skills / use_skill 加载对应技能，再说明怎么修；不要凭记忆编规则。`;

type TraceTarget = { jobId: string; case: string };

export default function Page() {
  const [trace, setTrace] = useState<TraceTarget | null>(null);

  useEffect(() => {
    const raw = window.location.hash.replace(/^#\/?/, "");
    const [path, query] = raw.split("?");
    if (!path) return;
    if (path === "case") {
      const id = new URLSearchParams(query || "").get("case");
      if (id) window.location.replace(`/case/${encodeURIComponent(id)}`);
      return;
    }
    if (["data", "eval", "api", "about", "chat"].includes(path)) {
      window.location.replace(path === "chat" ? `/${query ? "?" + query : ""}` : `/${path}`);
    }
  }, []);

  useEffect(() => {
    ensureConversation()
      .then(() => window.dispatchEvent(new Event("s2t-conv-changed")))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onTrace = (e: Event) => {
      const d = (e as CustomEvent<TraceTarget>).detail;
      if (d?.jobId && d?.case) setTrace(d);
    };
    window.addEventListener("s2t-trace", onTrace);
    return () => window.removeEventListener("s2t-trace", onTrace);
  }, []);

  const persistUserMessage = async (content: string) => {
    const cid = await ensureConversation();
    try {
      await api.appendMessage(cid, "user", content);
      window.dispatchEvent(new Event("s2t-conv-changed"));
    } catch {
      /* 写入失败不阻塞发送 */
    }
  };

  return (
    <div className="flex h-full min-h-0">
        <aside aria-label="对话" className="flex w-64 shrink-0 flex-col border-r border-line">
          <ConversationList />
        </aside>
        <main className="relative min-w-0 flex-1">
          <ChatHistoryBridge />
          <CopilotActions />
          <div className="chat-sparse h-full">
            <CopilotChat
              className="h-full"
              labels={{
                title: "Spec2Test 助手",
                initial:
                  "有什么可以帮你？给我用例号（如 6.7.1.3），或描述场景：卫星小区被禁止、GNSS 禁用、Sintrasearch、PLMN 重选。",
              }}
              instructions={INSTRUCTIONS}
              onSubmitMessage={persistUserMessage}
              Input={ChatInput}
            />
          </div>
        </main>
      {trace && <TracePanel jobId={trace.jobId} caseId={trace.case} onClose={() => setTrace(null)} />}
    </div>
  );
}
