# Editor SQL

## Abrir una pestaña de consulta

- ⌘T / Ctrl+T: nueva pestaña de consulta
- Doble clic en una tabla → abre la cuadrícula por defecto (equivale a `SELECT * FROM table LIMIT 200`)
- Clic derecho en la tabla → "Nueva consulta" prerellenará `SELECT * FROM ...` en el editor

## Capacidades del editor

Basado en Monaco (el mismo de VS Code), con temas por dialecto SQL.

### Autocompletado

Se activa con `Ctrl+Space` o automáticamente al escribir, completa:

- Palabras clave SQL / funciones integradas
- Todas las bases / schemas de la conexión actual
- Las columnas de las tablas referenciadas en FROM / JOIN
- Los snippets SQL guardados (el nombre del snippet actúa como disparador)

### Formateo

⌘⇧F / Ctrl+Shift+F formatea con un atajo (basado en sql-formatter). Adapta el estilo al dialecto (MySQL / PG / Oracle, cada uno con sus preferencias).

### Parámetros

Soporta parámetros con nombre `:name`. Al ejecutar, se abre un diálogo para introducir los valores:

```sql
SELECT * FROM orders
 WHERE user_id = :uid
   AND created_at >= :start
```

Al ejecutar, se piden `uid` y `start`; SkylerX los transforma a la forma soportada por el driver (`?`, `$1`, etc.).

### Biblioteca de snippets SQL

`⌘K → Snippets` o el panel "Snippets" a la izquierda:

- Guarda SQL recurrente (nombre + descripción + etiquetas)
- Filtra por etiqueta
- Doble clic para insertarlo en el editor actual o arrástralo a cualquier pestaña

## Ejecución

| Atajo | Comportamiento |
|---|---|
| ⌘+Enter / Ctrl+Enter | Ejecuta (solo lo seleccionado si hay selección; si no, todo) |
| Botón "Ejecutar" de la barra | Igual que arriba |
| Botón "Cancelar" de la barra | Cancelación en el servidor (MySQL `KILL QUERY` / PG `pg_cancel_backend`) |

Las sentencias múltiples se separan automáticamente por `;` y se ejecutan en orden; si alguna falla, se detiene la ejecución y se resalta en rojo la sentencia fallida.

## Bloqueo de riesgos con el SQL Linter

Antes de ejecutar, corre un motor de reglas:

| Severidad | Regla | Comportamiento |
|---|---|---|
| error | UPDATE / DELETE sin WHERE | Diálogo de "SQL peligroso" |
| error | DROP TABLE / DATABASE en conexión prod | Diálogo de confirmación |
| warn | TRUNCATE en prod | Toast de aviso |
| warn | FROM multitabla sin ON | Toast |
| info | `SELECT *` | Marca en consola |
| info | SELECT sin LIMIT | Marca en consola |

**El Lint tiene prioridad sobre la "confirmación estricta en prod"**, para que un `UPDATE` sin WHERE no dispare dos diálogos a la vez al usuario.

## EXPLAIN visual

Botón **Explicar** en la barra (o `EXPLAIN+` para alternar ANALYZE con ejecución real):

- Muestra el plan de ejecución como árbol de nodos
- Comparativa filas estimadas / reales (modo ANALYZE)
- Operadores lentos coloreados por tiempo: verde (< 100ms) / amarillo (< 1s) / rojo (> 1s)
- Exportable a PNG / Markdown para compartir

## Autocompletado de IA en línea (estilo Copilot)

Se activa automáticamente tras configurar `Settings → AI Provider`:

- Se dispara tras 600ms de pausa del cursor
- Si llega un nuevo disparo, las peticiones en vuelo se cancelan al instante
- Tab acepta; Esc/Backspace cancela
- Comparte un interruptor maestro con el "Autocompletado SQL" (`Settings → Autocompletado`)

## Pedir ayuda a la IA tras un error

Cuando una ejecución falla:

- El área de resultados muestra el error completo + SQLSTATE / errno
- En la parte superior aparece el botón "**✨ Preguntar a la IA**" → envía el SQL actual + error + metadatos de la conexión al chat de IA y abre la conversación
- Todos los diálogos de alerta también tienen el botón "Preguntar a la IA"

## Historial de consultas

`⌘K → Historial` o el panel "Historial" a la izquierda:

- Orden cronológico inverso
- Muestra conexión / resumen del SQL / tiempo / estado
- Doble clic para reabrir
- Favoritos / búsqueda

## Favoritos

El botón ⭐ guarda el SQL actual en los favoritos:

- Nombre y etiquetas personalizables
- Disponible entre conexiones
- Acceso rápido desde la paleta de comandos (⌘K → "Favoritos")

## Gestión de varias pestañas

- Clic con la rueda en la pestaña → cerrar
- Clic derecho → Duplicar / mover a otra ventana / fijar / cerrar todas las de la derecha
- Reordena por arrastre
- Las pestañas fijadas se conservan tras reiniciar la app
