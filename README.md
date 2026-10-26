# MyTime

Aplicación web personal para gestionar **vacaciones, festivos, días compensados, guardias y horas por proyecto** desde una única interfaz, con un **optimizador de vacaciones** propio y preparada para conectarse más adelante a Jira mediante una integración autorizada.

Funciona desde el primer día **sin Jira**: todos los datos se guardan en una base de datos PostgreSQL local.

> Estado: MVP personal. No hay datos corporativos reales ni conexión con sistemas de la empresa. Lo que solo está documentado (SSO, multiusuario…) se indica como tal.

---

## Funcionalidades

| Módulo | Qué hace |
|---|---|
| **Inicio** | Saldo del año (asignados, disfrutados, aprobados por disfrutar, pendientes, disponibles), próximo festivo, próximas ausencias, resumen del mes y acceso al optimizador. Distingue saldo *oficial*, *estimado* y *manual*, y no inventa el disponible si falta el saldo. |
| **Calendario** | Vista mensual y anual, filtros, detalle de cada día, festivos, fines de semana, ausencias por estado, guardias, ausencias del equipo y calculadora de días laborables de un periodo. |
| **Mapa de vacaciones** | 15 meses de un vistazo con la regla de **pedir con 3 meses de antelación** (configurable): días en plazo, que se cierran pronto o fuera de plazo, y aviso «te quedas sin tiempo para pedir vacaciones en …». |
| **Optimizador** | Busca de forma exhaustiva las mejores combinaciones de días (máximo descanso, descanso más largo, menos coincidencias con el equipo…), respeta exclusiones, prioridades, reservas y saldo, explica cada propuesta y permite compararlas y guardarlas como planificación personal. |
| **Equipo** | Calendario compartido por persona, ausentes por día, cobertura mínima, alertas de coincidencias y búsqueda de periodos tranquilos. Datos demo claramente marcados. Solo fechas, nunca motivos. |
| **Ausencias** | Alta, edición, borrado con confirmación, estados (planificada, pendiente, aprobada, disfrutada, rechazada, cancelada), historial de cambios, filtros, detección de duplicados y solapamientos, medias jornadas. |
| **Compensados** | Registra cada grupo de opciones que ofrece la empresa («elige 2 de estas 5»), las que has cogido y las que quedaron, con límite de elección. |
| **Guardias** | Guardias presenciales, en remoto o localizables, horas de intervención y compensación (pagada, con días, pendiente). |
| **Horas** | Escribe o **dicta** lo que has hecho («4h en PROJ-12 login, 2h30 reunión y el resto soporte»); un intérprete determinista (sin IA) lo convierte en registros con vista previa editable. Jornada L-J 8:00-18:00 con 1 h de comida (9 h) y V 8:00-15:00 (7 h), editable. Envío a Jira solo con escritura autorizada. |
| **Alertas** | Festivos, compensados y guardias **una semana antes y el día antes**; **cierre semanal de Jira jueves y viernes**; plazos de vacaciones; solicitudes pendientes; días sin planificar; coincidencias del equipo; días sin horas. Reglas configurables. |
| **Avisos al móvil** | Notificaciones push (Web Push, gratis) para los recordatorios anteriores cuando la app está desplegada y hay un programador diario. |
| **Ajustes** | Calendario laboral (país, comunidad/provincia, municipio, días laborables), festivos (manual, archivo o **importación oficial** nacional + autonómica), saldos, jornada, avisos, Jira y copias de seguridad. |
| **Estilo** | Modo claro/oscuro/sistema y 5 estilos (Agua, Enfoque, Mediterráneo, Pizarra, Alto contraste) desde el botón de paleta. |

## Requisitos

- Node.js 20.19+ (probado con Node 24) y npm.
- Docker (para PostgreSQL) o un PostgreSQL 14+ propio.

## Instalación y ejecución local

```bash
cp .env.example .env
docker compose up -d          # PostgreSQL en 127.0.0.1:5544
npm install                   # también genera el cliente de Prisma
npx prisma migrate deploy     # crea las tablas
npm run dev                   # http://127.0.0.1:3100
```

Primeros pasos en la app:

1. **Ajustes → Calendario laboral**: indica país (`ES`) y comunidad o provincia (p. ej. `Alicante`), pulsa **Importar oficiales** y añade a mano los festivos locales. Revisa el listado y pulsa **Confirmar festivos** del año.
2. **Ajustes → Saldos**: introduce tus días asignados e indica si son oficiales, estimados o manuales.
3. **Horas → Proyectos**: añade tus proyectos/tareas con su clave de Jira y los alias con los que los nombras.

## Pruebas

```bash
npm run typecheck   # TypeScript estricto
npm run lint
npm test            # Vitest: unitarias + integración (usa el esquema "test" de PostgreSQL)
npm run test:e2e    # Playwright sobre la build de producción (puerto 3101, esquema "test")
```

La primera vez que ejecutes las E2E: `npx playwright install chromium`.

Las pruebas de integración y E2E **nunca** tocan tus datos: usan `TEST_DATABASE_URL` (esquema `test`) y se niegan a ejecutarse con otro esquema.

## Configuración

