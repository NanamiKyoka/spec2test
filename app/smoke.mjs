import { chromium } from "playwright";

const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:8000";
const channel = process.env.PW_CHANNEL || (process.platform === "win32" ? "msedge" : undefined);

const routes = [
  ["#/data", ["Spec2Test", "运行历史"]],
  ["#/chat", ["新建对话"]],
  ["#/api", ["通道"]],
  ["#/case?case=6.7.1.3", ["条款依据", "智能解读"]],
  ["#/case?case=6.7.1.12", ["弃权"]],
  ["#/about", ["Spec2Test"]],
];

const browser = await chromium.launch({
  channel,
  headless: true,
  args: ["--no-proxy-server", "--proxy-bypass-list=*"],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
const external = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("PAGEERROR " + String(e)));
page.on("request", (r) => {
  const u = r.url();
  if (!u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("about:")) external.push(u);
});

let pass = 0;
const failures = [];
for (const [hash, expects] of routes) {
  await page.goto(BASE + "/web/" + hash, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(900);
  const body = (await page.textContent("body")) || "";
  const missing = expects.filter((t) => !body.includes(t));
  if (missing.length === 0) {
    pass++;
    console.log("PASS " + hash);
  } else {
    failures.push({ hash, missing });
    console.log("FAIL " + hash + " 缺少: " + missing.join(", "));
  }
}

await browser.close();
const hardErrors = errors.filter((e) => !e.includes("404"));
console.log(`\n路由 ${pass}/${routes.length}`);
console.log(`外部请求 ${external.length}${external.length ? "：" + [...new Set(external)].slice(0, 5).join(", ") : ""}`);
console.log(`console error ${hardErrors.length}${hardErrors.length ? "：" + hardErrors.slice(0, 3).join(" | ") : ""}`);

if (failures.length || external.length || hardErrors.length) process.exit(1);
