# Algoritmos y reglas de cálculo

## Días laborables y festivos

- Un día es **laborable** si su día de la semana está entre los días laborables del calendario y **no** es festivo.
- Los festivos tienen ámbito (nacional, autonómico, local, empresa) y origen (manual, archivo, fuente pública). Un festivo en un día no laborable no resta nada.
- Un año se considera **completo** solo si el usuario lo confirma. Añadir o borrar un festivo de ese año lo vuelve a marcar como pendiente. Nunca se deduce a partir del número de festivos.
- Importación oficial: Nager.Date devuelve festivos `global` (nacionales) y por comunidad (`counties`, p. ej. `ES-VC`). La provincia escrita por el usuario se traduce a su comunidad (Alicante → `ES-VC`). Los locales no se incluyen.

## Consumo de una ausencia

- Jornada completa: 1 por cada día laborable del periodo. Media jornada (solo en un día): 0,5.
- Si el usuario indica los días que consume, se usa ese valor (solo en ausencias de un mismo año).
- Las ausencias que cruzan el año se reparten por el año de cada día.

## Saldo

Para un año y un tipo (vacaciones, compensados, asuntos propios):

```
total        = asignados + arrastrados
disfrutados  = días DISFRUTADOS + días APROBADOS anteriores a hoy
por disfrutar= días APROBADOS de hoy en adelante
disponibles  = total − (disfrutados + por disfrutar)
si se aprueban las pendientes = disponibles − pendientes
```

- Solo descuentan **Aprobadas** y **Disfrutadas**. Pendientes, planificadas, rechazadas y canceladas no.
- Cada día se descuenta **una sola vez** aunque haya registros duplicados o solapados (mañana + tarde del mismo día = 1).
- Sin saldo configurado, el disponible es **desconocido** (no se inventa).
- El resultado se marca como **aproximado** si el saldo es estimado o los festivos del año no están confirmados.

## Plazo de antelación (3 meses)

- Un día `D` se puede pedir en plazo si `hoy ≤ D − N meses` (N = 3 por defecto; si el día no existe en el mes destino se usa el último día del mes).
- **Mes que se cierra**: el del primer día aún pedible. Ejemplo, hoy 26-10-2026: de enero de 2027 solo se puede pedir del 26 al 31 y el plazo termina el 31-10-2026 (quedan 5 días).
- En el mapa: *fuera de plazo*, *se cierra pronto* (≤ 14 días) o *en plazo*.
- Crear unas vacaciones pendientes o planificadas fuera de plazo no se bloquea, pero se avisa.

## Optimizador

### 1. Generación exhaustiva de bloques

Cada día del rango se clasifica como:

- **libre**: no laborable, festivo o ya ocupado por una ausencia propia activa;
- **gastable**: laborable, libre de ausencias, dentro del rango, no excluido y fuera de las reservas;
- **bloqueante**: laborable pero no gastable.

Un bloque es un tramo contiguo que empieza y termina en días gastables, contiene solo días gastables o libres y no supera el presupuesto. Su **descanso** se amplía con los días libres adyacentes. Se generan **todos** los bloques posibles (decenas de miles como mucho).

### 2. Selección óptima

Para cada objetivo se elige la combinación de bloques **no solapados** (con al menos un día entre descansos) que **maximiza la suma de una puntuación** sin superar el presupuesto, mediante programación dinámica exacta (planificación de intervalos ponderados con mochila):

```
dp[k][c] = max(dp[k−1][c], dp[prev(k)][c − coste_k] + valor_k)
```

| Objetivo | Valor de un bloque |
|---|---|
| Recomendada (preferencias) | `descanso + w·descanso² + 1,5·días prioritarios − λ·días-persona del equipo` (w = 0,05 si prefieres descansos largos, si no 0,01; λ = 0,6 si evitas el equipo, si no 0,1) |
| Máximo descanso | `descanso` |
| Descanso más largo | El bloque con más días seguidos y, con lo que sobre, máximo descanso |
| Menos coincidencias | `descanso − 3·días-persona`, descartando días que bajan la cobertura mínima |
| Alternativa | La recomendada evitando el bloque principal de la primera |

Las alternativas idénticas se fusionan (se indica qué objetivos cumple). Se ordenan por la puntuación de *Recomendada*. Aparte se listan los **mejores puentes** (≤ 5 días, sin fechas repetidas).

Presupuesto = mínimo(días que quieres gastar, disponibles sin solicitar ni planificar) − días reservados, con un máximo de 60.

### Limitaciones

- Óptimo **respecto a la función de puntuación** y al conjunto de bloques de días completos; no considera medias jornadas.
- Los pesos son heurísticos y están documentados arriba.
- La disponibilidad del equipo depende de los datos introducidos (manuales o demo).
- Un test compara el resultado con una búsqueda por fuerza bruta para presupuestos pequeños.

## Alertas y recordatorios

| Regla | Cuándo |
|---|---|
| Festivos, compensados y guardias | Una semana antes (≤ 7 días) y el día antes (≤ 1 día). Antelaciones configurables. |
| Cierre semanal de Jira | Jueves y viernes, con horas registradas vs. esperadas y registros sin imputar. |
| Plazo de vacaciones | Cuando el mes que se cierra tiene ≤ 31 días de plazo (push con ≤ 7). |
| Vacaciones planificadas | Si su plazo vence en ≤ 14 días o ya venció. |
| Solicitudes pendientes, días sin planificar, equipo, días sin horas | Ver Ajustes → Alertas. |

Cada recordatorio tiene una clave determinista (incluye la etapa) para enviarlo al móvil una sola vez.

## Intérprete de horas

Determinista: normaliza el texto, convierte expresiones habladas («dos horas y media», «media hora»), detecta la fecha («hoy», «ayer», «el lunes», «el 12/10»), divide en segmentos y en cada uno busca duración (`4h`, `2h30`, `1,5 horas`, `de 8 a 12`, `el resto`, `todo el día`) y proyecto (clave Jira, nombre o alias, con tolerancia a una letra en palabras largas). Lo dudoso se marca para revisión y siempre hay vista previa editable.
