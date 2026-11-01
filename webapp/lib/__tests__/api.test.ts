import { describe, expect, it } from "vitest";
import { ApiError, pollJob, type Job } from "../api";

describe("api 基础契约", () => {
  it("ApiError 保留状态码与错误码", () => {
    const e = new ApiError(409, "run_in_progress", "run_in_progress");
    expect(e.status).toBe(409);
    expect(e.code).toBe("run_in_progress");
  });

  it("pollJob 在终态停止并返回最后一次快照", async () => {
    const seq: Job[] = [
      { state: "running", log: [] },
      { state: "done", log: [], verdict: "pass" },
    ];
    let i = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => seq[Math.min(i++, seq.length - 1)],
    })) as unknown as typeof fetch;
    try {
      const ac = new AbortController();
      const job = await pollJob("j1", () => {}, ac.signal, 5000);
      expect(job.state).toBe("done");
      expect(job.verdict).toBe("pass");
    } finally {
      globalThis.fetch = orig;
    }
  });
});
