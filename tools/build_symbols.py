"""从 TS 38.331 的 ASN.1 抽 RRC 消息的字段集合（半自动，V2 部分）。

只做：定义表构建 + 从目标消息可达的字段名/路径收集（深度上限 4）。
不做完整 ASN.1 语法解析；抽取结果需人工筛（见 docs/P2-REPORT.md）。
"""
import json
import os
import re
import sys

TARGETS = ["SIB1", "SIB2", "SIB4", "SIB5", "SIB19", "SIB25", "Paging"]
KNOWN_UNCOVERED = ["SystemInformationBlockType1", "SystemInformationBlockType3",
                   "SystemInformationBlockType24", "SystemInformationBlockType33",
                   "REGISTRATION"]

DEF = re.compile(r"\s*([A-Za-z][A-Za-z0-9-]*)\s*::=\s*(SEQUENCE|CHOICE|ENUMERATED|SET)\s*\{", re.M)
FIELD = re.compile(r"^\s{0,40}([a-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)\s+"
                   r"([A-Z][A-Za-z0-9-]*|SEQUENCE|CHOICE|ENUMERATED|INTEGER|BOOLEAN|BIT STRING|OCTET STRING)",
                   re.M)
MAX_DEPTH = 6
MANUAL = ["s-NonIntraSearch", "t-service-r17", "ephemerisInfo-r17"]


def body_at(text, brace_idx):
    depth = 0
    for i in range(brace_idx, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[brace_idx + 1:i]
    return text[brace_idx + 1:]


def parse_defs(text):
    defs = {}
    for m in DEF.finditer(text):
        name, kind = m.group(1), m.group(2)
        brace = text.find("{", m.start())
        defs.setdefault(name, {"kind": kind, "body": body_at(text, brace)})
    return defs


def members(body):
    out = []
    for m in FIELD.finditer(body):
        out.append((m.group(1), m.group(2)))
    return out


def reachable(defs, root):
    fields, paths, seen_types = set(), set(), {root}
    queue = [(root, root, 1)]
    while queue:
        typename, prefix, depth = queue.pop(0)
        d = defs.get(typename)
        if not d:
            continue
        for fname, ftype in members(d["body"]):
            fields.add(fname)
            paths.add(prefix + "." + fname)
            if depth < MAX_DEPTH and ftype in defs and ftype not in seen_types:
                seen_types.add(ftype)
                queue.append((ftype, prefix + "." + fname, depth + 1))
    return sorted(fields), sorted(paths)


def fallback_fields(text, name):
    """ASN.1 排版被打散时的兜底：在 TAG 区域里扫字段名。"""
    idx = text.find("-- TAG-" + name + "-START")
    if idx < 0:
        idx = text.find(name + " ::=")
    if idx < 0:
        return []
    stop = text.find("-- ASN1STOP", idx)
    region = text[idx:stop if stop > 0 else idx + 9000]
    names = set()
    pat = re.compile("^" + chr(92) + "s{0,40}([a-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)" + chr(92) + "s", re.M)
    for m in pat.finditer(region):
        names.add(m.group(1))
    return sorted(names)


def main(txt_path, out_path):
    text = open(txt_path, encoding="utf-8", errors="replace").read()
    defs = parse_defs(text)
    out = {"meta": {"source": "TS 38.331 v19.4.0", "defs_parsed": len(defs),
                    "max_depth": MAX_DEPTH},
           "messages": {}, "known_uncovered": KNOWN_UNCOVERED}
    def resolve(name):
        for cand in (name, name + "-r17", name + "-r18", name + "-r19"):
            if cand in defs:
                return cand
        return None

    for name in TARGETS:
        r = resolve(name)
        if r and r in defs:
            fields, paths = reachable(defs, r)
        else:
            fields, paths = [], []
        if len(fields) < 10:
            fb = fallback_fields(text, r or name)
            fields = sorted(set(fields) | set(fb))
            paths = [name + "." + f for f in fields]
            out["messages"][name] = {"kind": "fallback", "definition": r,
                                     "fields": fields, "paths": paths}
        else:
            out["messages"][name] = {"kind": defs[r]["kind"], "definition": r,
                                     "fields": fields, "paths": paths}
    # 全局标识符集合：只在 38.331 里出现过的字段名才可能合法（降低 R2 误报）
    global_ids = sorted(set(re.findall(r"^" + chr(92) + "s{0,40}([a-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)" + chr(92) + "s", text, re.M)))
    body_tokens = set()
    for d in defs.values():
        body_tokens |= set(re.findall(r"([a-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)" + chr(92) + "s+(?:SEQUENCE|CHOICE|ENUMERATED|[A-Z])", d["body"]))
        body_tokens |= set(re.findall(r"^" + chr(92) + "s{0,60}([a-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)" + chr(92) + "s", d["body"], re.M))
    out["global_identifiers"] = sorted(set(global_ids) | body_tokens
                                       | set(MANUAL))
    out["all_definitions"] = sorted(defs)
    out["all_defined_names"] = sorted(set(re.findall(r"([A-Za-z][A-Za-z0-9-]*)" + chr(92) + "s*::=", text)))
    # 人工筛：排版打散导致漏抽、但经人工确认存在的字段
    out["manual_review_added"] = MANUAL
    out["meta"]["global_identifiers"] = len(global_ids)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    json.dump(out, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    print(f"defs={len(defs)}")
    for t in TARGETS:
        m = out["messages"][t]
        print(f"{t:<16}{m['kind'] or '-':<10} fields={len(m['fields']):>4} paths={len(m['paths']):>5}"
              + ("  MISSING" if m.get("error") else ""))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
