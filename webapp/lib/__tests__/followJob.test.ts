import { afterEach, describe, expect, it, vi } from "vitest";
import { followJob } from "../followJob";
import { resetJobs } from "../jobStore";

afterEach(() => {
  vi.unstubAllGlobals();
  resetJobs();
});

describe("followJob", () => {
  it("无 EventSource 时回退 sseOk=false", async () => {
    const r = await followJob("j1", "6.7.1.3", new AbortController().signal);
    expect(r.sseOk).toBe(false);
    expect(r.stoppedAtApproval).toBe(false);
  });

  it("已中止的信号不再建连接", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await followJob("j1", "6.7.1.3", ac.signal);
    expect(r.sseOk).toBe(false);
  });

  it("stopAtApproval 在 awaiting_approval 处提前返回", async () => {
    class FakeES {
      onmessage: ((ev: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      close() {}
      constructor(public url: string) {
        queueMicrotask(() =>
          this.onmessage?.({
            data: JSON.stringify({ state: "awaiting_approval", log: [], approval: { status: "pending" } }),
          })
        );
      }
    }
    vi.stubGlobal("EventSource", FakeES as unknown as typeof EventSource);
    const r = await followJob("j1", "6.7.1.3", new AbortController().signal, true);
    expect(r.sseOk).toBe(true);
    expect(r.stoppedAtApproval).toBe(true);
    expect(r.job.state).toBe("awaiting_approval");
  });
});
