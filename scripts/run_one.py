"""跑单个用例的完整链路，逐阶段向 stdout 输出 JSON Lines。

用法：
    python scripts/run_one.py 6.7.1.3            # 真实调用（需要可用模型通道）
    python scripts/run_one.py 6.7.1.3 --dry-run  # 不调模型，用桩 IR 验证链路
    python scripts/run_one.py 6.7.1.3 --no-write # 不写 data/out

输出示例（每行一个 JSON）：
    {"stage":"ingest","status":"ok","summary":"...","detail":{...}}
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

SYMBOLS = os.path.join(ROOT, "data", "symbols", "rrc_symbols.json")
BENCH = os.path.join(ROOT, "data", "benchmark", "v0")
CTX = os.path.join(ROOT, "data", "ctx")
OUT = os.path.join(ROOT, "data", "out")
OUT_REJECTED = os.path.join(ROOT, "data", "out_rejected")
GOLD_IE = os.path.join(ROOT, "data", "ir", "ie")


def emit(stage, status, summary, detail=None):
    print(json.dumps({"stage": stage, "status": status,
                      "summary": summary, "detail": detail or {}},
                     ensure_ascii=False), flush=True)


def load(path):
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def finish(case, ir, a, sym_path):
    """校验 → 判定 → 写盘 → 评分。拒收时写 out_rejected，绝不覆盖 data/out。"""
    viol = []
    try:
        import validate
        syms = load(sym_path) if sym_path else {}
        viol = validate.validate(ir, syms)
        emit("validate", "ok" if not viol else "rejected",
             "无违规" if not viol else "发现 %d 条违规（将拒收）" % len(viol),
             {"violations": viol})
    except Exception as e:
        emit("validate", "failed", "校验异常：%s" % e)

    verdict = "reject" if viol else "pass"

    if not a.no_write:
        target = OUT_REJECTED if verdict == "reject" else OUT
        os.makedirs(target, exist_ok=True)
        ir_out = dict(ir)
        ir_out["verdict"] = verdict
        ir_out["violations"] = viol
        with open(os.path.join(target, case + ".json"), "w", encoding="utf-8") as f:
            json.dump(ir_out, f, ensure_ascii=False, indent=2)
        if verdict == "reject":
            emit("verdict", "rejected", "已拒收，未写入结果",
                 {"written_to": "data/out_rejected/%s.json" % case})
        else:
            emit("verdict", "pass", "通过，产物已写入结果",
                 {"written_to": "data/out/%s.json" % case})

    try:
        import score
        l1 = score.l1_ok(ir)
        gold_path = os.path.join(GOLD_IE, case + ".json")
        gold = score.gold_leaf_ies(gold_path) if os.path.exists(gold_path) else []
        gen = []
        for m in ir.get("messages") or []:
            for it in m.get("ies") or []:
                gen.append(score.norm_ie(it.get("name", "")))
        l3 = score.recall(gen, gold)
        head = "已拒收 · L1=%.3f · L3=%s" if verdict == "reject" else "L1=%.3f · L3=%s"
        emit("score", "ok" if verdict == "pass" else "rejected",
             head % (l1, "—" if l3 is None else "%.3f" % l3),
             {"L1": l1, "L3": l3, "gold_ies": len(gold), "gen_ies": len(gen),
              "violations": viol, "verdict": verdict})
    except Exception as e:
        emit("score", "failed", "评分异常：%s" % e)
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("case")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-write", action="store_true")
    ap.add_argument("--force-write", action="store_true",
                    help="dry-run 默认不写盘；需要覆盖真实结果时显式指定")
    ap.add_argument("--revalidate", action="store_true",
                    help="不调用模型：读现有 IR 重新校验并判定 verdict")
    ap.add_argument("--ir-file", default="", help="配合 --revalidate，指定 IR 文件路径")
    a = ap.parse_args()
    case = a.case
    if a.dry_run and not a.force_write:
        a.no_write = True
    sym_path = SYMBOLS if os.path.exists(SYMBOLS) else None

    if a.revalidate:
        src = a.ir_file or os.path.join(OUT, case + ".json")
        ir = load(src)
        if not ir:
            emit("ingest", "failed", "找不到 IR：%s" % src)
            return 1
        emit("ingest", "ok", "从已有产物加载 IR：%s" % src,
             {"steps": len(ir.get("steps") or []), "messages": len(ir.get("messages") or [])})
        emit("context", "skipped", "revalidate 模式：跳过")
        emit("candidates", "skipped", "revalidate 模式：跳过")
        emit("generate", "skipped", "revalidate 模式：未调用模型")
        return finish(case, ir, a, sym_path)

    # 1) ingest
    bench = load(os.path.join(BENCH, case + ".json"))
    if bench:
        ins = bench.get("inputs", {})
        emit("ingest", "ok", "读取规范用例：%s" % (bench.get("title", "")[:60]),
             {"sections": {k: len(v or "") for k, v in ins.items()},
              "answers": {k: len(v or "") for k, v in bench.get("answers", {}).items()}})
    else:
        emit("ingest", "failed", "找不到用例文件 data/benchmark/v0/%s.json" % case)
        emit("context", "skipped", "上游失败")
        emit("candidates", "skipped", "上游失败")
        emit("generate", "skipped", "上游失败")
        emit("validate", "skipped", "上游失败")
        emit("score", "skipped", "上游失败")
        return 1

    # 2) context
    ctx = load(os.path.join(CTX, case + ".json"))
    if ctx:
        emit("context", "ok", "上下文裁剪完成",
             {k: len(ctx.get(k) or "") for k in
              ("test_purpose", "conformance_requirements", "pre_test_conditions")})
    else:
        emit("context", "failed", "找不到 data/ctx/%s.json（先跑 build_ir.py）" % case)
        ctx = {"case_id": case, "test_purpose": "", "conformance_requirements": "",
               "pre_test_conditions": "", "title": bench.get("title", "")}

    # 3) candidates
    import gen_ie
    if not sym_path:
        emit("candidates", "failed", "找不到符号表 data/symbols/rrc_symbols.json")
        cand = []
    else:
        try:
            cand = gen_ie.candidate_messages(ctx, sym_path)
        except Exception as e:
            cand = []
            emit("candidates", "failed", "候选抽取异常：%s" % e)
            return 1
        if cand:
            emit("candidates", "ok", "抽取到 %d 个候选消息" % len(cand), {"candidates": cand})
        else:
            emit("candidates", "skipped",
                 "输入中没有消息/SIB 名 → 弃权（不发起模型调用）", {"candidates": []})

    # 4) generate
    ir = None
    if not cand:
        emit("generate", "skipped", "弃权：未调用模型", {"calls": 0})
        emit("validate", "skipped", "弃权：无产物可校验")
        emit("score", "skipped", "弃权：不计分（不是 0 分）")
        return 0

    t0 = time.time()
    try:
        if a.dry_run:
            import generate
            ir = generate.mock_ir(ctx)
            ir["status"] = "generated"
            emit("generate", "ok", "桩生成（dry-run，未调用模型）",
                 {"steps": len(ir.get("steps") or []), "calls": 0})
        else:
            import gen_steps
            steps, meta = gen_steps.generate_steps(ctx)
            ie = gen_ie.generate_all(ctx, steps, sym_path)
            ir = {"case_id": case, "steps": steps, "messages": ie["messages"],
                  "status": ie["status"], "reason": ie.get("reason", ""),
                  "_stage2": {"candidates": ie.get("candidates", []), "calls": ie.get("calls", 0)}}
            emit("generate", "ok", "生成完成",
                 {"steps": len(steps), "messages": len(ie["messages"]),
                  "calls": ie.get("calls", 0), "seconds": round(time.time() - t0, 2)})
    except Exception as e:
        emit("generate", "failed", "生成失败：%s" % e)
        emit("validate", "skipped", "上游失败")
        emit("score", "skipped", "上游失败")
        return 1

    # 5) validate → 6) score
    return finish(case, ir, a, sym_path)


if __name__ == "__main__":
    sys.exit(main())
