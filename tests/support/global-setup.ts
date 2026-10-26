import { execSync } from "node:child_process";
import { loadEnv } from "vite";

/** Aplica las migraciones al esquema de pruebas antes de ejecutar la batería. */
export default function setup() {
  const env = loadEnv("test", process.cwd(), "");
  const url = env.TEST_DATABASE_URL || "postgresql://mytime:mytime_local_dev@127.0.0.1:5544/mytime?schema=test";
  if (!/schema=test/.test(url)) throw new Error("TEST_DATABASE_URL debe apuntar a un esquema de pruebas (schema=test).");
  try {
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: "pipe" });
  } catch (e) {
    console.warn("[tests] No se pudo migrar la base de datos de pruebas; las pruebas de integración fallarán.", (e as Error).message.slice(0, 200));
  }
}
