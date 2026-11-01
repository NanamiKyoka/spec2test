import { expect, test } from "@playwright/test";

test("卡片夹具：拒收/弃权/审批/运行四态", async ({ page }) => {
  await page.goto("/dev/cards");
  await expect(page.getByTestId("cards")).toBeVisible();
  await expect(page.getByTestId("run")).toContainText("6.7.1.99");
  await expect(page.getByTestId("approval")).toContainText("需要人工确认");
  await expect(page.getByTestId("approval")).toContainText("SIB1");
  await expect(page.getByTestId("result-reject")).toContainText("已拒收");
  await expect(page.getByTestId("result-reject")).toContainText("R2 · messages[SIB1].ies[0].name");
  await expect(page.getByTestId("result-abstain")).toContainText("弃权");
});
