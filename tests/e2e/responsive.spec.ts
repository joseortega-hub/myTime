/**
 * Auditoría responsive (misma lógica que scripts/audit-responsive.js de Proyecto X),
 * ejecutada en un móvil táctil emulado sobre todas las pantallas:
 * - el documento no se desplaza en horizontal,
 * - ningún elemento se sale de la pantalla sin un contenedor con scroll,
 * - zonas táctiles de al menos 44 px,
 * - sin texto cortado,
 * - altura útil para el contenido en horizontal.
 */
import { expect, test, type Page } from "@playwright/test";

const ROUTES = ["/", "/calendario", "/vacaciones", "/optimizador", "/equipo", "/ausencias", "/compensados", "/guardias", "/horas", "/alertas", "/ajustes"];
const VIEWPORTS = [
  { name: "320", width: 320, height: 640 },
  { name: "375", width: 375, height: 667 },
  { name: "414", width: 414, height: 896 },
  { name: "horizontal", width: 667, height: 375 },
];

interface Report {
  docOv: number;
  off: string[];
  tap: string[];
  cut: string[];
  main: number;
  chrome: number;
}

function audit(W: number): Report {
  const sel = (e: Element) => {
    const c = (typeof e.className === "string" ? e.className : "").split(/\s+/).filter(Boolean).slice(0, 3).join(".");
    const label = (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 24);
    return `${e.tagName.toLowerCase()}${c ? "." + c : ""} "${label}"`;
  };
  const clipped = (e: Element) => {
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== "visible") {
        const r = p.getBoundingClientRect();
        if (r.left >= -1 && r.right <= W + 1) return true;
      }
    }
    return false;
  };
  const out: Report = { docOv: document.documentElement.scrollWidth - document.documentElement.clientWidth, off: [], tap: [], cut: [], main: 0, chrome: 0 };
  for (const e of document.body.querySelectorAll("*")) {
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(e);
    if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
    if ((r.right > W + 1 || r.left < -1) && !clipped(e)) out.off.push(`${sel(e)} ${Math.round(r.left)}→${Math.round(r.right)}`);
    const interactive = e.matches("a[href],button,[role=button],[role=tab],[role=switch],input:not([type=hidden]),select,textarea,summary");
    // Exentos: enlace oculto "Saltar al contenido", enlaces dentro de un párrafo de texto,
    // casillas (su etiqueta mide 44 px) y celdas de tablas densas con scroll propio.
    const exempt =
      e.classList.contains("sr-only") ||
      (e.tagName === "A" && e.closest("p, li > p, [role=status] div")) ||
      (e.matches("input[type=checkbox]") && e.closest("label")) ||
      e.closest("table");
    if (interactive && !exempt && (r.width < 44 || r.height < 44)) out.tap.push(`${sel(e)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    if (e.scrollWidth > e.clientWidth + 1 && !["visible", "auto", "scroll"].includes(cs.overflowX) && e.clientWidth > 4 && (e.textContent || "").trim() && cs.textOverflow !== "ellipsis" && !e.closest("table"))
      out.cut.push(`${sel(e)} ${e.scrollWidth}>${e.clientWidth}`);
  }
  const header = document.querySelector("header.sticky")?.getBoundingClientRect().height ?? 0;
  const nav = document.querySelector('nav[aria-label="Principal móvil"]')?.getBoundingClientRect().height ?? 0;
  out.chrome = Math.round(header + nav);
  out.main = Math.round(window.innerHeight - out.chrome);
  return out;
}

for (const vp of VIEWPORTS) {
  test.describe(`móvil ${vp.name} (${vp.width}×${vp.height})`, () => {
    // Una sola pestaña por tamaño, reutilizada en todas las pantallas: reutiliza las
    // conexiones (keep-alive) en vez de abrir unas nuevas por prueba.
    let page: Page;
    test.beforeAll(async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true, locale: "es-ES", timezoneId: "Europe/Madrid" });
      page = await context.newPage();
    });
    test.afterAll(async () => {
      await page.context().close();
    });

    for (const route of ROUTES) {
      test(`auditoría ${route}`, async () => {
        await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
        await expect(page.locator("main h1")).toBeVisible();
        await expect(page.getByText("Cargando…")).toHaveCount(0);
        // Medir con la página asentada (fuentes y peticiones terminadas).
        await page.waitForLoadState("networkidle");
        await page.evaluate(() => document.fonts.ready);
        // La barra lateral de escritorio solo se oculta cuando los estilos ya se han aplicado.
        await expect(page.locator("aside").first()).toBeHidden();
        const r = await page.evaluate(audit, vp.width);
        expect.soft(r.docOv, "desplazamiento horizontal del documento").toBe(0);
        expect.soft(r.off, "elementos fuera de la pantalla").toEqual([]);
        expect.soft(r.tap, "zonas táctiles menores de 44 px").toEqual([]);
        expect.soft(r.cut, "texto cortado").toEqual([]);
        // En horizontal, la cabecera y la navegación no deben comerse más del 35 % de la altura.
        if (vp.height < 480) expect.soft(r.chrome, "altura de cabecera + navegación").toBeLessThanOrEqual(Math.round(vp.height * 0.35));
      });
    }
  });
}
