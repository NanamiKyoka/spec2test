"""第一段：只生成步骤（不含 IE）。目标是 L1=1.000。"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import llm

SYSTEM = (
    "你是 3GPP 测试规范助手。只输出 JSON，不要解释。格式："
    '{"steps":[{"st":1,"actor":"SS","direction":"S->U","message":"消息名或空串","tp_ref":[1]}]}。'
    "每条步骤必须含 st(整数)、actor(SS 或 UE)、direction(S->U 或 U->S)、message(字符串，未知则空串)。"
)

VALID_ACTOR = ("SS", "UE")
VALID_DIR = ("S->U", "U->S")


def _prompt(ctx):
    return json.dumps({k: ctx[k] for k in
                       ("test_purpose", "conformance_requirements", "pre_test_conditions")},
                      ensure_ascii=False)


def _defects(steps):
    bad = []
    for i, s in enumerate(steps):
        if not isinstance(s, dict):
            bad.append(f"steps[{i}] 不是对象")
            continue
        if not isinstance(s.get("st"), int):
            bad.append(f"steps[{i}].st 缺失或非整数")
        if s.get("actor") not in VALID_ACTOR:
            bad.append(f"steps[{i}].actor 必须是 SS 或 UE")
        if s.get("direction") not in VALID_DIR:
            bad.append(f"steps[{i}].direction 必须是 S->U 或 U->S")
        if not isinstance(s.get("message"), str):
            bad.append(f"steps[{i}].message 必须是字符串")
    return bad


def generate_steps(ctx, repairs=1):
    text, stop = llm.complete([{"role": "user", "content": _prompt(ctx)}], system=SYSTEM)
    ir = llm.extract_json(text)
    steps = (ir or {}).get("steps") if isinstance(ir, dict) else None
    used = 0
    while True:
        if not isinstance(steps, list) or not steps:
            return [], {"error": f"parse_failed(stop={stop},len={len(text)})", "repairs": used}
        bad = _defects(steps)
        if not bad or used >= repairs:
            return steps, {"stop": stop, "defects": bad, "repairs": used}
        used += 1
        fix = ("你上一条输出存在以下问题，请仅输出修正后的完整 JSON：\n- " + "\n- ".join(bad[:12])
               + "\n\n原始输出：\n" + text[:4000])
        text, stop = llm.complete([{"role": "user", "content": _prompt(ctx)},
                                   {"role": "assistant", "content": text[:4000]},
                                   {"role": "user", "content": fix}], system=SYSTEM)
        ir = llm.extract_json(text)
        steps = (ir or {}).get("steps") if isinstance(ir, dict) else None


if __name__ == "__main__":
    print("gen_steps 作为库使用：from gen_steps import generate_steps")
