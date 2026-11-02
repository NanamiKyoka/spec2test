"""按 R1/R3 违规定向修正步骤（不增删步骤，只改 message 与 tp_ref）。

R2（字段）由 gen_ie 带反馈重修；这里补齐步骤层面的自诊断修复。
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import llm

SYSTEM = (
    "你是 3GPP 测试规范助手。只输出 JSON，不要解释。格式："
    '{"steps":[{"st":1,"actor":"SS","direction":"S->U","message":"消息名","tp_ref":[1]}]}。'
    "只允许修改 message 与 tp_ref 两个字段；不得增删步骤，不得改 st/actor/direction。"
    "message 必须是给定候选消息或符号表里的消息名；无法确定时保留空串。"
)

MAX_MESSAGES = 40


def _allowed(symbols_path):
    try:
        table = json.load(open(symbols_path, encoding="utf-8"))
    except Exception:
        return []
    names = list((table.get("messages") or {}).keys())
    names += list(table.get("known_uncovered") or [])[:20]
    return names[:MAX_MESSAGES]


def repair_steps(ctx, steps, violations, symbols_path, hint=""):
    """返回 (steps, meta)；无法安全修改时原样返回并给出 error。"""
    bad = [v for v in (violations or []) if v.get("rule") in ("R1", "R3")]
    if not bad or not steps:
        return steps, {"changed": 0}
    payload = {
        "test_purpose": (ctx.get("test_purpose") or "")[:1200],
        "steps": [{"st": s.get("st"), "actor": s.get("actor"), "direction": s.get("direction"),
                   "message": s.get("message"), "tp_ref": s.get("tp_ref")} for s in steps][:40],
        "violations": [{"rule": v.get("rule"), "path": v.get("path"), "detail": v.get("detail")}
                       for v in bad][:20],
        "allowed_messages": _allowed(symbols_path),
    }
    try:
        text, stop = llm.complete(
            [{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
            system=SYSTEM + ("\n\n修复时必须参考以下技能说明：\n" + hint if hint else ""))
    except Exception as e:
        return steps, {"error": "llm_failed: %s" % e, "changed": 0}
    ir = llm.extract_json(text)
    fixed = (ir or {}).get("steps") if isinstance(ir, dict) else None
    if not isinstance(fixed, list) or len(fixed) != len(steps):
        return steps, {"error": "bad_shape(stop=%s)" % stop, "changed": 0}

    out, changed = [], 0
    for old, new in zip(steps, fixed):
        if not isinstance(new, dict):
            out.append(old)
            continue
        merged = dict(old)
        msg = new.get("message")
        if isinstance(msg, str) and msg.strip() and msg.strip() != (old.get("message") or ""):
            merged["message"] = msg.strip()
            changed += 1
        ref = new.get("tp_ref")
        if isinstance(ref, list) and ref != (old.get("tp_ref") or []):
            merged["tp_ref"] = [int(x) for x in ref if str(x).isdigit()][:8]
            changed += 1
        # st/actor/direction 一律沿用原值，模型改不动
        out.append(merged)
    return out, {"changed": changed, "violations": len(bad)}


if __name__ == "__main__":
    print("repair_steps 作为库使用：from repair_steps import repair_steps")
