import { useSyncExternalStore } from "react";

export type RunMode = "steps" | "full" | "repair_only";
export type Strictness = "strict" | "skip_lte_r2" | "r1_only";
export type Engine = "pipeline" | "agent";

export type RunOptions = {
  messages: string[]; // 空 = 全部候选
  mode: RunMode;
  repairs: number;
  strictness: Strictness;
  engine: Engine; // pipeline = 固定六阶段；agent = 模型自选工具顺序
  skills: string[]; // 选中的技能，随修复提示带入
  mcpTools: string[] | null; // null = 全部只读工具可用；数组 = 仅这些
};

export const DEFAULT_OPTIONS: RunOptions = {
  messages: [],
  mode: "full",
  repairs: 1,
  strictness: "strict",
  engine: "pipeline",
  skills: [],
  mcpTools: null,
};

export const ENGINE_LABELS: Record<Engine, string> = {
  pipeline: "固定管线（六阶段）",
  agent: "模型自选（工具编排）",
};

export const MODE_LABELS: Record<RunMode, string> = {
  steps: "只生成步骤",
  full: "步骤 + IE 字段",
  repair_only: "只重修已有产物",
};

export const STRICTNESS_LABELS: Record<Strictness, string> = {
  strict: "严格（R1 + R2 + R3）",
  skip_lte_r2: "跳过字段校验（R2）",
  r1_only: "只查消息存在（R1）",
};

export const REPAIR_CHOICES = [0, 1, 2, 3];

let state: RunOptions = { ...DEFAULT_OPTIONS };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function getRunOptions(): RunOptions {
  return state;
}

export function subscribeRunOptions(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function setRunOptions(patch: Partial<RunOptions>) {
  state = {
    ...state,
    ...patch,
    messages: patch.messages ? [...patch.messages] : state.messages,
    skills: patch.skills ? [...patch.skills] : state.skills,
    mcpTools: patch.mcpTools === undefined
      ? state.mcpTools
      : patch.mcpTools === null
        ? null
        : [...patch.mcpTools],
  };
  emit();
}

export function resetRunOptions() {
  state = { ...DEFAULT_OPTIONS };
  emit();
}

export function useRunOptions(): RunOptions {
  return useSyncExternalStore(subscribeRunOptions, getRunOptions, () => DEFAULT_OPTIONS);
}
