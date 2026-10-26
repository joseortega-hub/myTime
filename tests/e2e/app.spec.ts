import { expect, test, type Page } from "@playwright/test";

/** Lunes laborable a varias semanas vista (dentro del año actual si es posible). */
function futureMonday(weeksAhead = 3): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + weeksAhead * 7);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function plusDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const year = new Date().getUTCFullYear();

async function toastContains(page: Page, text: string | RegExp) {
  await expect(page.getByRole("status").filter({ hasText: text }).first()).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("el inicio avisa de que falta el saldo y no inventa días disponibles", async ({ page }) => {
  await page.goto("/");
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await expect(page.getByRole("heading", { name: "Tu situación" })).toBeVisible();
  await expect(page.getByText("Aún no has indicado tus días asignados")).toBeVisible();
  await expect(page.getByText(/incompleto/).first()).toBeVisible();
});

test("configurar el saldo anual y verlo en el inicio", async ({ page }) => {
  await page.goto("/ajustes#saldos");
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await page.getByLabel("Días asignados").fill("23");
  await page.getByLabel("Origen del dato").selectOption("OFFICIAL");
  await page.getByRole("button", { name: "Guardar saldo" }).click();
  await toastContains(page, "Saldo guardado");
  await page.goto("/");
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await expect(page.getByText("Saldo oficial confirmado")).toBeVisible();
  await expect(page.getByText("Disponibles").locator("..").getByText("23")).toBeVisible();
});

test("crear, avisar de solapamiento y eliminar ausencias", async ({ page }) => {
  const monday = futureMonday();
  await page.goto("/ausencias");
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Nueva ausencia" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva ausencia" });
  await dialog.getByLabel("Estado").selectOption("APPROVED");
  await dialog.getByLabel("Desde").fill(monday);
  await dialog.getByLabel("Hasta").fill(plusDays(monday, 4));
  await expect(dialog.getByText(/5\s+días laborables/)).toBeVisible();
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await toastContains(page, "Ausencia guardada");
  await expect(page.getByText("Aprobada").first()).toBeVisible();

  // Solapamiento: se pide confirmación
  await page.getByRole("button", { name: "Nueva ausencia" }).click();
  const d2 = page.getByRole("dialog", { name: "Nueva ausencia" });
  await d2.getByLabel("Desde").fill(plusDays(monday, 2));
  await d2.getByLabel("Hasta").fill(plusDays(monday, 2));
  await d2.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("dialog", { name: "¿Guardar de todos modos?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar" }).last().click();
  await page.keyboard.press("Escape");

  // El saldo descuenta solo la aprobada (si es de este año)
  if (monday.startsWith(String(year)) && plusDays(monday, 4).startsWith(String(year))) {
    await page.goto("/");
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
    await expect(page.getByText("Disponibles").locator("..").getByText("18")).toBeVisible();
  }

  // Eliminar con confirmación
  await page.goto("/ausencias?año=todos");
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Eliminar" }).first().click();
  await page.getByRole("dialog", { name: "¿Eliminar esta ausencia?" }).getByRole("button", { name: "Eliminar" }).click();
  await toastContains(page, "Ausencia eliminada");
  await expect(page.getByText("No hay ausencias con estos filtros")).toBeVisible();
});

test("añadir un festivo y verlo en el calendario", async ({ page }) => {
  const day = plusDays(futureMonday(2), 2);
  await page.goto(`/ajustes?año=${day.slice(0, 4)}#calendario`);
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await page.getByLabel("Fecha", { exact: true }).fill(day);
  await page.getByLabel("Nombre", { exact: true }).last().fill("Festivo de prueba");
  await page.getByRole("button", { name: "Añadir", exact: true }).click();
  await toastContains(page, "Festivo añadido");
  await page.goto(`/calendario?año=${day.slice(0, 4)}&mes=${Number(day.slice(5, 7))}`);
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await expect(page.getByText("Festivo de prueba").first()).toBeVisible();
});

