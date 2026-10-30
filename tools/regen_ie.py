"""只重跑 IE 段（调用产品入口 gen_ie.generate_all，弃权在调用前生效）。"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_ie

BASE = "E:/workspace/ai_competition/data"
SYMBOLS = os.path.join(BASE, "symbols", "rrc_symbols.json")


def main():
    total_calls = 0
    rows = []
    for name in sorted(os.listdir(os.path.join(BASE, "ctx"))):
        if not re.match(r"^6\..*\.json$", name):
            continue
        ctx = json.load(open(os.path.join(BASE, "ctx", name), encoding="utf-8"))
        path = os.path.join(BASE, "out", name)
        out = json.load(open(path, encoding="utf-8"))
        steps = out.get("steps") or []

        res = gen_ie.generate_all(ctx, steps, SYMBOLS)
        total_calls += res["calls"]
        out["messages"] = res["messages"]
        out["status"] = res["status"]
        if res.get("reason"):
            out["reason"] = res["reason"]
        else:
            out.pop("reason", None)
        out["_stage2"] = {"candidates": res["candidates"], "calls": res["calls"]}
        out["calls"] = res["calls"]
        json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

        gold = json.load(open(os.path.join(BASE, "ir", "ie", name), encoding="utf-8"))
        gmsg = len({m["message"] for m in gold["message_tables"]})
        ies = sum(len(m.get("ies") or []) for m in res["messages"])
        rows.append((ctx["case_id"], res))
        print(f"{ctx['case_id']:<10} status={res['status']:<9} cand={len(res['candidates']):>2} "
              f"calls={res['calls']:>2} ies={ies:>3} gold_msg={gmsg:>2}")

    saved = sum(1 for _, r in rows if r["status"] == "abstained")
    print(f"done cases={len(rows)} total_calls={total_calls} abstained={saved} "
          f"calls_saved={saved}x1~12")


if __name__ == "__main__":
    main()
