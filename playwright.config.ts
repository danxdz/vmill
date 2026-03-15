import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 8099);
const BASE_URL = process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}`;
const DB_PATH = process.env.E2E_DB_PATH || path.join(process.cwd(), ".tmp", "vmill-e2e.db");

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  globalSetup: "./tests/e2e/global-setup.ts",
  webServer: {
    command: "python3 vmill_server.py",
    url: `${BASE_URL}/api/status`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      PORT: String(PORT),
      VMILL_DB_PATH: DB_PATH,
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
