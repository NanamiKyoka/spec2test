"use client";

import { useEffect } from "react";
import { ApprovalCard } from "@/components/copilot/ApprovalCard";
import { LoadingCard } from "@/components/copilot/LoadingCard";
import { ResultCard } from "@/components/copilot/ResultCard";
import { RunCard } from "@/components/copilot/RunCard";
import { setJob } from "@/lib/jobStore";

export default function Page() {
  const allowed = process.env.NODE_ENV !== "production";

  useEffect(() => {
    if (!allowed) return;
    setJob("fixture", {
      id: "fixture",
      case: "6.7.1.99",
      state: "running",
      log: [
        { t: 0, msg: "[ingest] 读取规范用例" },
        { t: 1, msg: "[context] 上下文裁剪完成" },
        { t: 2, msg: "[candidates] 抽取到 1 个候选消息" },
      ],
    });
  }, [allowed]);

  if (!allowed) return <main className="p-6">not available</main>;

  return (
    <main className="space-y-4 p-6" data-testid="cards">
      <div data-testid="run">
        <RunCard caseId="6.7.1.99" />
      </div>
      <div data-testid="loading">
        <LoadingCard title="读取六阶段证据" />
      </div>
      <div data-testid="approval">
        <ApprovalCard jobId="fixture" candidates={["SIB1"]} onDecide={() => {}} />
      </div>
      <div data-testid="result-reject">
        <ResultCard
          caseId="6.7.1.99"
          verdict="reject"
          L1={1}
          L3={0.5}
          stages={[
            { stage: "generate", status: "ok", summary: "生成 3 条消息" },
            { stage: "validate", status: "rejected", summary: "违规 1 条" },
          ]}
          violations={[{ rule: "R2", path: "messages[SIB1].ies[0].name", detail: "unknown field" }]}
        />
      </div>
      <div data-testid="result-abstain">
        <ResultCard
          caseId="6.7.1.98"
          verdict="abstained"
          L1={1}
          L3={null}
          stages={[{ stage: "generate", status: "skipped", summary: "弃权：未调用模型" }]}
          violations={[]}
        />
      </div>
    </main>
  );
}
