"""第二段：IE 生成。弃权判定在调用模型之前（ADR-0006）。"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import llm

SYSTEM = (
    "你是 3GPP RRC 信令内容助手。只输出 JSON，不要解释。"
    '格式：{"message":"<消息名>","derivation_path":"<模板来源>",'
    '"ies":[{"name":"<字段名>","value":"<取值>","condition":"<条件或空串>"}]}。'
    "字段名必须是该消息 ASN.1 里真实存在的字段；取值写具体值（如 10、true、Not present）。"
)
MAX_MSG = 12

SIB_RE = re.compile(r"\bSIB\s?(\d{1,2})\b")
RRC_RE = re.compile(
    r"\b(RRCSetupRequest|RRCSetupComplete|RRCSetup|RRCReconfigurationComplete|"
    r"RRCReconfiguration|RRCRelease|RRCReestablishment|RRCResumeRequest|RRCResumeComplete|"
    r"UECapabilityEnquiry|UECapabilityInformation|SecurityModeCommand|SecurityModeComplete|"
    r"SecurityModeFailure|Paging|SystemInformation|DLInformationTransfer|"
    r"ULInformationTransfer|CounterCheck|MeasurementReport|RRCSystemInfoRequest)\b"
)


def load_symbols(path):
    d = json.load(open(path, encoding="utf-8"))
    return d["messages"], set(d.get("global_identifiers", [])), set(d.get("all_defined_names", []))


def distinct_messages(steps):
    out, seen = [], set()
    for s in steps or []:
        m = re.sub(r"^nr\s*rrc\s*:\s*", "", (s.get("message") or "").strip(), flags=re.I)
        if m and m not in seen:
            seen.add(m)
            out.append(m)
    return out


def messages_from_inputs(ctx):
    """只读输入侧三个字段，抽取实际出现的消息/SIB 名，按首次出现排序去重。"""
    text = " ".join(str(ctx.get(k, "")) for k in
                    ("test_purpose", "conformance_requirements", "pre_test_conditions"))
    found = [(m.start(), f"SIB{int(m.group(1))}") for m in SIB_RE.finditer(text)]
    found += [(m.start(), m.group(1)) for m in RRC_RE.finditer(text)]
    out, seen = [], set()
    for _, name in sorted(found):
        if name not in seen:
            seen.add(name)
            out.append(name)
    return out


def candidate_messages(ctx, symbols_path):
    table, _, _ = load_symbols(symbols_path)
    return [m for m in messages_from_inputs(ctx)
            if m in table or re.fullmatch(r"SIB\d{1,2}", m)][:MAX_MSG]


def generate_ie(ctx, steps, message, symbols_path):
    msgs, gids, _ = load_symbols(symbols_path)
    skeleton = msgs.get(message, {}).get("fields", [])[:60]
    payload = {
        "test_purpose": ctx.get("test_purpose", "")[:1200],
        "message": message,
        "default_template_fields": skeleton,
        "steps_hint": [{"st": s.get("st"), "direction": s.get("direction"),
                        "message": s.get("message")} for s in (steps or [])][:15],
    }
    text, stop = llm.complete([{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
                              system=SYSTEM)
    ir = llm.extract_json(text)
    if not isinstance(ir, dict):
        return {"message": message, "ies": [], "_error": f"parse_failed(stop={stop})"}
    ies = [i for i in (ir.get("ies") or []) if isinstance(i, dict) and i.get("name")]
    for i in ies:
        i["name"] = str(i["name"]).strip()
        i["_known"] = (i["name"] in (msgs.get(message, {}).get("fields") or [])) or (i["name"] in gids)
    return {"message": message, "derivation_path": ir.get("derivation_path", ""),
            "ies": ies, "_stop": stop}


def generate_all(ctx, steps, symbols_path):
    """产品入口：候选为空则不调用模型，直接弃权。"""
    cand = candidate_messages(ctx, symbols_path)
    if not cand:
        return {"status": "abstained",
                "reason": "inputs contain no message/SIB names",
                "candidates": [], "messages": [], "calls": 0}
    msgs = [generate_ie(ctx, steps, m, symbols_path) for m in cand]
    return {"status": "generated", "candidates": cand, "messages": msgs, "calls": len(cand)}


if __name__ == "__main__":
    print("gen_ie 作为库使用：from gen_ie import generate_all")
