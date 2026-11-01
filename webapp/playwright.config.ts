import { defineConfig } from "@playwright/test";

const PY = "http://127.0.0.1:8010";
const UI = "http://localhost:3100";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  use: { baseURL: UI, trace: "retain-on-failure" },
  webServer: [
    {
      command: "py -3.12 ../scripts/serve.py --port 8010 --no-browser",
      url: `${PY}/api/health`,
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      command: "npm run dev -- -p 3100",
      url: UI,
      reuseExistingServer: true,
      timeout: 120000,
      env: { PY_API_URL: PY },
    },
  ],
});
