"""裸 prompt 对照组：同通道、同模型、同温度，一句话让模型直接写步骤。"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import llm

PROMPT = "根据以下测试目的和条款，写出该测试用例的测试步骤，每步标注消息名与方向（SS->UE 或 UE->SS）。"


def mock_text(ctx):
    return "步骤1：SS 发送系统消息；步骤2：UE 发起随机接入。"


def live_text(ctx):
    payload = {k: ctx[k] for k in ("test_purpose", "conformance_requirements", "pre_test_conditions")}
    user = PROMPT + chr(10) * 2 + json.dumps(payload, ensure_ascii=False)
    text, stop = llm.complete([{"role": "user", "content": user}])
    return text, stop


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
    errs = 0
    for name in names:
        ctx = json.load(open(os.path.join(ctx_dir, name), encoding="utf-8"))
        if dry:
            text, stop = mock_text(ctx), "mock"
        else:
            try:
                text, stop = live_text(ctx)
            except Exception as e:
                text, stop = "", f"call_failed:{type(e).__name__}"
            if not text:
                errs += 1
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as f:
            json.dump({"case_id": ctx["case_id"], "text": text, "stop_reason": stop,
                       "backend_model": llm.LAST_MODEL},
                      f, ensure_ascii=False, indent=2)
    print(("DRY-RUN " if dry else "LIVE ") + f"baseline={len(names)} empty={errs} "
          f"provider={llm.PROVIDER} model={llm.MODEL} temp={llm.TEMPERATURE} "
          f"max_tokens={llm.MAX_TOKENS}")


if __name__ == "__main__":
    pos, dry, limit = parse_args(sys.argv[1:])
    main(pos[0], pos[1], dry, limit)