test("el optimizador propone fechas y guarda una planificación personal", async ({ page }) => {
  await page.goto("/optimizador");
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await page.getByLabel("Días que quieres gastar").fill("3");
  await page.getByRole("button", { name: "Calcular propuestas" }).click();
  await expect(page.getByText(/Búsqueda exhaustiva/)).toBeVisible();
  await expect(page.getByText("Por qué se recomienda").first()).toBeVisible();
  await page.getByRole("button", { name: "Guardar" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Guardar como planificación personal" });
  await expect(dialog.getByText(/No se envía ninguna solicitud a Jira/)).toBeVisible();
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await toastContains(page, "Planificación guardada");
  await expect(page.getByText("Planificaciones guardadas")).toBeVisible();
  await page.goto("/ausencias?estado=PLANNED&año=todos");
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await expect(page.locator("li").filter({ hasText: "Optimizador" }).first()).toBeVisible();
});

test("compensados: registrar opciones, elegir una y ver las demás", async ({ page }) => {
  const a = futureMonday(4);
  const b = plusDays(a, 7);
  await page.goto("/compensados");
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Registrar opciones" }).click();
  const dialog = page.getByRole("dialog", { name: "Registrar opciones de compensados" });
  await dialog.getByLabel("Nombre").fill("Compensados de prueba");
  await dialog.getByLabel("Cuántas se pueden elegir").fill("1");
  await dialog.getByLabel("Opción 1: desde").fill(a);
  await dialog.getByRole("button", { name: "Añadir opción" }).click();
  await dialog.getByLabel("Opción 2: desde").fill(b);
  await dialog.getByRole("button", { name: "Guardar opciones" }).click();
  await toastContains(page, "Opciones guardadas");
  await page.getByRole("button", { name: "Elegir" }).first().click();
  await page.getByRole("dialog", { name: "Elegir opción de compensado" }).getByRole("button", { name: "Elegir" }).click();
  await toastContains(page, "Opción elegida");
  await expect(page.getByText("1 de 1 elegidas")).toBeVisible();
  await expect(page.getByRole("region", { name: "Otras opciones" }).getByRole("button", { name: "Elegir" })).toBeDisabled();
});

test("horas: crear proyecto, interpretar texto y guardar", async ({ page }) => {
  await page.goto("/horas");
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Añadir proyectos" }).click();
  const dialog = page.getByRole("dialog", { name: "Proyectos y tareas" });
  await dialog.getByLabel("Nombre").fill("Proyecto Alfa");
  await dialog.getByLabel("Clave de tarea Jira").fill("ALFA-12");
  await dialog.getByLabel("Alias (separados por comas)").fill("alfa");
  await dialog.getByRole("button", { name: "Añadir" }).click();
  await toastContains(page, "Proyecto guardado");
  await page.keyboard.press("Escape");

  await page.getByLabel("Describe tus horas").fill("2h30 en alfa revisión de código");
  await page.getByRole("button", { name: "Interpretar" }).click();
  await expect(page.getByText("Vista previa para")).toBeVisible();
  await expect(page.getByLabel("Duración (h:mm)")).toHaveValue("2:30");
  await expect(page.getByText("Seguro")).toBeVisible();
  await page.getByRole("button", { name: /Guardar 1 registros/ }).click();
  await toastContains(page, "1 registros guardados");
  await expect(page.getByText("Revisión de código")).toBeVisible();
  await expect(page.getByRole("button", { name: /Enviar semana/ })).toBeDisabled();
});

test("equipo: los datos de demostración están identificados", async ({ page }) => {
  await page.goto("/equipo");
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Cargar datos demo" }).click();
  await toastContains(page, "Datos de demostración cargados");
  await expect(page.getByText("Estás viendo datos de demostración")).toBeVisible();
  await expect(page.getByText("Persona demo 1").first()).toBeVisible();
});

test("modo oscuro y estilo se guardan y se aplican antes de pintar", async ({ page }) => {
  await page.goto("/");
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await page.getByRole("button", { name: /Cambiar el estilo/ }).first().click();
  await page.getByRole("radio", { name: /Oscuro/ }).click();
  await page.getByRole("radio", { name: /Mediterráneo/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "terracota");
});

test("navegación móvil y teclado", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  const nav = page.getByRole("navigation", { name: "Principal móvil" });
  await expect(nav).toBeVisible();
  await nav.getByRole("button", { name: "Más" }).click();
  await page.getByRole("dialog", { name: "Más secciones" }).getByRole("link", { name: "Compensados" }).click();
  await expect(page).toHaveURL(/compensados/);
  // En una carga completa, el primer Tab lleva al enlace para saltar al contenido.
  await page.goto("/compensados");
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
});

test("rechaza peticiones con un Host no permitido", async ({ request }) => {
  const res = await request.get("/", { headers: { Host: "evil.example" } });
  expect(res.status()).toBe(403);
});

test("guardias: registrar una guardia y verla en próximas", async ({ page }) => {
  const day = futureMonday(1);
  await page.goto("/guardias");
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Nueva guardia" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Nueva guardia" });
  await dialog.getByLabel("Desde").fill(day);
  await dialog.getByLabel("Hasta").fill(plusDays(day, 6));
  await dialog.getByLabel("Hora de inicio (opcional)").fill("18:00");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await toastContains(page, "Guardia guardada");
  await expect(page.getByText("Localizable · 7 días").first()).toBeVisible();
});

test("mapa de vacaciones: muestra el plazo de 3 meses y los meses", async ({ page }) => {
  await page.goto("/vacaciones");
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await expect(page.getByRole("heading", { name: "Mapa de vacaciones" })).toBeVisible();
  await expect(page.getByText(/para pedir vacaciones en/).first()).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText(/Pide antes del|Plazo cerrado|Cerrándose/).first()).toBeVisible();
});

test("ajustes: sección de avisos al móvil indica qué falta configurar", async ({ page }) => {
  await page.goto("/ajustes#avisos");
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await expect(page.getByRole("heading", { name: "Avisos en el móvil" })).toBeVisible();
  await expect(page.getByText("Falta configurar el servidor")).toBeVisible();
});
