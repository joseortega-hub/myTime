import { defineConfig, devices } from "@playwright/test";

/**
 * Pruebas E2E sobre la build de producción, con la base de datos de PRUEBAS
 * (esquema "test"), en un puerto distinto al de desarrollo.
 */
const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgresql://mytime:mytime_local_dev@127.0.0.1:5544/mytime?schema=test";
const PORT = 3101;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next build && npx next start -H 127.0.0.1 -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: { DATABASE_URL: TEST_DB, DIRECT_URL: TEST_DB, JIRA_MODE: "disabled", MYTIME_TIMEZONE: "Europe/Madrid", NEXT_TELEMETRY_DISABLED: "1" },
  },
});
