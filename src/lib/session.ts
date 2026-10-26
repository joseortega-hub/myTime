/**
 * Sesión mínima de un único usuario para desplegar MyTime fuera de tu equipo.
 * Cookie firmada con HMAC-SHA256 (Web Crypto: funciona en el proxy y en Node).
 * Se activa definiendo MYTIME_PASSWORD y MYTIME_SESSION_SECRET.
 */
export const SESSION_COOKIE = "mytime_session";
export const SESSION_DAYS = 30;

export function authConfig(env: Record<string, string | undefined> = process.env) {
  const password = env.MYTIME_PASSWORD ?? "";
  const secret = env.MYTIME_SESSION_SECRET ?? "";
  return { enabled: password.length > 0 && secret.length >= 32, password, secret };
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(secret: string, now = Date.now()): Promise<string> {
  const exp = String(now + SESSION_DAYS * 86_400_000);
  return `${exp}.${await hmacHex(secret, exp)}`;
}

export async function verifySessionToken(token: string | undefined, secret: string, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  return constantTimeEqual(sig, await hmacHex(secret, exp));
}

/** Compara contraseñas sin filtrar información por el tiempo de respuesta. */
export async function passwordMatches(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(given)), crypto.subtle.digest("SHA-256", enc.encode(expected))]);
  const ha = [...new Uint8Array(a)].map((x) => x.toString(16)).join("");
  const hb = [...new Uint8Array(b)].map((x) => x.toString(16)).join("");
  return constantTimeEqual(ha, hb) && expected.length > 0;
}
