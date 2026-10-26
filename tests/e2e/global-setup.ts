import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

/** Migra y vacía el esquema de pruebas antes de la batería E2E. */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://mytime:mytime_local_dev@127.0.0.1:5544/mytime?schema=test";
  if (!url.includes("schema=test")) throw new Error("Las pruebas E2E solo pueden usar el esquema de pruebas.");
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: "pipe" });
  const db = new PrismaClient({ datasources: { db: { url } } });
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'test' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"test"."${t.tablename}"`).join(", ")} CASCADE`);
  await db.$disconnect();
}
