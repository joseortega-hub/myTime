# Integración con Jira

> Estado: **preparada, no conectada.** No se ha hecho ninguna llamada a un Jira real. Todo está probado con respuestas simuladas.

## Arquitectura del adaptador

```
src/integrations/jira/
├─ types.ts        Puertos: AbsenceSource (lectura) y WorklogSink (escritura de horas), JiraError
├─ config.ts       Lee variables de entorno; estado público sin secretos; carga del mapeo
├─ mapping.ts      Esquema del mapeo de campos y conversión incidencia/worklog → ausencia
├─ http-client.ts  Cliente REST mínimo: solo rutas /rest/, errores clasificados y saneados
├─ adapters.ts     DisabledJiraAdapter · MockJiraAdapter · LiveJiraAdapter · createJiraAdapter()
└─ sync.ts         Sincronización idempotente (crear / actualizar / marcar eliminadas)
```

El resto de la aplicación solo conoce los puertos. Cambiar de Jira a otra fuente (por ejemplo, un sistema de RR. HH.) supone escribir otro adaptador, sin tocar la interfaz ni el dominio.

**Modos** (`JIRA_MODE`):

| Modo | Comportamiento |
|---|---|
| `disabled` (defecto) | No hay llamadas. La app funciona completa con datos locales. |
| `mock` | Datos **simulados** (`SIM-…`, «Persona simulada N»), sin red. Para probar la sincronización y el envío de horas. |
| `live` | API REST real. Requiere URL https, token autorizado y mapeo. |

## Sincronización

- Cada registro externo se identifica por `(externalSource, externalId)` → no hay duplicados.
- Si cambia tipo, estado, fechas o jornada → se actualiza y se anota en el historial.
- Si desaparece de la fuente dentro del rango consultado → se marca **Cancelada** (no se borra).
- Las ausencias creadas a mano nunca se modifican.
- Cada ejecución queda en `SyncRun` (fecha, contadores, error saneado).
- La integración de ausencias es **solo lectura**: no crea solicitudes ni cambia estados en Jira.

## Imputación de horas

Las horas se pueden enviar como *worklogs* (`POST /rest/api/2/issue/{clave}/worklog`) **solo** si `JIRA_MODE=live` **y** `JIRA_ENABLE_WORKLOG_WRITE=true`. Por defecto está desactivado. Cada envío lo inicia el usuario, con confirmación, y un registro ya enviado no se reenvía ni se puede editar en MyTime.

## Datos que hay que descubrir en Jira

1. **Cómo se registran vacaciones, festivos y compensados**:
   - ¿Una incidencia por solicitud (estrategia `issue`)? → proyecto, tipo de incidencia, campos de fecha de inicio/fin, campo de tipo de ausencia y estados del flujo (pendiente, aprobada, rechazada).
   - ¿Horas imputadas en una tarea fija (estrategia `worklog`)? → clave de la tarea de cada tipo y cuántos minutos equivalen a una jornada.
2. **Identificadores de campos personalizados** (`customfield_XXXXX`): `GET /rest/api/2/field`.
3. **Nombres exactos de los estados** de aprobación.
4. Si Jira contiene el **saldo anual oficial** y en qué campo.
5. Qué tareas reciben las **horas por proyecto** (clave por proyecto/tarea).
6. Si la API REST está accesible desde donde se ejecutará MyTime (red interna, VPN).

Con esos datos se copia `config/jira-mapping.example.json` (o `jira-mapping.worklog.example.json`) a `config/jira-mapping.json` (ignorado por Git) y se sustituyen los marcadores `<...>`.

## Autenticación

El acceso corporativo usa SSO con **Okta Verify**. MyTime **no**:

- intenta eludir Okta ni automatiza el inicio de sesión interactivo,
- reutiliza cookies del navegador,
- pide ni guarda la contraseña corporativa,
- genera tokens ni afirma conectar sin credenciales válidas.

Mecanismos válidos (a confirmar con los administradores):

| Mecanismo | Uso en MyTime |
|---|---|
| **Personal Access Token** (Jira Data Center/Server) | `JIRA_AUTH_METHOD=pat`, `JIRA_TOKEN=<token>`. Si la empresa los permite con SSO. |
| **OAuth 2.0** (aplicación registrada por la empresa) | `JIRA_AUTH_METHOD=oauth2_bearer`, `JIRA_TOKEN=<access token>`. Falta implementar el flujo de obtención/renovación del token. |
| Cuenta de servicio / integración aprobada | Igual que PAT, con permisos acotados. |

Ambos se envían como `Authorization: Bearer`. El token solo se lee en el servidor y nunca aparece en logs, errores ni en el navegador. Las redirecciones se tratan como error (suelen indicar la página de inicio de sesión del SSO).

## Permisos necesarios

- Lectura de **tus** solicitudes de ausencia (o de tus worklogs en las tareas de ausencias).
- Para el equipo: un permiso **explícito** y una fuente que exponga solo disponibilidad. Hoy `listTeamAbsences` del adaptador real devuelve `forbidden` a propósito: ver una tarea no autoriza a consultar los datos de todos.
- Para enviar horas: permiso para crear worklogs en las tareas de proyecto, y autorización de la empresa para automatizarlo.

## Pasos para activar la conexión

1. Obtener autorización y el mecanismo de autenticación aprobado.
2. Descubrir los datos de la sección anterior y crear `config/jira-mapping.json`.
3. En `.env` del servidor: `JIRA_MODE=live`, `JIRA_BASE_URL=https://…`, `JIRA_AUTH_METHOD`, `JIRA_TOKEN`.
4. **Ajustes → Jira → Probar conexión** (llama a `/rest/api/2/myself`).
5. **Leer mis ausencias** y revisar el resultado; el historial queda en «Últimas sincronizaciones».
6. Solo si está autorizado: `JIRA_ENABLE_WORKLOG_WRITE=true` para imputar horas.

## Limitaciones

- La sintaxis JQL de campos personalizados depende de la instancia: el filtro por fechas se aplica tras leer (hasta 1.000 incidencias por sincronización).
- No hay sincronización automática periódica; se lanza desde Ajustes.
- El flujo OAuth (obtención y renovación del token) no está implementado.
- No probado contra una instancia real.
