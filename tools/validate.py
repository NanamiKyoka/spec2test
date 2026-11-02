"""确定性校验器：R1 消息存在 / R2 字段合法 / R3 TP 覆盖。无模型。

用法：
  python validate.py data/gold_ir data/symbols/rrc_symbols.json            # 误报检查
  python validate.py data/defects  data/symbols/rrc_symbols.json            # 缺陷检出
输出 data/validate/<dir名>.json
"""
import json
import os
import re
import sys

STOP = {"the", "that", "with", "shall", "should", "from", "into", "this", "ue", "ss",
        "and", "not", "for", "does", "when", "then", "after", "before", "case", "cell"}

# 非 RRC 的物理层/NAS 步骤写法，R1 不判消息存在性
NON_RRC = re.compile(
    r"^(PDCCH|PDSCH|PUSCH|PRACH|PUCCH|DCI|NAS|REGISTRATION|CONFIGURATION UPDATE|"
    r"Authentication|Security Mode|Registration)", re.I)

# 人工复核的嵌套/别名字段：ASN.1 可达但自动抽取遗漏（TS 38.331 v19.4.0）。
# 用于 R2 的消息作用域判定；不放进全局集合，避免把“字段放错消息”误判为合法。
MESSAGE_FIELD_EXTRA = {
    "SIB1": {"trackingAreaList", "mcc", "mnc"},
    "SIB2": {"s-NonIntraSearch"},
    "SIB19": {"ephemerisInfo-r17", "t-service-r17", "ta-Info-r17",
              "epochTime-r17", "cellSpecificKoffset-r17",
              "ntn-UlSyncValidityDuration-r17"},
    "Paging": {"systemInfoModification"},
}


def norm(s):
    return re.sub(r"[^a-z0-9-]+", " ", (s or "").lower()).strip()


def leaf_name(name):
    """取 IE 路径的叶子名：a.b[0].c -> c；用于接受合法嵌套路径。"""
    return re.sub(r"\[\d+\]", "", (name or "").rsplit(".", 1)[-1]).strip()


PAREN = re.compile(r"\([^)]*\)")
SIB = re.compile(r"^SIB\s?(\d{1,2})$")


def expand_message(part):
    """把一个消息写法展开成候选 ASN.1 名（含简称/全名互转）。"""
    p = part.strip()
    cands = [p] if p else []
    m = SIB.match(p)
    if m:
        cands.append(f"SystemInformationBlockType{int(m.group(1))}")
    elif p == "MIB":
        cands.append("MasterInformationBlock")
    elif p == "MasterInformationBlock":
        cands.append("MIB")
    elif p.startswith("SystemInformationBlockType"):
        n = p[len("SystemInformationBlockType"):]
        if n.isdigit():
            cands.append(f"SIB{int(n)}")
    return cands


def split_messages(raw):
    """剥离 'NR RRC:' 前缀与括号注释，按 / , & 拆成多个消息。"""
    s = re.sub(r"^nr\s*rrc\s*:\s*", "", (raw or "").strip(), flags=re.I)
    s = PAREN.sub(" ", s)
    parts = [p.strip() for p in re.split(r"[/,&]| and |\+", s) if p.strip()]
    return parts or ([s.strip()] if s.strip() else [])


def resolve_message(raw, known):
    """返回 (是否合法, 未知片段列表)。复合写法中任一子项未知即视为非法。"""
    unknown = []
    for part in split_messages(raw):
        cands = expand_message(part)
        if not cands:
            continue
        if not any(c in known for c in cands):
            unknown.append(part)
    return (not unknown), unknown


def keywords(text):
    return {w for w in norm(text).split() if len(w) >= 4 and w not in STOP}


def validate(ir, symbols):
    msgs = symbols["messages"]
    known = set(msgs) | set(symbols.get("known_uncovered", [])) | set(symbols.get("all_definitions", [])) | set(symbols.get("all_defined_names", []))
    gids = set(symbols.get("global_identifiers", []))
    out = []

    for m in ir.get("steps") or []:
        raw = (m.get("message") or "").strip()
        if not raw:
            continue
        # 物理层/NAS 写法本来就不是 ASN.1 消息名，跳过；其余非空写法一律判。
        if NON_RRC.match(raw):
            continue
        ok, unknown = resolve_message(raw, known)
        if not ok:
            out.append({"rule": "R1", "path": f"steps[{m.get('st')}].message",
                        "detail": f"unknown message: {'/'.join(unknown)}"})

    extras = symbols.get("manual_review_by_message") or MESSAGE_FIELD_EXTRA
    for mt in ir.get("messages") or []:
        msg = (mt.get("message") or "").strip()
        if msg not in msgs:          # 未覆盖消息跳过 R2
            continue
        if msgs[msg].get("_partial"):  # LTE 子集只保证存在性（R1），字段不完整
            continue
        fields = set(msgs[msg]["fields"]) | set(extras.get(msg, []))
        for k, ie in enumerate(mt.get("ies") or []):
            nm = (ie.get("name") or "").strip()
            if not nm:
                continue
            lf = leaf_name(nm)
            if lf in fields:
                continue
            if lf in gids:
                detail = f"field {nm!r} is defined in ASN.1 but not in {msg}"
            else:
                detail = f"unknown field {nm!r} for {msg}"
            out.append({"rule": "R2", "path": f"messages[{msg}].ies[{k}].name",
                        "detail": detail})

    # R3：每条 TP 必须被至少一个步骤引用（兼容 tp_ref 列表与旧 tp 字符串）
    refs = set()
    for s in ir.get("steps") or []:
        raw = s.get("tp_ref")
        vals = raw if isinstance(raw, list) else [s.get("tp")]
        for v in vals:
            for part in re.split(r"[,/\s]+", str(v or "").strip()):
                if part.isdigit():
                    refs.add(int(part))
    tps = ir.get("tp") or []
    if isinstance(tps, list):
        for tp in tps:
            idx = tp.get("index") if isinstance(tp, dict) else tp
            try:
                idx = int(idx)
            except (TypeError, ValueError):
                continue
            if idx not in refs:
                out.append({"rule": "R3", "path": f"tp[{idx}]",
                            "detail": "该 TP 无任何步骤引用（tp 列未出现）"})
    return out


def main(ir_dir, sym_path, out_path):
    symbols = json.load(open(sym_path, encoding="utf-8"))
    results, total = [], 0
    for name in sorted(os.listdir(ir_dir)):
        if not name.endswith(".json"):
            continue
        if name.startswith("_"):
            continue
        ir = json.load(open(os.path.join(ir_dir, name), encoding="utf-8"))
        if not isinstance(ir, dict):
            continue
        v = validate(ir, symbols)
        total += len(v)
        results.append({"file": name, "case_id": ir.get("case_id", name[:-5]),
                        "violations": v})
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    json.dump(results, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"files={len(results)} violations={total}")
    for r in results:
        if r["violations"]:
            print(f"  {r['case_id']}: {len(r['violations'])} -> "
                  + ", ".join(sorted({x['rule'] for x in r['violations']})))


if __name__ == "__main__":
    d, s, o = sys.argv[1], sys.argv[2], sys.argv[3]
    main(d, s, o)
