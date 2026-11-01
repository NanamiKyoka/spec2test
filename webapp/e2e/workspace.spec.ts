import { expect, test } from "@playwright/test";

test("工作台渲染对话与状态栏", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Spec2Test")).toBeVisible();
  await expect(page.locator('[data-testid="copilot-chat-textarea"]')).toBeVisible();
});

test("五个视图路由可达", async ({ page }) => {
  const routes: [string, string][] = [
    ["/data", "数据面板"],
    ["/eval", "评测总览"],
    ["/about", "演示步骤（5 分钟）"],
    ["/case/6.7.1.3", "6.7.1.3"],
  ];
  for (const [path, text] of routes) {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator("body")).toContainText(text);
  }
});

test("旧 hash 链接重定向到新路由", async ({ page }) => {
  await page.goto("/#/case?case=6.7.1.3");
  await expect(page).toHaveURL(/\/case\/6\.7\.1\.3/);
});
