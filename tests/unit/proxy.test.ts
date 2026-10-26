import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";

const SECRET = "s".repeat(40);

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return (await import("@/proxy")).proxy;
}
const req = (path: string, host = "localhost:3100", cookie?: string) =>
  new NextRequest(`http://${host}${path}`, { headers: { host, ...(cookie ? { cookie } : {}) } });

afterEach(() => vi.unstubAllEnvs());

describe("proxy: hosts y acceso", () => {
  it("en local y sin contraseña deja pasar; rechaza hosts desconocidos", async () => {
    const proxy = await load({ MYTIME_PASSWORD: "", MYTIME_SESSION_SECRET: "" });
    expect((await proxy(req("/"))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(req("/", "evil.example"))).status).toBe(403);
  });

  it("fuera de localhost exige configurar la contraseña", async () => {
    const proxy = await load({ MYTIME_ALLOWED_HOSTS: "mytime.example.com", MYTIME_PASSWORD: "", MYTIME_SESSION_SECRET: "" });
    expect((await proxy(req("/", "mytime.example.com"))).status).toBe(503);
  });

  it("con contraseña: redirige páginas, protege la API y deja el cron con su propio secreto", async () => {
    const proxy = await load({ MYTIME_ALLOWED_HOSTS: "mytime.example.com", MYTIME_PASSWORD: "clave", MYTIME_SESSION_SECRET: SECRET });
    const page = await proxy(req("/horas", "mytime.example.com"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/acceso?desde=%2Fhoras");
    expect((await proxy(req("/api/export", "mytime.example.com"))).status).toBe(401);
    expect((await proxy(req("/api/cron/reminders", "mytime.example.com"))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(req("/acceso", "mytime.example.com"))).headers.get("x-middleware-next")).toBe("1");
    const token = await createSessionToken(SECRET);
    expect((await proxy(req("/horas", "mytime.example.com", `${SESSION_COOKIE}=${token}`))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(req("/horas", "mytime.example.com", `${SESSION_COOKIE}=1.falsa`))).status).toBe(307);
  });
});

describe("proxy en Vercel", () => {
  it("acepta automáticamente el dominio de producción del proyecto", async () => {
    const proxy = await load({ MYTIME_ALLOWED_HOSTS: "", VERCEL_PROJECT_PRODUCTION_URL: "mytime-abc.vercel.app", MYTIME_PASSWORD: "clave", MYTIME_SESSION_SECRET: SECRET });
    expect((await proxy(req("/acceso", "mytime-abc.vercel.app"))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(req("/acceso", "otro.vercel.app"))).status).toBe(403);
  });
});
