import { fetchJson } from "./http";

export type SymbolTable = {
  messages: Record<string, { fields?: string[]; paths?: string[] }>;
};

export type IeFieldLite = { name: string; value?: string; condition?: string };

export type IeTableLite = {
  message?: string;
  derivation_path?: string;
  ies?: IeFieldLite[];
  leaf_ies?: IeFieldLite[];
};

export type IeFileLite = { message_tables?: IeTableLite[] };

let symbolsPromise: Promise<SymbolTable | null> | null = null;

/** 符号表 670KB，按需加载；失败不缓存，允许下次重试。 */
export function loadSymbols(): Promise<SymbolTable | null> {
  if (!symbolsPromise) {
    symbolsPromise = fetchJson<SymbolTable>(
      "/data/symbols/rrc_symbols.json",
      "/results/symbols/rrc_symbols.json"
    )
      .then((r) => r.data)
      .catch(() => {
        symbolsPromise = null;
        return null;
      });
  }
  return symbolsPromise;
}

/** 某字段在符号表里的完整路径（可能多条，如多个 nonCriticalExtension 层级）。 */
export function pathsFor(sym: SymbolTable | null, message: string, field: string): string[] {
  const paths = sym?.messages?.[message]?.paths || [];
  return paths.filter((p) => p === `${message}.${field}` || p.endsWith(`.${field}`));
}

export const normName = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * 官方答案中与某条消息对应的叶子字段集合。
 * 返回 null 表示官方答案没有单列这条消息（不等于字段不存在）。
 */
export function goldForMessage(
  ie: IeFileLite | null | undefined,
  message: string
): Set<string> | null {
  if (!message) return null;
  const n = normName(message);
  let found = false;
  const out = new Set<string>();
  for (const t of ie?.message_tables || []) {
    if (normName(t.message || "") !== n) continue;
    found = true;
    for (const f of t.leaf_ies?.length ? t.leaf_ies : t.ies || []) {
      if (f?.name) out.add(normName(f.name));
    }
  }
  return found ? out : null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 校验违规里能对该字段对得上的条目（按字段名边界匹配，避免 id 命中 valid）。 */
export function violationsFor(
  violations: { rule: string; path: string; detail: string }[],
  field: string
): { rule: string; path: string; detail: string }[] {
  if (!field) return [];
  const re = new RegExp(`(^|[^a-z0-9-])${escapeRe(field)}([^a-z0-9-]|$)`, "i");
  return violations.filter((v) => re.test(v.detail) || re.test(v.path));
}
