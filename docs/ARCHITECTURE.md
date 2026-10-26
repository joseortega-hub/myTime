# Arquitectura

## Visión general

```
Navegador ──► proxy.ts (host permitido, sesión) ──► Next.js App Router
                                                     ├─ Páginas (Server Components) ─┐
                                                     ├─ Acciones de servidor ────────┤
                                                     └─ Rutas API (export, cron) ────┤
                                                                                     ▼
                                                      src/server/services  (casos de uso, Zod)
                                                          │            │             │
                                                          ▼            ▼             ▼
                                                     src/domain   Prisma/PostgreSQL  src/integrations
                                                   (lógica pura)                   (Jira, festivos, push)
```

| Capa | Carpeta | Responsabilidad |
|---|---|---|
| Interfaz | `src/app/(app)`, `src/components` | Páginas (servidor) y componentes interactivos (cliente). Sin lógica de negocio. |
| Acciones | `src/app/actions.ts` | Único punto de escritura desde la interfaz. Delegan en servicios y devuelven `ActionResult`. |
| Servicios | `src/server/services` | Casos de uso: validan con Zod, consultan/persisten con Prisma y usan el dominio. |
| Dominio | `src/domain` | Funciones puras y probadas: fechas, calendario laboral, consumo y saldo, optimizador, equipo, plazos, alertas, guardias, intérprete de horas. Sin dependencias de Next ni de la base de datos. |
| Persistencia | `prisma/schema.prisma`, `src/server/db.ts` | PostgreSQL con Prisma 6. |
| Integraciones | `src/integrations` | Jira (puertos + adaptadores), festivos públicos, regiones de España. |
| Seguridad | `src/proxy.ts`, `src/lib/session.ts` | Hosts permitidos, acceso con contraseña, cookie firmada. |

## Decisiones técnicas

- **Next.js 16 (App Router) + React 19 + TypeScript estricto + Tailwind 4.** Renderizado dinámico (`force-dynamic`) porque todo depende de datos personales; sin Cache Components para simplificar.
- **Fechas como texto `YYYY-MM-DD`.** Toda la aritmética de días se hace en UTC sobre fechas sin hora; solo «hoy» depende de `MYTIME_TIMEZONE`. Así el cambio de hora o la zona del servidor nunca desplazan un día.
- **Acciones de servidor en lugar de API REST** para la interfaz: Next.js verifica el origen (protección CSRF) y se reduce código. Las únicas rutas API son la exportación y el programador de avisos.
- **Componentes propios** accesibles (diálogo nativo `<dialog>`, foco, `aria-*`) en vez de una librería, para evitar dependencias; estilo coherente mediante variables CSS (temas claro/oscuro y 5 estilos).
- **Calendario propio**: los requisitos de estados/texturas eran muy específicos; una cuadrícula propia resultó más simple que adaptar una librería.
- **Sin IA en procesos deterministas**: optimizador, saldo, alertas e intérprete de horas son algoritmos.
- **Datos demo** marcados en el modelo (`isDemo`) y en la interfaz; se borran de una vez.
- **Usuario personal con id fijo** (`local-user`) e inicialización idempotente: preparado para sustituirse por la identidad de un SSO.

## Modelo de datos

| Modelo | Contenido |
|---|---|
| `UserProfile` | Usuario personal y preferencias (reglas de alertas) validadas con Zod. |
| `WorkCalendar` / `Holiday` | País, región, municipio, días laborables, años confirmados; festivos por ámbito (nacional, autonómico, local, empresa) y origen. |
| `WorkScheduleDay` | Jornada por día de la semana (entrada, salida, pausa). |
| `AnnualBalance` | Saldo por año y tipo con su origen (oficial, estimado, manual) y días arrastrados. |
| `Absence` / `AbsenceEvent` | Ausencias (tipo, estado, fechas, media jornada, días indicados a mano, origen, id externo) e historial de estados. |
| `Plan` | Planificaciones guardadas desde el optimizador. |
| `CompensatoryGroup` / `CompensatoryOption` | Opciones de compensados ofrecidas y vínculo con la ausencia elegida. |
| `OnCallShift` | Guardias, intervención y compensación. |
| `Team` / `Person` / `TeamAbsence` | Disponibilidad del equipo (solo fechas y estado). |
| `WorkItem` / `TimeEntry` | Proyectos/tareas con clave Jira y alias; imputaciones de horas con estado de envío. |
| `SyncRun` | Historial de sincronizaciones con fuentes externas. |
| `PushSubscription` / `NotificationLog` | Dispositivos para avisos y avisos ya enviados. |
| `AlertDismissal` | Alertas descartadas. |

## Módulos de dominio

- `dates.ts` — utilidades de fecha sin zona horaria.
- `calendar.ts` — `CalendarIndex`: clasificación de días, días laborables, completitud del calendario.
- `absences.ts` — tipos/estados, consumo por día y año, duplicados, solapamientos, transiciones.
- `balance.ts` — cálculo de saldo (ver ALGORITHM.md).
- `optimizer.ts` — generación exhaustiva de bloques + programación dinámica.
- `team.ts` — ausentes por día, cobertura, ventanas tranquilas.
- `deadlines.ts` — plazo de antelación para pedir vacaciones.
- `alerts.ts` — reglas de alertas y recordatorios push.
- `oncall.ts` — guardias.
- `hours/schedule.ts`, `hours/parser.ts` — jornada e intérprete de texto.

## Pruebas

- `tests/unit` — dominio, Jira (adaptadores con `fetch` simulado), proxy y sesión.
- `tests/integration` — servicios contra PostgreSQL real (esquema `test`).
- `tests/e2e` — flujos completos con Playwright sobre la build de producción.
