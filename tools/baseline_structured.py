"""结构化基线：与产品同模型/同温度，但只给一句 prompt，无符号表、无候选、无校验。

输出 data/out_baseline_struct/<case>.json：
  {case_id, text, stop_reason, backend_model, steps, messages, calls}
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import llm

PROMPT = "根据以下测试目的和条款，写出该测试用例的步骤与关键信令字段。只输出 JSON。"
SYSTEM = (
    "你是 3GPP 测试规范助手。只输出 JSON，不要解释。格式："
    '{"steps":[{"st":1,"actor":"SS","direction":"S->U","message":"消息名或空串"}],'
    '"messages":[{"message":"SIB1","ies":[{"name":"字段名","value":"取值"}]}]}。'
    "不要依赖任何外部工具；只根据给定输入作答。"
)


def mock_struct(ctx):
    return {
        "steps": [{"st": 1, "actor": "SS", "direction": "S->U", "message": "SIB1"}],
        "messages": [{"message": "SIB1", "ies": [{"name": "cellBarred", "value": "notBarred"}]}],
    }


def live_struct(ctx):
    payload = {k: ctx[k] for k in ("test_purpose", "conformance_requirements", "pre_test_conditions")}
    user = PROMPT + "\n\n" + json.dumps(payload, ensure_ascii=False)
    text, stop = llm.complete([{"role": "user", "content": user}], system=SYSTEM)
    data = llm.extract_json(text) or {}
    return text, stop, data


def normalize(data):
    steps = data.get("steps") if isinstance(data, dict) else None
    messages = data.get("messages") if isinstance(data, dict) else None
    return (steps if isinstance(steps, list) else [],
            messages if isinstance(messages, list) else [])


def parse_args(argv):
    pos, dry, case, limit, i = [], False, None, 0, 0
    while i < len(argv):
        a = argv[i]
        if a == "--dry-run":
            dry = True
        elif a == "--case":
            i += 1
            case = argv[i]
        elif a.startswith("--limit"):
            if "=" in a:
                limit = int(a.split("=")[1])
            else:
                i += 1
                limit = int(argv[i])
        else:
            pos.append(a)
        i += 1
    return pos, dry, case, limit


def main(ctx_dir, out_dir, dry=False, case=None, limit=0):
    os.makedirs(out_dir, exist_ok=True)
    names = [n for n in sorted(os.listdir(ctx_dir)) if re.match(r"^6\..*\.json$", n)]
    if case:
        names = [n for n in names if n[:-5] == case]
    if limit:
        names = names[:limit]
    empty = 0
    for name in names:
        ctx = json.load(open(os.path.join(ctx_dir, name), encoding="utf-8"))
        if dry:
            text, stop, data, calls = "", "mock", mock_struct(ctx), 0
        else:
            try:
                text, stop, data = live_struct(ctx)
            except Exception as e:
                text, stop, data = "", "call_failed:%s" % type(e).__name__, {}
            calls = 1
        steps, messages = normalize(data)
        if not steps and not messages:
            empty += 1
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as f:
            json.dump({"case_id": ctx.get("case_id", name[:-5]), "text": text,
                       "stop_reason": stop, "backend_model": llm.LAST_MODEL,
                       "steps": steps, "messages": messages, "calls": calls},
                      f, ensure_ascii=False, indent=2)
    print(("DRY-RUN " if dry else "LIVE ") + "baseline_struct=%d empty=%d provider=%s model=%s"
          % (len(names), empty, llm.PROVIDER, llm.MODEL))


if __name__ == "__main__":
    pos, dry, case, limit = parse_args(sys.argv[1:])
    main(pos[0], pos[1], dry, case, limit)
