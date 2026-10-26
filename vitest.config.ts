import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const env = loadEnv("test", process.cwd(), "");
const testDb = env.TEST_DATABASE_URL || "postgresql://mytime:mytime_local_dev@127.0.0.1:5544/mytime?schema=test";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` impide importar módulos de servidor en el navegador; en Node no aplica.
      "server-only": fileURLToPath(new URL("./tests/support/empty.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/support/global-setup.ts"],
    // Las pruebas de integración usan SIEMPRE el esquema de pruebas, nunca los datos reales.
    env: { DATABASE_URL: testDb, TEST_DATABASE_URL: testDb, JIRA_MODE: "disabled", MYTIME_TIMEZONE: "Europe/Madrid" },
    // Comparten base de datos: sin paralelismo entre archivos.
    fileParallelism: false,
  },
});
