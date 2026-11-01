import { defineConfig } from "@playwright/test";

const PY = "http://127.0.0.1:8010";
const UI = "http://localhost:3100";
const PYTHON = process.env.PYTHON_CMD ?? (process.platform === "win32" ? "py -3.12" : "python3");

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  use: { baseURL: UI, trace: "retain-on-failure" },
  webServer: [
    {
      command: `${PYTHON} ../scripts/serve.py --port 8010 --no-browser`,
      url: `${PY}/api/health`,
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: "npm run dev -- -p 3100",
      url: UI,
      reuseExistingServer: false,
      timeout: 120000,
      env: { PY_API_URL: PY },
    },
  ],
});
