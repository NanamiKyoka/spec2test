import { beforeEach, describe, expect, it, vi } from "vitest";
import { getJob, getJobByCase, getLatestJob, resetJobs, setJob, subscribeJobs } from "../jobStore";

beforeEach(() => resetJobs());

describe("jobStore", () => {
  it("按 jobId 与用例双索引", () => {
    setJob("j1", { state: "running", log: [], case: "6.7.1.3" });
    expect(getJob("j1")?.state).toBe("running");
    expect(getJobByCase("6.7.1.3")?.state).toBe("running");
  });

  it("同用例新任务覆盖旧任务", () => {
    setJob("j1", { state: "done", log: [], case: "6.7.1.3" });
    setJob("j2", { state: "running", log: [], case: "6.7.1.3" });
    expect(getJobByCase("6.7.1.3")?.state).toBe("running");
    expect(getJob("j1")?.state).toBe("done");
  });

  it("订阅者在更新时收到通知", () => {
    const fn = vi.fn();
    const off = subscribeJobs(fn);
    setJob("j1", { state: "queued", log: [], case: "6.7.1.3" });
    expect(fn).toHaveBeenCalledTimes(1);
    off();
  });

  it("最新任务指向最后一次写入", () => {
    setJob("j1", { state: "done", log: [], case: "6.7.1.3" });
    setJob("j2", { state: "running", log: [], case: "6.7.1.10" });
    expect(getLatestJob()?.case).toBe("6.7.1.10");
  });
});
