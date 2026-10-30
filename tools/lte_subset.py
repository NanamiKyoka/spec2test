"""从 TS 36.331 文本中抽取指定 LTE 消息的一层字段名（确定性，无模型）。

用法: lte_subset.py <lte331.txt> <rrc_symbols.json>
"""
import json
import re
import sys

TARGETS = [
    "RRCConnectionRelease", "RRCConnectionReconfiguration",
    "RRCConnectionReconfigurationComplete", "RRCConnectionSetup",
    "SecurityModeCommand", "SystemInformationBlockType1",
    "SystemInformationBlockType3", "SystemInformationBlockType5",
    "SystemInformationBlockType24", "SystemInformationBlockType33",
]
FIELD = re.compile(r"^\s{4,}([a-z][A-Za-z0-9-]*)\s{2,}[A-Za-z(\[]")


def extract(text, name):
    lines = text.splitlines()
    start = None
    for i, ln in enumerate(lines):
        if re.match(rf"^{re.escape(name)}\s*::=\s*SEQUENCE\s*\{{", ln):
            start = i
            break
    if start is None:
        return []
    depth, fields = 0, []
    for ln in lines[start:start + 200]:
        depth += ln.count("{") - ln.count("}")
        if depth <= 0 and fields:
            break
        if depth == 1:
            m = FIELD.match(ln)
            if m and m.group(1) not in fields:
                fields.append(m.group(1))
    return fields


def main(txt_path, sym_path):
    text = open(txt_path, encoding="utf-8", errors="replace").read()
    d = json.load(open(sym_path, encoding="utf-8"))
    added = {}
    for name in TARGETS:
        if name in d["messages"]:
            continue
        fields = extract(text, name)
        if fields:
            d["messages"][name] = {"fields": fields, "rat": "LTE", "source": "TS 36.331"}
            added[name] = len(fields)
    d.setdefault("meta", {})["mixed_rat"] = "NR (TS 38.331) + LTE subset (TS 36.331), 覆盖以入选用例为准"
    json.dump(d, open(sym_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("added:", added, "total messages:", len(d["messages"]))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
