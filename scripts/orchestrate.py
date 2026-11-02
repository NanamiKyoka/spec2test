"""模型自由编排：由模型决定调用哪个阶段工具、顺序与是否修复。

与 run_one.py 的固定六阶段管线构成消融对照（见 scripts/ab_orchestrate.py）。
逐行输出 JSON 事件：agent（每次工具调用）与 score（最终指标）。

用法：
    py -3.12 scripts/orchestrate.py 6.7.1.3 --max-steps 8
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TOOLS = os.path.join(ROOT, "tools")
sys.path.insert(0, TOOLS)
import llm
import score
import stage_tools
import validate as validate_mod

GOLD_IE = os.path.join(ROOT, "data", "ir", "ie")
SYMBOLS = os.path.join(ROOT, "data", "symbols", "rrc_symbols.json")

SYSTEM = (
    "你是 3GPP 测试意图编译智能体。可用工具（用 JSON 调用，一次只调一个）：\n"
    "- prepare_case(case)：读取用例切片与上下文\n"
    "- list_candidates(case)：抽取候选消息\n"
    "- generate_steps(case)：生成步骤序列\n"
    "- generate_ies(case, messages?)：为候选消息生成 IE 字段\n"
    "- validate_intent(strictness?)：校验当前产物（R1/R2/R3）；strictness 取 strict|r1_only|skip_lte_r2\n"
    "- repair_intent(rounds?)：按违规清单定向修复当前产物\n"
    "- export_intent()：导出当前产物\n"
    "只输出 JSON：{\"tool\":\"工具名\",\"args\":{...}}；任务完成时输出 {\"final\":true}。\n"
    "规则：先取候选消息；候选为空直接 final（弃权，不调用生成）；\n"
    "candidates 非空时，state.missing 必须为空才能 final：缺 steps 就先生成步骤，缺 ies 就生成字段；\n"
    "校验出违规再调用 repair_intent；没有违规不要重复校验或修复。"
)

MODEL_TOOLS = {"generate_steps", "generate_ies", "repair_intent"}
CASE_TOOLS = {"prepare_case", "list_candidates", "generate_steps", "generate_ies"}


def emit(stage, status, summary, detail=None):
    print(json.dumps({"stage": stage, "status": status, "summary": summary,
                      "detail": detail or {}}, ensure_ascii=False), flush=True)


class State:
    def __init__(self, case):
        self.case = case
        self.steps = []
        self.messages = []
        self.tp = []
        self.calls = 0
        self.trace = []
        self.candidates = []

    def ir(self):
        return {"case_id": self.case, "tp": self.tp,
                "steps": self.steps, "messages": self.messages}

    def snapshot(self, budget_left):
        syms = stage_tools._symbols()
        ir = self.ir()
        viol = validate_mod.validate(ir, syms) if (self.steps or self.messages) else []
        missing = []
        if self.candidates and not self.steps:
            missing.append("steps")
        if self.candidates and not self.messages:
            missing.append("ies")
        return {"case": self.case, "budget_left": budget_left,
                "candidates": self.candidates,
                "steps": len(self.steps), "messages": len(self.messages),
                "missing": missing,
                "violations": [{"rule": v.get("rule"), "detail": v.get("detail")}
                               for v in viol][:6],
                "last": self.trace[-1] if self.trace else ""}


def _inject(state, name, args):
    """校验/修复/导出针对当前产物，模型不必回传整份 IR。"""
    args = dict(args)
    if name in ("validate_intent", "repair_intent", "export_intent"):
        if not state.steps and not state.messages:
            return None, "还没有产物：先生成步骤或 IE"
        args.setdefault("ir", state.ir())
    if name == "generate_ies" and state.steps:
        args.setdefault("steps", state.steps)
    return args, ""


def _apply(state, name, data):
    if name == "generate_steps":
        steps = data.get("steps") or []
        if steps:
            state.steps = steps
            from ir import parse_test_purpose as parse_tp
            ctx = stage_tools._ctx(state.case)
            state.tp = parse_tp(ctx.get("test_purpose", ""))
        return "步骤 %d 条" % len(state.steps)
    if name == "generate_ies":
        msgs = data.get("messages") or []
        if msgs:
            state.messages = msgs
        return "消息 %d 条" % len(state.messages)
    if name == "repair_intent":
        state.messages = (data.get("ir") or {}).get("messages") or state.messages
        state.steps = (data.get("ir") or {}).get("steps") or state.steps
        return "修复 %d 轮，违规 %s → %s" % (data.get("repairs"), data.get("before"),
                                             data.get("after"))
    if name == "validate_intent":
        return "违规 %d 条" % len(data.get("violations") or [])
    if name == "list_candidates":
        return "候选 %s" % (", ".join(data.get("candidates") or []) or "无")
    if name == "prepare_case":
        return "候选 %s" % (", ".join(data.get("candidates") or []) or "无")
    return "ok"


def final_blocked(state):
    """有候选却缺步骤/字段时，不允许宣布完成。"""
    return bool(state.candidates) and not (state.steps and state.messages)


def score_state(state):
    ir = state.ir()
    gen = [score.norm_ie(i.get("name", ""))
           for m in state.messages for i in (m.get("ies") or [])]
    gold_path = os.path.join(GOLD_IE, state.case + ".json")
    gold = score.gold_leaf_ies(gold_path) if os.path.exists(gold_path) else []
    viol = validate_mod.validate(ir, stage_tools._symbols()) if (state.steps or state.messages) else []
    l3 = None if not state.messages else score.recall(gen, gold)
    if not state.steps and not state.messages:
        verdict = "abstained"
    elif not state.messages or not state.steps:
        verdict = "incomplete"      # 缺步骤或缺字段：不能算通过
    else:
        verdict = "reject" if viol else "pass"
    return {"L1": score.l1_ok(ir), "L3": l3, "gold_ies": len(gold), "gen_ies": len(gen),
            "violations": viol, "verdict": verdict, "calls": state.calls}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("case")
    ap.add_argument("--max-steps", type=int, default=8, help="工具调用预算")
    a = ap.parse_args()

    t0 = time.time()
    state = State(a.case)
    try:
        state.candidates = stage_tools.call(
            "list_candidates", {"case": a.case})["data"].get("candidates") or []
    except Exception:
        state.candidates = []
    used = 0
    bad_json = 0
    final_rejected = 0
    while used < a.max_steps:
        snap = state.snapshot(a.max_steps - used)
        text, stop = llm.complete(
            [{"role": "user", "content": json.dumps(snap, ensure_ascii=False)}],
            system=SYSTEM)
        decision = llm.extract_json(text)
        if not isinstance(decision, dict):
            bad_json += 1
            if bad_json >= 2:
                emit("agent", "failed", "模型连续输出非 JSON，终止编排")
                break
            continue
        if decision.get("final"):
            # 完成检查：有候选却缺步骤或字段时，不能算完成
            if final_blocked(state):
                final_rejected += 1
                if final_rejected >= 2:
                    emit("agent", "failed", "完成检查两次未通过：产物不完整，终止编排")
                    break
                emit("agent", "skipped", "完成检查未通过：还需生成步骤或 IE 字段")
                continue
            emit("agent", "ok", "模型判定完成，停止编排")
            break
        name = decision.get("tool")
        args = decision.get("args") if isinstance(decision.get("args"), dict) else {}
        if name not in stage_tools.TOOLS or stage_tools.TOOLS[name]["eval_only"]:
            emit("agent", "failed", "未知或不可用工具：%s" % name)
            bad_json += 1
            if bad_json >= 2:
                break
            continue

        args, err = _inject(state, name, args)
        if err:
            state.trace.append("%s -> %s" % (name, err))
            emit("agent", "skipped", err, {"tool": name})
            continue
        if name in CASE_TOOLS:
            args.setdefault("case", a.case)
        t1 = time.time()
        used += 1
        if name in MODEL_TOOLS:
            state.calls += 1
            if name == "generate_ies" and isinstance(args.get("messages"), list):
                state.calls += max(0, len(args["messages"]) - 1)
        try:
            res = stage_tools.call(name, args)
        except stage_tools.ToolError as e:
            state.trace.append("%s -> %s" % (name, e))
            emit("agent", "failed", "%s 失败：%s" % (name, e), {"tool": name})
            continue
        except Exception as e:
            state.trace.append("%s -> %s" % (name, e))
            emit("agent", "failed", "%s 异常：%s" % (name, str(e)[:120]), {"tool": name})
            continue

        note = _apply(state, name, res.get("data") or {})
        state.trace.append("%s -> %s" % (name, note))
        emit("agent", "ok", "%s：%s" % (name, note),
             {"tool": name, "ms": int((time.time() - t1) * 1000), "result": note})

    final = score_state(state)
    status = {"pass": "ok", "reject": "rejected",
              "abstained": "skipped", "incomplete": "failed"}[final["verdict"]]
    emit("score", status,
         "L1=%.3f · L3=%s · 违规 %d · 工具调用 %d"
         % (final["L1"], "—" if final["L3"] is None else "%.3f" % final["L3"],
            len(final["violations"]), used),
         dict(final, seconds=round(time.time() - t0, 1), tool_calls=used))
    return 0


if __name__ == "__main__":
    sys.exit(main())
