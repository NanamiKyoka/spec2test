"""两段式生成：步骤段（gen_steps）→ IE 段（gen_ie，逐消息）。"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)

import llm
import gen_steps
import gen_ie

SYMBOLS = os.path.join(ROOT, "data", "symbols", "rrc_symbols.json")


def mock_ir(ctx):
    tp = re.findall(r"\((\d+)\)", ctx["test_purpose"]) or ["1"]
    steps = [{"st": k, "actor": "SS", "action": "transmit", "message": "",
              "direction": "S->U", "tp_ref": [int(i)]} for k, i in enumerate(tp, 1)]
    return {"case_id": ctx["case_id"], "steps": steps, "messages": []}


def live_ir(ctx):
    steps, meta = gen_steps.generate_steps(ctx)
    ie = gen_ie.generate_all(ctx, steps, SYMBOLS)
    return {"case_id": ctx["case_id"], "steps": steps, "messages": ie["messages"],
            "status": ie["status"], "reason": ie.get("reason", ""),
            "_stage2": {"candidates": ie["candidates"], "calls": ie["calls"]},
            "_backend_model": llm.LAST_MODEL, "_stage1": meta}


def parse_args(argv):
    pos, dry, limit, i = [], False, 0, 0
    while i < len(argv):
        a = argv[i]
        if a == "--dry-run":
            dry = True
        elif a.startswith("--limit"):
            if "=" in a:
                limit = int(a.split("=")[1])
            else:
                i += 1
                limit = int(argv[i])
        else:
            pos.append(a)
        i += 1
    return pos, dry, limit


def main(ctx_dir, out_dir, dry, limit=0):
    os.makedirs(out_dir, exist_ok=True)
    names = [n for n in sorted(os.listdir(ctx_dir)) if re.match(r"^6\..*\.json$", n)]
    if limit:
        names = names[:limit]
    for name in names:
        ctx = json.load(open(os.path.join(ctx_dir, name), encoding="utf-8"))
        ir = mock_ir(ctx) if dry else live_ir(ctx)
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as f:
            json.dump(ir, f, ensure_ascii=False, indent=2)
        nm = len(ir.get("messages") or [])
        print(f"{ir['case_id']:<10} steps={len(ir.get('steps') or []):>2} msgs={nm:>2}")
    print(("DRY-RUN " if dry else "LIVE ") + f"cases={len(names)} provider={llm.PROVIDER} "
          f"model={llm.MODEL} temp={llm.TEMPERATURE} max_tokens={llm.MAX_TOKENS}")


if __name__ == "__main__":
    pos, dry, limit = parse_args(sys.argv[1:])
    main(pos[0], pos[1], dry, limit)
