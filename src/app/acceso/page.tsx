import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Acceso" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ desde?: string }> }) {
  const { desde } = await searchParams;
  return (
    <main className="mx-auto mt-16 max-w-sm px-4">
      <div className="mb-6 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-primary text-lg font-bold text-primary-ink">M</span>
        <div>
          <h1 className="text-xl font-semibold">MyTime</h1>
          <p className="text-sm text-ink-soft">Acceso privado</p>
        </div>
      </div>
      <LoginForm desde={desde ?? "/"} />
    </main>
  );
}
