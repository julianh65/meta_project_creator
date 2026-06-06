const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./apps/dashboard/e2e",
  timeout: 30000,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:4400",
    trace: "on-first-retry"
  },
  webServer: {
    command: "STARTUP_OS_ROOT=.tmp/e2e npm run dev:dashboard",
    url: "http://127.0.0.1:4400",
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
