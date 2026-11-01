"use client";

import { useEffect } from "react";
import { ApprovalCard } from "@/components/copilot/ApprovalCard";
import { ResultCard } from "@/components/copilot/ResultCard";
import { RunCard } from "@/components/copilot/RunCard";
import { setJob } from "@/lib/jobStore";

export default function Page() {
  const allowed = process.env.NODE_ENV !== "production";

  useEffect(() => {
    if (!allowed) return;
    setJob("fixture", {
      id: "fixture",
      case: "6.7.1.3",
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
      <RunCard caseId="6.7.1.3" />
      <ApprovalCard jobId="fixture" candidates={["SIB1"]} onDecide={() => {}} />
      <ResultCard
        caseId="6.7.1.3"
        verdict="reject"
        L1={1}
        L3={0.5}
        stages={[
          { stage: "generate", status: "ok", summary: "生成 3 条消息" },
          { stage: "validate", status: "rejected", summary: "违规 1 条" },
        ]}
        violations={[{ rule: "R2", path: "messages[SIB1].ies[0].name", detail: "unknown field" }]}
      />
      <ResultCard
        caseId="6.7.1.4"
        verdict="abstained"
        L1={1}
        L3={null}
        stages={[{ stage: "generate", status: "skipped", summary: "弃权：未调用模型" }]}
        violations={[]}
      />
    </main>
  );
}
