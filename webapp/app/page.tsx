"use client";

import { CopilotChat } from "@copilotkit/react-ui";
import { useEffect, useState } from "react";
import { StatusBar } from "@/components/StatusBar";
import { RunRail } from "@/components/RunRail";
import { CopilotActions } from "@/components/copilot/actions";
import { CopilotProvider } from "@/components/CopilotProvider";
import { TracePanel } from "@/components/copilot/TracePanel";

const INSTRUCTIONS = `你是 Spec2Test 的测试意图编译器助手，只覆盖 3GPP TS 38.523-1 §6.7 的 8 个 NR NTN 用例。
规则：
1. 用户给出用例号或能对应到某用例的场景时，调用 run_case；不确定就追问。
2. 所有数字与判定只能来自 action 返回结果，禁止自行生成。
3. abstained 是弃权、reject 是拒收，都不能说成“通过”；failed 直接说明失败原因。
4. 不编造不存在的用例号；范围外请求明确说明只覆盖 §6.7 的 8 个用例。`;

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
    const onTrace = (e: Event) => {
      const d = (e as CustomEvent<TraceTarget>).detail;
      if (d?.jobId) setTrace(d);
    };
    window.addEventListener("s2t-trace", onTrace);
    return () => window.removeEventListener("s2t-trace", onTrace);
  }, []);

  return (
    <CopilotProvider>
      <div className="flex h-full flex-col">
        <StatusBar />
        <div className="flex min-h-0 flex-1">
          <RunRail onPickRun={(r) => setTrace({ jobId: r.job_id, case: r.case })} />
          <main className="relative min-w-0 flex-1">
            <CopilotActions />
            <CopilotChat
              className="h-full"
              labels={{
                title: "Spec2Test 助手",
                initial:
                  "给我用例号（如 6.7.1.3），或描述场景（卫星小区被禁止、GNSS 禁用、Sintrasearch、PLMN 重选）。",
              }}
              instructions={INSTRUCTIONS}
            />
          </main>
          {trace && <TracePanel jobId={trace.jobId} caseId={trace.case} onClose={() => setTrace(null)} />}
        </div>
      </div>
    </CopilotProvider>
  );
}
