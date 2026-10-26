# Hoja de ruta: de personal a empresarial

> Nada de lo descrito aquí está implementado salvo lo que se indica expresamente.

## Punto de partida (implementado)

- Un único usuario (`UserProfile` con id fijo) y datos separados por `userId` en casi todos los modelos.
- Acceso opcional con contraseña única y cookie firmada para desplegarlo de forma personal.
- Integraciones aisladas tras puertos (`AbsenceSource`, `WorklogSink`).
- Equipos y personas como datos manuales, con campos `source`/`externalId` para una fuente externa.

## 1. Identidad y SSO

- Sustituir el acceso por contraseña por **OIDC/SAML con el proveedor corporativo (Okta)**, p. ej. con Auth.js.
- Resolver `getCurrentUser()` desde la sesión (sub/email) en lugar del id fijo.
- Sesiones cortas, cierre de sesión global y MFA gestionado por el IdP.

## 2. Gestión de usuarios

- Alta automática al primer inicio de sesión (JIT) o aprovisionamiento SCIM.
- Baja/desactivación sincronizada con el directorio.
- Añadir `userId` a los modelos que hoy son globales (`Team`, `PushSubscription`, `AlertDismissal`, `NotificationLog`, `SyncRun`).

## 3. Permisos por equipo

- Roles: empleado, responsable de equipo, administrador de RR. HH.
- Un empleado ve sus datos; la disponibilidad del equipo solo como fechas agregadas, según la política.
- Responsables: aprobación de solicitudes (solo si se decide que MyTime sea sistema de registro; hoy no lo es).
- Comprobar permisos en cada servicio, no solo en la interfaz.

## 4. Administración centralizada

- Calendarios laborales por centro/convenio gestionados por la empresa (festivos oficiales firmados).
- Saldos oficiales importados del sistema de RR. HH. (`source = OFFICIAL`).
- Reglas de empresa: antelación mínima, cobertura mínima por equipo, periodos bloqueados.
- Configuración de integraciones a nivel de empresa (`IntegrationConfig`), con secretos en un gestor (Vault, Key Vault, Secrets Manager).

## 5. Auditoría

- Registro inmutable de quién hizo qué y cuándo (altas, cambios de estado, sincronizaciones, envíos a Jira).
- Ampliar `AbsenceEvent` con actor e IP; retención según la política de datos.

## 6. Seguridad y privacidad

- Evaluación de impacto (RGPD): los datos de ausencias son personales; minimizar (sin motivos médicos).
- Cifrado en reposo de la base de datos y copias de seguridad automáticas con restauración probada.
- CSP estricta, límites de peticiones, escaneo de dependencias en CI.

## 7. Infraestructura y despliegue

- Contenedor (Next.js `output: "standalone"`) + PostgreSQL gestionado.
- Programador gestionado para `/api/cron/reminders` y sincronizaciones periódicas con Jira.
- Entornos (desarrollo, preproducción, producción), migraciones con `prisma migrate deploy` en el pipeline.
- Observabilidad: logs estructurados sin datos personales, métricas y alertas.

## 8. Integración autorizada con Jira

- Aplicación OAuth registrada por la empresa o cuenta de servicio con permisos mínimos.
- Implementar obtención/renovación de tokens OAuth y sincronización programada.
- Si se autoriza la escritura: imputación de horas por usuario con su propio token, nunca con una cuenta compartida.

## Requisitos pendientes de confirmar

- Estructura real de las tareas de ausencias en Jira, campos personalizados y estados.
- Disponibilidad de la API REST y mecanismo de autenticación aprobado.
- Si Jira contiene el saldo oficial.
- Permisos para consultar ausencias de compañeros.
- Política de la empresa sobre automatizar imputaciones.
