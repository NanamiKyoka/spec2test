"""候选召回消融：复用现有步骤，只重跑 IE 生成，产物写独立目录。

用法：
    py -3.12 tools/reeval_candidates.py data/_reeval/out
    py -3.12 tools/score.py data/ir/steps_pdf data/ir/ie data/_reeval/out \\
        data/out_baseline data/_reeval/score
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_ie
import score
from ir import parse_test_purpose

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SYM = os.path.join(ROOT, "data", "symbols", "rrc_symbols.json")


def main(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    old = {}
    try:
        for r in json.load(open(os.path.join(ROOT, "data", "score", "report.json"), encoding="utf-8")):
            old[r["case"]] = r.get("L3_recall")
    except Exception:
        pass

    print("%-10s %-28s %5s %8s %8s" % ("case", "candidates", "calls", "L3_old", "L3_new"))
    for name in sorted(os.listdir(os.path.join(ROOT, "data", "out"))):
        if not name.endswith(".json"):
            continue
        cid = name[:-5]
        ctx = json.load(open(os.path.join(ROOT, "data", "ctx", name), encoding="utf-8"))
        prior = json.load(open(os.path.join(ROOT, "data", "out", name), encoding="utf-8"))
        t0 = time.time()
        try:
            res = gen_ie.generate_all(ctx, prior.get("steps") or [], SYM)
        except Exception as e:
            print("%-10s ERROR %s" % (cid, str(e)[:120]))
            continue
        ir = {"case_id": cid, "tp": parse_test_purpose(ctx.get("test_purpose", "")),
              "steps": prior.get("steps") or [], "messages": res["messages"],
              "status": res["status"], "reason": res.get("reason", ""),
              "_stage2": {"candidates": res.get("candidates", []),
                          "calls": res.get("calls", 0)},
              "calls": res.get("calls", 0)}
        json.dump(ir, open(os.path.join(out_dir, name), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)
        gold = (score.gold_leaf_ies(os.path.join(ROOT, "data", "ir", "ie", name))
                if os.path.exists(os.path.join(ROOT, "data", "ir", "ie", name)) else [])
        gen = [score.norm_ie(i.get("name", "")) for m in res["messages"]
               for i in (m.get("ies") or [])]
        l3 = "abstained" if res["status"] == "abstained" else score.recall(gen, gold)
        print("%-10s %-28s %5d %8s %8s  (%.0fs)" % (
            cid, ",".join(res.get("candidates") or []) or "-", res.get("calls", 0),
            old.get(cid), l3, time.time() - t0))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "_reeval", "out"))
