/* ============================================================
   单例页「测试意图」导出
   - 纯前端把 out / report / ctx 组装成可带走的 Markdown 与 JSON
   - 不发请求；Blob + <a download>，下载后 revokeObjectURL
   - 字段名保持与 IR 快照一致，便于下游直接消费
   ============================================================ */

export type ExportVerdict = "pass" | "reject" | "abstained" | "unknown";

export type ExportIe = { name: string; value?: string; condition?: string; comment?: string };
export type ExportStep = {
  st: number | string;
  actor?: string;
  direction?: string;
  message?: string;
  tp_ref?: number[];
};
export type ExportMessage = { message?: string; ies?: ExportIe[]; table_ref?: string };
export type ExportViolation = { rule: string; path: string; detail: string };

export type ExportOut = {
  case_id?: string;
  status?: string;
  reason?: string;
  verdict?: string | null;
  violations?: ExportViolation[];
  steps?: ExportStep[];
  messages?: ExportMessage[];
};

export type ExportReport = {
  L1?: number | null;
  L3_recall?: number | null | "abstained";
  calls?: number | null;
  gold_ie_n?: number | null;
  status?: string;
};

export type ExportCtx = { title?: string } | null | undefined;

export type ExportModel = {
  caseId: string;
  title: string;
  verdict: ExportVerdict;
  status: string;
  reason: string;
  L1: number | null;
  L3: number | "abstained" | null;
  calls: number | null;
  steps: ExportStep[];
  messages: ExportMessage[];
  violations: ExportViolation[];
  generatedAt: Date;
};

export const EXPORT_DASH = "—"; /* taste-skill-ignore */

const VERDICT_LABEL: Record<ExportVerdict, string> = {
  pass: "通过",
  reject: "已拒收",
  abstained: "已弃权",
  unknown: "未判定",
};

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** 数字统一三位小数；undefined / NaN 一律显示占位符。 */
function num3(v: unknown): string {
  return isNum(v) ? v.toFixed(3) : EXPORT_DASH;
}

function l3Text(v: ExportModel["L3"]): string {
  if (v === "abstained") return "弃权";
  return num3(v);
}

/** 表格单元格：转义竖线、折叠换行，空值用占位符，绝不出现 [object Object]。 */
function cell(v: unknown): string {
  let s: string;
  if (v === null || v === undefined) s = "";
  else if (typeof v === "number" && !Number.isFinite(v)) s = "";
  else if (typeof v === "object") s = "";
  else s = String(v);
  const t = s.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
  return t || EXPORT_DASH;
}

/** 判定口径与单例页一致：弃权 > 拒收 > 通过 > 未判定。 */
export function resolveVerdict(
  out?: ExportOut | null,
  report?: ExportReport | null
): ExportVerdict {
  if (out?.status === "abstained") return "abstained";
  if (out?.verdict === "reject") return "reject";
  if ((out?.violations?.length ?? 0) > 0) return "reject";
  if (out?.verdict === "pass") return "pass";
  if (report?.status === "abstained") return "abstained";
  return "unknown";
}

