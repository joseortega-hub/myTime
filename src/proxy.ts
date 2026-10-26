import { NextResponse, type NextRequest } from "next/server";
import { authConfig, SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/**
 * 1. Solo se aceptan peticiones dirigidas a los hosts permitidos (por defecto,
 *    localhost): protege frente a DNS rebinding.
 * 2. Si hay contraseña configurada, exige sesión (excepto acceso, avisos y PWA).
 * 3. Fuera de localhost, sin contraseña configurada, la app no se sirve.
 */
const LOCAL = new Set(["localhost", "127.0.0.1", "::1"]);
const allowed = new Set(
  [
    process.env.MYTIME_ALLOWED_HOSTS ?? "localhost,127.0.0.1",
    // En Vercel, el dominio de producción del propio proyecto (variable de sistema).
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "",
  ]
    .join(",")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);
const PUBLIC_PATHS = [/^\/acceso$/, /^\/api\/cron\//, /^\/sw\.js$/, /^\/manifest\.webmanifest$/, /^\/icon\.svg$/];

export async function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase().replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (!allowed.has(host) && !LOCAL.has(host)) {
    return new NextResponse("Host no permitido", { status: 403 });
  }

  const auth = authConfig();
  const path = request.nextUrl.pathname;
  if (!auth.enabled) {
    if (!LOCAL.has(host)) {
      return new NextResponse("MyTime no tiene acceso protegido: define MYTIME_PASSWORD y MYTIME_SESSION_SECRET antes de publicarlo.", { status: 503 });
    }
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.some((re) => re.test(path))) return NextResponse.next();
  const ok = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, auth.secret);
  if (ok) return NextResponse.next();
  if (path.startsWith("/api/")) return new NextResponse("No autorizado", { status: 401 });
  const url = request.nextUrl.clone();
  url.pathname = "/acceso";
  url.search = path === "/" ? "" : `?desde=${encodeURIComponent(path)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
