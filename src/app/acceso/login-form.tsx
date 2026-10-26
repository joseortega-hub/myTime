"use client";
import { useActionState } from "react";
import { Button, Card, Field, Input } from "@/components/ui";
import { loginAction } from "./actions";

export function LoginForm({ desde }: { desde: string }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <Card className="p-5">
      <form action={action} className="space-y-4">
        <input type="hidden" name="desde" value={desde} />
        <Field label="Contraseña" htmlFor="password" error={state?.error}>
          <Input id="password" name="password" type="password" autoComplete="current-password" required autoFocus aria-invalid={Boolean(state?.error)} />
        </Field>
        <Button type="submit" className="w-full" disabled={pending}>{pending ? "Comprobando…" : "Entrar"}</Button>
      </form>
    </Card>
  );
}