Todas las variables están documentadas en [`.env.example`](.env.example). Las importantes:

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Conexión a PostgreSQL. |
| `MYTIME_TIMEZONE` | Zona horaria para decidir «hoy» (por defecto `Europe/Madrid`). |
| `MYTIME_ALLOWED_HOSTS` | Hosts aceptados (protección DNS rebinding). |
| `MYTIME_PASSWORD`, `MYTIME_SESSION_SECRET` | Acceso con contraseña. **Obligatorio** para publicar la app fuera de tu equipo: sin ellas solo responde en localhost. |
| `VAPID_*`, `CRON_SECRET` | Avisos al móvil (ver abajo). |
| `JIRA_*` | Integración con Jira (desactivada por defecto). Ver [docs/JIRA_INTEGRATION.md](docs/JIRA_INTEGRATION.md). |

## Avisos al móvil (producción)

Los recordatorios (jueves y viernes para el cierre de Jira; festivos, compensados y guardias 7 días y 1 día antes; plazos de vacaciones) se envían como notificaciones push:

1. Genera las claves: `npm run push:keys` y copia la salida a las variables del servidor.
2. Despliega con **HTTPS** y define `MYTIME_PASSWORD`, `MYTIME_SESSION_SECRET` y `MYTIME_ALLOWED_HOSTS=tu-dominio`.
3. Programa **una llamada diaria** (por ejemplo a las 9:00 de lunes a viernes):
   `POST https://tu-dominio/api/cron/reminders` con la cabecera `Authorization: Bearer <CRON_SECRET>`.
   Sirve cualquier programador: cron del sistema (`npm run reminders` con `MYTIME_URL` y `CRON_SECRET`), GitHub Actions, el cron de tu plataforma de hosting, etc.
4. En el móvil, abre la app, ve a **Ajustes → Avisos al móvil** y pulsa **Activar en este dispositivo**. En iPhone (iOS 16.4+) primero añade MyTime a la pantalla de inicio y ábrela desde allí.

Cada aviso se envía una sola vez (se registra en `NotificationLog`) aunque el programador se ejecute varias veces. **Sin programador no llegan avisos con la app cerrada**; dentro de la app las alertas se calculan siempre al abrirla.

## Copias de seguridad

No hay copias automáticas. Opciones:

- **Ajustes → Datos y copias**: exporta un JSON completo (re-importable y validado) o CSV de ausencias y horas.
- Copia completa de la base de datos:
  ```bash
  docker exec mytime-db pg_dump -U mytime -d mytime > backups/mytime-$(date +%F).sql
  ```
  Restaurar: `docker exec -i mytime-db psql -U mytime -d mytime < backups/archivo.sql`

## Seguridad

- Validación con Zod en el servidor para toda escritura; las acciones de servidor comprueban el origen (Next.js).
- Sin secretos en el repositorio (`.env*` ignorado salvo `.env.example`); el token de Jira y las claves privadas solo se leen en el servidor.
- Errores saneados: nunca se muestran tokens, cuerpos de respuesta ni datos internos.
- Cabeceras de seguridad, protección de host, acceso con contraseña y cookie firmada (HMAC) para despliegues.
- Exportaciones CSV protegidas contra inyección de fórmulas.
- `npm audit`: 0 vulnerabilidades conocidas (se fuerza `deepmerge-ts@8` para corregir una dependencia de la CLI de Prisma).
- El dictado por voz usa el reconocimiento del navegador: en Chrome/Edge el audio lo procesa el fabricante del navegador; por eso pide consentimiento explícito.
- La importación de festivos oficiales consulta el servicio público [Nager.Date](https://date.nager.at) solo cuando lo pides, enviando únicamente país y año.

## Limitaciones conocidas

- **Jira**: no hay conexión real. El adaptador está preparado y probado con respuestas simuladas; faltan los datos y permisos de la empresa (ver [docs/JIRA_INTEGRATION.md](docs/JIRA_INTEGRATION.md)).
- **Festivos**: la fuente pública incluye nacionales y autonómicos, **no los locales**, y puede omitir alguno autonómico (p. ej. en 2026 no trae San José en la Comunitat Valenciana). Por eso lo importado queda «sin confirmar» hasta que lo revises.
- **Optimizador**: trabaja con días completos (no medias jornadas) y es óptimo respecto a su función de puntuación. Ver [docs/ALGORITHM.md](docs/ALGORITHM.md).
- **Horas**: el intérprete reconoce un conjunto amplio pero finito de expresiones; lo dudoso se marca para revisar.
- **Avisos push**: verificados con pruebas automáticas (envío simulado, deduplicación, autenticación del programador); **no se ha probado la entrega real en un móvil** porque requiere un despliegue con HTTPS.
- Modo personal de un solo usuario. Lo necesario para una versión empresarial está en [docs/ENTERPRISE_ROADMAP.md](docs/ENTERPRISE_ROADMAP.md).

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md)
- [Integración con Jira](docs/JIRA_INTEGRATION.md)
- [Algoritmos y reglas de cálculo](docs/ALGORITHM.md)
- [Hoja de ruta empresarial](docs/ENTERPRISE_ROADMAP.md)
