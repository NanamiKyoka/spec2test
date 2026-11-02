"""真实错误集盲测：跑当前校验器与旧校验器，逐条报告检出/漏检。

用法：
    py -3 tools/blindset.py

输入：results/blindset/annotations.json + results/blindset/real/*.json（本地 data/blindset/ 优先）
输出：results/blindset/report.json、results/blindset/report.md
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import validate as V

ANNOT_LOCAL = os.path.join(ROOT, "data", "blindset", "annotations.json")
REAL_LOCAL = os.path.join(ROOT, "data", "blindset", "real")
ANNOT = ANNOT_LOCAL if os.path.exists(ANNOT_LOCAL) else os.path.join(
    ROOT, "results", "blindset", "annotations.json")
REAL = REAL_LOCAL if os.path.isdir(REAL_LOCAL) else os.path.join(
    ROOT, "results", "blindset", "real")
SYMS = os.path.join(ROOT, "data", "symbols", "rrc_symbols.json")
OUT = os.path.join(ROOT, "results", "blindset")


def legacy_validate(ir, symbols):
    """改动前的规则：R1 只查 RRC 前缀；R2 只查精确名或全局集合。"""
    msgs = symbols["messages"]
    known = set(msgs) | set(symbols.get("known_uncovered", [])) | set(
        symbols.get("all_definitions", [])) | set(symbols.get("all_defined_names", []))
    gids = set(symbols.get("global_identifiers", []))
    out = []
    for m in ir.get("steps") or []:
        raw = (m.get("message") or "").strip()
        if not raw:
            continue
        parts = V.split_messages(raw)
        first = parts[0] if parts else raw
        if not re.match(r"^(RRC|SIB\s?\d|MIB|Paging|SystemInformationBlockType|MasterInformationBlock)",
                        first, re.I):
            continue
        ok, unknown = V.resolve_message(raw, known)
        if not ok:
            out.append({"rule": "R1", "path": f"steps[{m.get('st')}].message",
                        "detail": f"unknown message: {'/'.join(unknown)}"})
    for mt in ir.get("messages") or []:
        msg = (mt.get("message") or "").strip()
        if msg not in msgs or msgs[msg].get("_partial"):
            continue
        fields = set(msgs[msg]["fields"])
        for k, ie in enumerate(mt.get("ies") or []):
            nm = (ie.get("name") or "").strip()
            if not nm:
                continue
            if nm not in fields and nm not in gids:
                out.append({"rule": "R2", "path": f"messages[{msg}].ies[{k}].name",
                            "detail": f"unknown field {nm!r} for {msg}"})
    # R3 与当前实现一致
    out += [x for x in V.validate(ir, {**symbols, "global_identifiers": []})
            if x["rule"] == "R3"]
    return out


def hit(violations, detect):
    if not detect:
        return None
    for v in violations:
        if v.get("rule") == detect.get("rule") and v.get("path") == detect.get("path"):
            return v
    return None


def summary(items, key):
    total = len(items)
    ins = [x for x in items if x.get("in_scope")]
    outs = [x for x in items if not x.get("in_scope")]
    det = [x for x in items if x.get(key)]
    det_in = [x for x in ins if x.get(key)]
    det_out = [x for x in outs if x.get(key)]
    return {
        "total": total,
        "detected": len(det),
        "missed": total - len(det),
        "rate": round(len(det) / total, 3) if total else None,
        "in_scope": {"total": len(ins), "detected": len(det_in),
                     "missed": len(ins) - len(det_in)},
        "out_of_scope": {"total": len(outs), "detected": len(det_out),
                         "missed": len(outs) - len(det_out)},
    }


def main():
    ann = json.load(open(ANNOT, encoding="utf-8"))
    syms = json.load(open(SYMS, encoding="utf-8"))
    cache = {}
    rows = []
    for group in ("core", "edge_cases"):
        for item in ann.get(group, []):
            path = os.path.join(REAL, item["file"])
            if path not in cache:
                ir = json.load(open(path, encoding="utf-8"))
                cache[path] = (V.validate(ir, syms), legacy_validate(ir, syms))
            cur_v, old_v = cache[path]
            cur = hit(cur_v, item.get("detect"))
            old = hit(old_v, item.get("detect"))
            row = dict(item)
            row["group"] = group
            row["current_detected"] = bool(cur)
            row["legacy_detected"] = bool(old)
            row["current_violation"] = cur
            row["legacy_violation"] = old
            rows.append(row)

    core = [r for r in rows if r["group"] == "core"]
    edge = [r for r in rows if r["group"] == "edge_cases"]
    report = {
        "protocol": ann["protocol"],
        "core": core,
        "edge_cases": edge,
        "summary": {
            "current": summary(core, "current_detected"),
            "legacy": summary(core, "legacy_detected"),
            "edge_current": summary(edge, "current_detected"),
            "edge_legacy": summary(edge, "legacy_detected"),
        },
        "source": "真实模型输出；标注见 results/blindset/annotations.json",
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    s = report["summary"]
    lines = [
        "# 真实错误集盲测（%d 条核心错误）" % s["current"]["total"],
        "",
        "来源：真实模型输出，非注入模板。标注在运行前固定。",
        "",
        "| 口径 | 检出 | 漏检 | 检出率 | 范围内 | 范围外 |",
        "|---|---|---|---|---|---|",
        "| 旧校验器 | %d | %d | %.0f%% | %d/%d | %d/%d |" % (
            s["legacy"]["detected"], s["legacy"]["missed"],
            100 * s["legacy"]["rate"],
            s["legacy"]["in_scope"]["detected"], s["legacy"]["in_scope"]["total"],
            s["legacy"]["out_of_scope"]["detected"], s["legacy"]["out_of_scope"]["total"]),
        "| 当前校验器 | %d | %d | %.0f%% | %d/%d | %d/%d |" % (
            s["current"]["detected"], s["current"]["missed"],
            100 * s["current"]["rate"],
            s["current"]["in_scope"]["detected"], s["current"]["in_scope"]["total"],
            s["current"]["out_of_scope"]["detected"], s["current"]["out_of_scope"]["total"]),
        "",
        "## 逐条",
        "",
        "| id | 用例 | 位置 | 错误 | 规则 | 范围 | 旧 | 新 |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for r in core:
        lines.append("| %s | %s | `%s` | %s | %s | %s | %s | %s |" % (
            r["id"], r["case"], r["location"], r["error"].replace("|", "/"),
            r["expect_rule"] or "-", "内" if r["in_scope"] else "外",
            "✓" if r["legacy_detected"] else "✗",
            "✓" if r["current_detected"] else "✗"))
    lines += [
        "",
        "## 边界样本（不计入核心 %d 条）" % s["current"]["total"],
        "",
        "| id | 用例 | 错误 | 新 | 说明 |",
        "|---|---|---|---|---|",
    ]
    for r in edge:
        lines.append("| %s | %s | %s | %s | %s |" % (
            r["id"], r["case"], r["error"].replace("|", "/"),
            "✓" if r["current_detected"] else "✗", r.get("note", "")))
    lines += [
        "",
        "## 读法",
        "",
        "- 范围内 = R1/R2/R3 声明覆盖的错误；范围外 = 方向、顺序、完整性等未声明检查。",
        "- 旧校验器 = 改动前的 R1 前缀守卫 + R2 精确名/全局集合；当前校验器 = 本次改动后。",
        "- 漏检不隐藏：范围外漏检在表中逐条列出。",
    ]
    with open(os.path.join(OUT, "report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    print("\nwrote", os.path.join(OUT, "report.json"))


if __name__ == "__main__":
    main()