export function buildExport(
  caseId: string,
  out?: ExportOut | null,
  report?: ExportReport | null,
  ctx?: ExportCtx,
  now: Date = new Date()
): ExportModel {
  const title = (ctx?.title || "").trim() || "用例";
  const rawL1 = report?.L1;
  const rawL3 = report?.L3_recall;
  const rawCalls = report?.calls;
  return {
    caseId,
    title,
    verdict: resolveVerdict(out, report),
    status: out?.status || report?.status || "unknown",
    reason: out?.reason || "",
    L1: isNum(rawL1) ? rawL1 : null,
    L3: rawL3 === "abstained" ? "abstained" : isNum(rawL3) ? rawL3 : null,
    calls: isNum(rawCalls) ? rawCalls : null,
    steps: out?.steps || [],
    messages: out?.messages || [],
    violations: out?.violations || [],
    generatedAt: now,
  };
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Markdown：结论 → 步骤 → 消息与 IE → 校验 → 来源。 */
export function renderIntentMarkdown(model: ExportModel): string {
  const lines: string[] = [];

  lines.push(`# ${model.caseId} 测试意图 · ${model.title}`);
  lines.push("");
  lines.push(`- 判定：${VERDICT_LABEL[model.verdict]}`);
  lines.push(`- L1：${num3(model.L1)}`);
  lines.push(`- L3：${l3Text(model.L3)}`);
  lines.push(`- 调用数：${model.calls ?? EXPORT_DASH}`);
  lines.push("");

  lines.push("## 测试步骤");
  lines.push("");
  if (!model.steps.length) {
    lines.push("无");
  } else {
    lines.push("| # | 主体 | 方向 | 消息 | 关联 TP |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const s of model.steps) {
      lines.push(
        `| ${cell(s.st)} | ${cell(s.actor)} | ${cell(s.direction)} | ${cell(s.message)} | ${cell(
          s.tp_ref?.length ? s.tp_ref.join(", ") : undefined
        )} |`
      );
    }
  }
  lines.push("");

  lines.push("## 消息与 IE");
  lines.push("");
  if (!model.messages.length) {
    lines.push(model.status === "abstained" ? "无（弃权：未生成信令内容）" : "无");
    lines.push("");
  } else {
    for (const m of model.messages) {
      lines.push(`### ${m.message ? String(m.message) : "（未命名消息）"}`);
      lines.push("");
      const ies = m.ies || [];
      if (!ies.length) {
        lines.push("无");
        lines.push("");
        continue;
      }
      lines.push("| 字段 | 取值 | 条件 |");
      lines.push("| --- | --- | --- |");
      for (const f of ies) {
        lines.push(`| ${cell(f.name)} | ${cell(f.value)} | ${cell(f.condition)} |`);
      }
      lines.push("");
    }
  }

  lines.push("## 校验");
  lines.push("");
  if (!model.violations.length) {
    lines.push("无违规（R1/R2/R3）");
  } else {
    for (const v of model.violations) {
      lines.push(`- \`${v.rule}\` ${v.path || EXPORT_DASH} — ${v.detail || EXPORT_DASH}`); /* taste-skill-ignore */
    }
  }
  lines.push("");

  lines.push("## 来源");
  lines.push("");
  lines.push(`Spec2Test · 校验器判定 · 生成于 ${dateOnly(model.generatedAt)}`);
  if (model.status === "abstained") {
    lines.push("");
    lines.push(
      `弃权：未生成 IE 字段内容（阶段二未调用模型）；以上步骤为前序解析产物，含消息名、不含字段取值${model.reason ? `。原因：${model.reason}` : ""}`
    );
  }

  return lines.join("\n") + "\n";
}

/** JSON：原始 steps / messages 原样透传，缺失的数值字段直接省略。 */
export function buildIntentJson(model: ExportModel): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    case: model.caseId,
    title: model.title,
    verdict: model.verdict,
    status: model.status,
    reason: model.reason,
  };
  if (model.L1 !== null) doc.L1 = model.L1;
  if (model.L3 !== null) doc.L3 = model.L3;
  if (model.calls !== null) doc.calls = model.calls;
  doc.steps = model.steps;
  doc.messages = model.messages;
  doc.violations = model.violations;
  doc.provenance = {
    tool: "Spec2Test",
    judge: "deterministic-validator",
    generated_at: model.generatedAt.toISOString(),
  };
  return doc;
}

export function intentFilename(caseId: string, ext: "md" | "json"): string {
  return `spec2test-${caseId}-intent.${ext}`;
}

function saveBlob(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadIntentMarkdown(
  caseId: string,
  out?: ExportOut | null,
  report?: ExportReport | null,
  ctx?: ExportCtx
): void {
  const model = buildExport(caseId, out, report, ctx);
  saveBlob(
    intentFilename(caseId, "md"),
    renderIntentMarkdown(model),
    "text/markdown;charset=utf-8"
  );
}

export function downloadIntentJson(
  caseId: string,
  out?: ExportOut | null,
  report?: ExportReport | null,
  ctx?: ExportCtx
): void {
  const model = buildExport(caseId, out, report, ctx);
  saveBlob(
    intentFilename(caseId, "json"),
    JSON.stringify(buildIntentJson(model), null, 2) + "\n",
    "application/json;charset=utf-8"
  );
}
