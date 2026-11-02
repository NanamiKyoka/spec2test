import type { Job, Violation } from "./api";

export const STAGE_ORDER = [
  "ingest",
  "context",
  "candidates",
  "generate",
  "validate",
  "score",
] as const;

export type StageKey = (typeof STAGE_ORDER)[number];

export type StageView = {
  key: StageKey;
  label: string;
  status: "pending" | "ok" | "skipped" | "failed";
  summary: string;
  lines: string[];
};

export const STAGE_LABEL: Record<StageKey, string> = {
  ingest: "读取规范",
  context: "上下文裁剪",
  candidates: "候选消息",
  generate: "生成 IR",
  validate: "校验",
  score: "评分",
};

const LINE = /^\[(ingest|context|candidates|generate|validate|score)\]\s*([\s\S]*)$/;

function classify(text: string): StageView["status"] {
  if (/弃权|skipped/i.test(text)) return "skipped";
  if (/失败|failed|error|上游失败/i.test(text)) return "failed";
  return "ok";
}

export function buildStages(job?: Job): StageView[] {
  const byStage: Record<string, string[]> = {};
  for (const l of job?.log || []) {
    const m = LINE.exec(l.msg || "");
    if (!m) continue;
    (byStage[m[1]] ||= []).push(m[2]);
  }
  return STAGE_ORDER.map((key) => {
    const lines = byStage[key] || [];
    const status: StageView["status"] = lines.length ? classify(lines.join(" ")) : "pending";
    return {
      key,
      label: STAGE_LABEL[key],
      status,
      summary: lines[lines.length - 1] || "等待中",
      lines,
    };
  });
}

export function violationsOf(job?: Job): Violation[] {
  const r = job?.result;
  if (!r) return [];
  return (r.detail?.violations as Violation[]) || r.violations || [];
}

export function verdictOf(job?: Job): "pass" | "reject" | undefined {
  const v = job?.result?.verdict;
  if (v === "pass" || v === "reject") return v;
  const vs = violationsOf(job);
  if (vs.length) return "reject";
  if (job?.state === "done") return "pass";
  return undefined;
}

export function conclusionOf(job?: Job): string {
  if (!job) return "";
  if (job.state === "failed") return "执行失败，未产出结果。";
  if (job.verdict === "canceled") return "已取消，未调用模型。";
  if (job.state !== "done") return "运行中，尚未得出结论。";
  const stages = buildStages(job);
  const skipped = stages.filter((s) => s.status === "skipped").length;
  if (skipped >= 3) return "输入信息不足，已弃权：未生成 IE 字段内容。";
  const v = verdictOf(job);
  const vs = violationsOf(job);
  if (v === "reject") return `校验未通过（${vs.length} 条违规）—— 已拒收，未写入结果。`; /* taste-skill-ignore */
  return "校验通过，产物已写入结果。";
}
