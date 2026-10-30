import { chromium } from "playwright";

const BASE = "http://127.0.0.1:8000/web/";
const routes = [
  ["#/data", "数据面板"],
  ["#/chat", "对话视图待实现"],
  ["#/api", "API 管理待实现"],
  ["#/about", "五分钟了解"],
];

const external = [];
const errors = [];
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("request", (r) => {
  const u = r.url();
  if (!u.startsWith("http://127.0.0.1:8000")) external.push(u);
});

let pass = 0;
for (const [hash, text] of routes) {
  await page.goto(BASE + hash, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(600);
  const body = await page.textContent("body");
  const ok = (body || "").includes(text);
  console.log(`${ok ? "PASS" : "FAIL"} ${hash} 期望含「${text}」`);
  if (ok) pass++;
  if ((body || "").includes("undefined")) console.log("  ⚠ 页面出现 undefined");
}
await page.screenshot({ path: "smoke-about.png", fullPage: false });
await browser.close();

console.log(`\n路由通过 ${pass}/${routes.length}`);
console.log(`外部请求 ${external.length} 条${external.length ? "：" + [...new Set(external)].slice(0, 5).join(", ") : ""}`);
console.log(`console error ${errors.length} 条${errors.length ? "：" + errors.slice(0, 3).join(" | ") : ""}`);
