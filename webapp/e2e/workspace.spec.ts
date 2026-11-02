import { expect, test } from "@playwright/test";

test("工作台渲染对话与状态栏", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Spec2Test")).toBeVisible();
  await expect(page.locator('[data-testid="copilot-chat-textarea"]')).toBeVisible();
});

test("五个视图路由可达", async ({ page }) => {
  const routes: [string, string][] = [
    ["/data", "数据与评测"],
    ["/eval", "数据与评测"],
    ["/about", "项目说明"],
  ];
  for (const [path, text] of routes) {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator("body")).toContainText(text);
  }

  const res = await page.goto("/case/6.7.1.3");
  expect(res?.status()).toBe(200);
  await expect(page.getByText(/正在读取用例/)).toHaveCount(0);
  await expect(page.locator("body")).toContainText("6.7.1.3");
});

test("输入框「+」菜单可设置运行参数", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="copilot-chat-textarea"]').waitFor();
  await page.getByRole("button", { name: "运行参数" }).click();
  await expect(page.getByText("生成范围")).toBeVisible();
  await expect(page.getByRole("button", { name: /^MCP 连接器/ })).toBeVisible();
  await page.getByRole("button", { name: "只生成步骤" }).click();
  await expect(page.getByRole("button", { name: "移除 只生成步骤" })).toBeVisible();
  await page.getByRole("button", { name: "移除 只生成步骤" }).click();
  await expect(page.getByRole("button", { name: "移除 只生成步骤" })).toHaveCount(0);

  await expect(page.getByText("编排方式")).toBeVisible();
  await page.getByRole("button", { name: "模型自选（工具编排）" }).click();
  await expect(page.getByRole("button", { name: /移除 模型自选/ })).toBeVisible();
  await page.getByRole("button", { name: /移除 模型自选/ }).click();
  await expect(page.getByRole("button", { name: /移除 模型自选/ })).toHaveCount(0);
});

test("技能与连接器走子栏选择并显示为 chip", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="copilot-chat-textarea"]').waitFor();
  await page.getByRole("button", { name: "运行参数" }).click();

  await page.getByRole("button", { name: /^技能/ }).click();
  await page.getByRole("button", { name: "sib19-required-fields" }).click();
  await expect(page.getByRole("button", { name: "移除 技能 sib19-required-fields" })).toBeVisible();

  await page.getByRole("button", { name: "技能", exact: true }).click(); // 返回主栏
  await page.getByRole("button", { name: /^MCP 连接器/ }).click();
  await page.getByRole("button", { name: "全不选" }).click();
  await expect(page.getByRole("button", { name: /移除 MCP 0\// })).toBeVisible();

  await page.getByRole("button", { name: "全选" }).click();
  await expect(page.getByRole("button", { name: /移除 MCP/ })).toHaveCount(0);
});

test("证据加载卡有进度条与计时", async ({ page }) => {
  await page.goto("/dev/cards");
  const card = page.getByTestId("loading");
  await expect(card).toBeVisible();
  await expect(card.getByText(/已等待 0s/)).toBeVisible();
  await expect(card.locator(".progress-indeterminate")).toBeVisible();
  await expect(card.getByText("已等待 1s")).toBeVisible({ timeout: 4000 });
});

test("用例面板以右侧浮窗打开并按 Esc 关闭", async ({ page }) => {
  await page.goto("/data");
  await page.getByRole("button", { name: "拆解 →" }).first().click();

  const dialog = page.getByRole("dialog", { name: /用例面板/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("用例面板")).toBeVisible();
  await expect(page).toHaveURL(/\/data$/);          // 不跳页面

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0, { timeout: 3000 });
});

test("旧 hash 链接重定向到新路由", async ({ page }) => {
  await page.goto("/#/case?case=6.7.1.3");
  await expect(page).toHaveURL(/\/case\/6\.7\.1\.3/);
});

test("对话里跑过的任务会进入数据页", async ({ page }) => {
  await page.goto("/");
  const jobId = await page.evaluate(async () => {
    const r = await fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ case: "6.7.1.3", dry_run: true, instruction: "" }),
    });
    return (await r.json()).job_id as string;
  });
  expect(jobId).toBeTruthy();

  await page.waitForFunction(
    async (id) => {
      const r = await fetch(`/api/job/${id}`);
      const j = await r.json();
      return j.state === "done" || j.state === "failed";
    },
    jobId,
    { timeout: 60000 }
  );

  await page.goto("/data");
  await expect(page.locator("table")).toContainText("6.7.1.3");
  await expect(page.locator("table")).toContainText(/通过|已拒收|弃权|失败/);
});

test("跨进程 POST 不被 Origin 拦截", async ({ page }) => {
  await page.goto("/");
  const status = await page.evaluate(async () => {
    const r = await fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ case: "evil", dry_run: true }),
    });
    return r.status;
  });
  expect(status).toBe(400);
});
