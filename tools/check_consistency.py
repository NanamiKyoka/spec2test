"""一致性自检：report.json 与 abstain.json 的 gold 合计、逐例 gold、calls 必须一致。"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_BASE = os.path.join(ROOT, "data", "score")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEFAULT_BASE,
                    help="score 目录；交付快照用 results/score")
    base = ap.parse_args().base
    rep = {r["case"]: r for r in json.load(open(os.path.join(base, "report.json"), encoding="utf-8"))}
    abst = {r["case"]: r for r in json.load(open(os.path.join(base, "abstain.json"), encoding="utf-8"))}

    problems = []
    if set(rep) != set(abst):
        problems.append(f"用例集合不一致: {sorted(set(rep) ^ set(abst))}")

    for cid in sorted(set(rep) & set(abst)):
        g1, g2 = rep[cid].get("gold_ie_n"), abst[cid].get("gold_ies")
        if g1 != g2:
            problems.append(f"{cid} gold: report={g1} abstain={g2}")
        c1 = rep[cid].get("calls")
        c2 = abst[cid].get("calls")
        if c1 != c2:
            problems.append(f"{cid} calls: report={c1} abstain={c2}")

    t1 = sum(r.get("gold_ie_n") or 0 for r in rep.values())
    t2 = sum(r.get("gold_ies") or 0 for r in abst.values())
    if t1 != t2:
        problems.append(f"gold 合计: report={t1} abstain={t2}")

    if problems:
        print("INCONSISTENT")
        for p in problems:
            print("  -", p)
        sys.exit(1)
    print(f"OK gold={t1} cases={len(rep)} calls={sum(r.get('calls') or 0 for r in rep.values())}")


if __name__ == "__main__":
    main()
