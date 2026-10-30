"""评分：L1 合法率与 L3 IE recall 计分；L2 只做定性对照，不计分。

输出：
  data/score/report.json         逐例矩阵（L1/L3）
  data/score/l2_qualitative.json gold 序列 vs system 序列并排
"""
import json
import os
import re
import sys

L3_SKIP = {"6.7.1.1"}        # 原文 specific message contents 为 None

MSG_PREFIX = re.compile(r"^(nr\s*rrc\s*:\s*)", re.I)


def norm_msg(m):
    m = MSG_PREFIX.sub("", (m or "").strip())
    return re.sub(r"[^a-z0-9]+", "", m.lower())


def norm_ie(s):
    """字段名归一：小写、去掉 ::=/花括号残留、连字符与下划线一律剔除。"""
    s = (s or "").lower()
    s = re.sub(r"::=|\{|\}", " ", s)
    s = re.sub(r"[_\-\s]+", "", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def l1_ok(ir):
    """结构合法率：步骤可解析为 IR（主体/方向/消息字段类型合法）。
    注意：空 message 仍算结构合法；消息质量看 step_msg_coverage。"""
    if not isinstance(ir, dict) or "steps" not in ir:
        return 0.0
    steps = [s for s in (ir.get("steps") or []) if isinstance(s, dict)]
    if not steps:
        return 0.0
    good = sum(1 for s in steps
               if s.get("actor") in ("SS", "UE")
               and s.get("direction") in ("S->U", "U->S")
               and isinstance(s.get("message"), str))
    return round(good / len(steps), 3)


def step_msg_coverage(ir):
    """步骤消息覆盖率：非空 message 的步骤 / 总步骤。"""
    steps = [s for s in ((ir or {}).get("steps") or []) if isinstance(s, dict)]
    if not steps:
        return 0.0
    filled = sum(1 for s in steps if isinstance(s.get("message"), str) and s["message"].strip())
    return round(filled / len(steps), 3)


TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*")


def tokens_from_text(text):
    return [norm_ie(t) for t in TOKEN.findall(text or "") if len(t) > 2]


def recall(gen, gold):
    if not gold:
        return None
    if not gen:
        return 0.0
    gs = set(gold)
    hit = len(gs & set(gen))
    return round(hit / len(gs), 3)


def gold_leaf_ies(gold_path):
    """gold 叶子字段（唯一口径）：有 leaf_ies 键则以其为准，空列表不回退。"""
    out = []
    for t in json.load(open(gold_path, encoding="utf-8"))["message_tables"]:
        for it in (t["leaf_ies"] if "leaf_ies" in t else (t.get("ies") or [])):
            out.append(norm_ie(it["name"]))
    return out


REL_SUFFIX = re.compile(r"-r\d+$")


def norm_ie_relaxed(s):
    """宽松口径：去掉路径前缀与 -rNN 版本后缀，用于基线对照（不替代主指标）。"""
    s = (s or "").strip().lower().split(".")[-1]
    s = REL_SUFFIX.sub("", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def relaxed_recall(gen_names, gold_names):
    gs = {norm_ie_relaxed(x) for x in (gold_names or []) if x}
    if not gs:
        return None
    gen = {norm_ie_relaxed(x) for x in (gen_names or []) if x}
    return round(len(gs & gen) / len(gs), 3)


def struct_ies(struct):
    return [norm_ie(i.get("name", "")) for m in (struct.get("messages") or [])
            if isinstance(m, dict)
            for i in (m.get("ies") or []) if isinstance(i, dict)]


def struct_ies_raw(struct):
    return [i.get("name", "") for m in (struct.get("messages") or [])
            if isinstance(m, dict)
            for i in (m.get("ies") or []) if isinstance(i, dict)]


def gold_leaf_raw(gold_path):
    out = []
    for t in json.load(open(gold_path, encoding="utf-8"))["message_tables"]:
        for it in (t["leaf_ies"] if "leaf_ies" in t else (t.get("ies") or [])):
            out.append(it["name"])
    return out


def load_structured_baseline(base_dir, cid):
    """结构化基线放在自由文本基线目录的同级 out_baseline_struct/。"""
    p = os.path.join(os.path.dirname(os.path.abspath(base_dir)),
                     "out_baseline_struct", cid + ".json")
    if not os.path.exists(p):
        return None
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception:
        return None


def baseline_metrics(struct, gold_ie):
    """返回结构化基线的 L1_base / L1_base_cov / L3_base。"""
    return {"L1_base": l1_ok(struct),
            "L1_base_cov": step_msg_coverage(struct),
            "L3_base": recall(struct_ies(struct), gold_ie)}


def main(gold_steps_dir, gold_ie_dir, out_dir, base_dir, report_dir):
    os.makedirs(report_dir, exist_ok=True)
    cases = sorted(f[:-5] for f in os.listdir(gold_steps_dir) if f.endswith(".json"))
    rows, qual = [], []
    for cid in cases:
        gold_steps = json.load(open(os.path.join(gold_steps_dir, cid + ".json"),
                                    encoding="utf-8"))["steps"]
        gold_seq = [norm_msg(s["message"]) for s in gold_steps
                    if s.get("direction") in ("S->U", "U->S") and s.get("message")]

        gold_ie = []
        gold_raw = []
        p = os.path.join(gold_ie_dir, cid + ".json")
        if os.path.exists(p):
            gold_ie = gold_leaf_ies(p)
            gold_raw = gold_leaf_raw(p)

        gen_path = os.path.join(out_dir, cid + ".json")
        gen = json.load(open(gen_path, encoding="utf-8")) if os.path.exists(gen_path) else {}
        gen_seq = [norm_msg(s.get("message")) for s in (gen.get("steps") or [])
                   if s.get("direction") in ("S->U", "U->S") and s.get("message")]
        gen_ie = [norm_ie(i.get("name", "")) for m in (gen.get("messages") or [])
                  for i in (m.get("ies") or [])]
        gen_raw = [i.get("name", "") for m in (gen.get("messages") or [])
                   for i in (m.get("ies") or [])]

        base_path = os.path.join(base_dir, cid + ".json")
        base_text = ""
        if os.path.exists(base_path):
            base_text = json.load(open(base_path, encoding="utf-8")).get("text", "")

        struct = load_structured_baseline(base_dir, cid)
        base_raw = struct_ies_raw(struct) if struct is not None else []
        if struct is not None:
            bm = baseline_metrics(struct, gold_ie)
            l1_base = bm["L1_base"]
            l1_base_cov = bm["L1_base_cov"]
            l3_base = None if cid in L3_SKIP else bm["L3_base"]
        else:
            # 旧行为：自由文本基线没有结构化 IE，L3 不可比
            base_structured = bool(re.search(r'"ies"\s*:', base_text))
            base_ie = [] if not base_structured else tokens_from_text(base_text)
            l1_base = 1.0 if base_text.strip() else 0.0
            l1_base_cov = None
            l3_base = None if (cid in L3_SKIP or not base_structured) else recall(base_ie, gold_ie)

        abstained = gen.get("status") == "abstained"
        rows.append({
            "case": cid,
            "L1": l1_ok(gen),
            "L1_msg_cov": step_msg_coverage(gen),
            "status": gen.get("status", "generated"),
            "calls": gen.get("calls", (gen.get("_stage2") or {}).get("calls")),
            "L3_recall": "abstained" if abstained else
                         (None if cid in L3_SKIP else recall(gen_ie, gold_ie)),
            "L3_relaxed": "abstained" if abstained else
                          (None if cid in L3_SKIP else relaxed_recall(gen_raw, gold_raw)),
            "L1_base": l1_base,
            "L1_base_cov": l1_base_cov,
            "L3_base": l3_base,
            "L3_base_relaxed": None if (cid in L3_SKIP or struct is None)
                               else relaxed_recall(base_raw, gold_raw),
            "gold_ie_n": len(gold_ie),
        })
        qual.append({"case": cid, "gold_sequence": gold_seq, "system_sequence": gen_seq})

    json.dump(rows, open(os.path.join(report_dir, "report.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    json.dump(qual, open(os.path.join(report_dir, "l2_qualitative.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)

    def fmt(x):
        if x is None:
            return "—"
        if isinstance(x, str):
            return x
        return f"{x:.3f}"

    print(f"{'case':<10}{'L1_sys':>8}{'L1_base':>9}{'L3_sys':>8}{'L3_base':>9}{'goldIE':>8}")
    for r in rows:
        print(f"{r['case']:<10}{fmt(r['L1']):>8}{fmt(r['L1_base']):>9}"
              f"{fmt(r['L3_recall']):>8}{fmt(r['L3_base']):>9}{r['gold_ie_n']:>8}")
    print("L2 不计分，逐例并排见 l2_qualitative.json；不报平均数（n=8 无统计意义）")


if __name__ == "__main__":
    a = sys.argv[1:]
    main(a[0], a[1], a[2], a[3], a[4])
