"""弃权/幻觉统计（只读）。gold 计数复用 score.gold_leaf_ies，避免两套口径。"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import score

BASE = os.path.join(os.path.dirname(HERE), "data")
OUT = os.path.join(BASE, "out")
BASE_OUT = os.path.join(BASE, "out_baseline")


def ies(messages):
    return sum(len(m.get("ies") or []) for m in (messages or []))


def main():
    rows = []
    for name in sorted(os.listdir(OUT)):
        if not re.match(r"^6\..*\.json$", name):
            continue
        out = json.load(open(os.path.join(OUT, name), encoding="utf-8"))
        st2 = out.get("_stage2") or {}
        cand = st2.get("candidates") or []
        sys_ies = ies(out.get("messages"))

        bp = os.path.join(BASE_OUT, name)
        base_text, base_status, base_chars = "", "absent", 0
        if os.path.exists(bp):
            base_text = json.load(open(bp, encoding="utf-8")).get("text", "") or ""
            if base_text.strip():
                base_status, base_chars = "prose", len(base_text)

        gold_n = len(score.gold_leaf_ies(os.path.join(BASE, "ir", "ie", name)))
        rows.append({
            "case": out["case_id"], "in_msg": len(cand),
            "status": out.get("status", "generated"),
            "calls": out.get("calls", st2.get("calls", 0)),
            "sys_ies": sys_ies,
            "base_status": base_status, "base_chars": base_chars,
            "base_ies": 0,          # 基线不产出结构化 IE
            "gold_ies": gold_n,
            "unsupported": len(cand) == 0,
        })

    print(f"{'case':<10}{'输入':>4}{'状态':>10}{'调用':>5}{'系统IE':>7}{'基线':>16}{'gold':>6}")
    for r in rows:
        b = f"{r['base_status']} {r['base_chars']}字 / 0 IE"
        print(f"{r['case']:<10}{r['in_msg']:>4}{r['status']:>10}{r['calls']:>5}"
              f"{r['sys_ies']:>7}{b:>16}{r['gold_ies']:>6}")

    uns = [r for r in rows if r["unsupported"]]
    print(f"\n无依据用例 {len(uns)}：系统无依据生成 {sum(1 for r in uns if r['sys_ies']>0)}，"
          f"正确弃权 {sum(1 for r in uns if r['sys_ies']==0)}，调用 {sum(r['calls'] for r in uns)}")
    print(f"gold 合计 {sum(r['gold_ies'] for r in rows)}；系统总调用 {sum(r['calls'] for r in rows)}")
    json.dump(rows, open(os.path.join(BASE, "score", "abstain.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
