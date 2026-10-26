/**
 * Pantalla de carga instantánea al cambiar de sección: el marco y la
 * navegación se quedan y el contenido muestra un esqueleto mientras el
 * servidor responde (evita la sensación de que el toque no ha hecho nada).
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse">
      <span className="sr-only">Cargando…</span>
      <div className="mb-6 space-y-2">
        <div className="h-7 w-48 rounded-lg bg-line" />
        <div className="h-4 w-full max-w-md rounded bg-line/70" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-36 rounded-[var(--radius-card)] border border-line bg-surface" />
        ))}
      </div>
    </div>
  );
}
