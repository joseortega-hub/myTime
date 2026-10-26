"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authConfig, createSessionToken, passwordMatches, SESSION_COOKIE, SESSION_DAYS } from "@/lib/session";

export async function loginAction(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const auth = authConfig();
  if (!auth.enabled) redirect("/");
  const password = String(form.get("password") ?? "");
  const ok = await passwordMatches(password, auth.password);
  if (!ok) {
    // Pausa fija para dificultar ataques de fuerza bruta.
    await new Promise((r) => setTimeout(r, 1200));
    return { error: "Contraseña incorrecta." };
  }
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(auth.secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  const desde = String(form.get("desde") ?? "/");
  redirect(desde.startsWith("/") && !desde.startsWith("//") ? desde : "/");
}

export async function logoutAction() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/acceso");
}
