# Herramientas de productividad

SkylerX conecta las acciones "de 30 segundos a 30 minutos" que realizan a diario DBAs y backend a tres ejes troncales: **teclado / paleta de comandos / notificaciones**. La meta: menos clics, menos cambios de ventana. Esta página lista las entradas más usadas, cada herramienta con su correlato en código.

## 1. Resumen

| Herramienta | Entrada | Problema que resuelve |
|---|---|---|
| Paleta de comandos ⌘K | Global / `Settings → Atajos` | Todo se busca desde aquí, salta el menú |
| Búsqueda global de objetos ⌘⇧O | Global | Fuzzy entre bases para tablas / vistas / columnas → te lleva al árbol |
| Biblioteca de snippets SQL | Drawer derecho del editor / botón `★` | Guardar consultas reutilizables con plantillas `{{var}}` |
| Historial de consultas | Drawer derecho del editor | Orden por tiempo / duración; las lentas en rojo |
| Favoritos | ⌘K → "Favoritos" / barra | Acceso rápido a tablas / vistas / consultas |
| Atajos personalizados | `Settings → Atajos` | Rebindea 12 comandos con detección de conflictos |
| Dashboard | ⌘K → "Dashboard" | Panel multi-SQL multi-tarjeta de "estado de hoy" |
| Webhooks de notificación | `Settings → Notificaciones` | DingTalk / Feishu / Slack / genérico, para slow query + errores |
| Multi-ventana ⌘⇧N | Archivo → Nueva ventana | Misma app, dos sesiones independientes (local vs local / local vs remoto) |

---

## 2. Paleta de comandos ⌘K

Ubicación: `packages/ui/src/components/CommandPalette.vue` + `packages/ui/src/Workspace.vue` (catálogo / enrutado).

Pulsa ⌘K (mac) / Ctrl+K (Win/Linux) → caja de búsqueda flotante → escribe para filtrar → ↑↓ para elegir → Enter para ejecutar. Esc cierra.

### Mecánica de búsqueda

```ts
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q
    ? props.items.filter((it) => `${it.label} ${it.hint ?? ''}`.toLowerCase().includes(q))
    : props.items
})
```

- Coincide con label + hint (en conexión, el hint es el dialecto), substring includes puro; **no requiere pinyin ni coincidencia ordenada** (la velocidad de tecleo importa más que la fuzziness)
- Máximo 50 entradas (para que listas largas no congelen)

### Catálogo de comandos integrados

Lo siguiente es lo que produce el computed `paletteItems` en `Workspace.vue` (acciones + acciones por conexión + entradas de conexión):

| ID de acción global | Etiqueta | Equivalente |
|---|---|---|
| `act:new-conn` | Nueva conexión | Barra + |
| `act:object-search` | Búsqueda global de objetos | ⌘⇧O |
| `act:schema-diff` | Schema diff | Herramientas → Schema diff |
| `act:data-diff` | Data diff | Herramientas → Data diff |
| `act:privileges` | Permisos | Clic derecho conexión → Permisos |
| `act:settings` | Settings | ⌘, |
| `act:export-conns` / `act:import-conns` | Importar / exportar conexiones | Menú Archivo |
| `act:refresh` | Refrescar árbol | F5 |
| `act:favorites` | Favoritos | Barra ⭐ |
| `act:oplog` | Log de operaciones | Barra |
| `act:monitor` | Panel de monitor | Barra |
| `act:dashboard` | Dashboard | Herramientas → Dashboard |
| `act:ndjson-viewer` | Visor NDJSON | Barra |
| `act:contracts` | Contratos de datos | Herramientas → Contratos de datos |
| `act:o2dm` | Asistente de migración Oracle → DM | Barra |
| `act:translate` | Traducción SQL (entre dialectos) | Barra |
| `act:notif` | Configurar webhooks de notificación | `Settings → Notificaciones` |
| `act:keybind` | Atajos personalizados | `Settings → Atajos` |
| `act:drift` | Schema drift | Barra |
| `act:ai-chat` / `act:ai` / `act:ai-toolbox` | Chat IA / Asistente IA / Toolbox IA | ⌘⇧L |
| `act:about` / `act:shortcuts` | Acerca de / Referencia de atajos | Menú Ayuda |
| `act:new-window` | Nueva ventana (solo escritorio) | ⌘⇧N |

### Acciones por conexión

Estas acciones se despliegan por cada conexión existente; el sufijo de la etiqueta es `· nombre · dialecto`:

| Prefijo de ID | Significado |
|---|---|
| `act:activity:` | Actividad del servidor (processlist / pg_stat_activity) |
| `act:obtopo:` | Topología de clúster OceanBase (solo visible en dialecto OB) |
| `act:snapshots:` / `act:backup:` | Snapshots de schema / Backup-Restore |
| `act:health:` / `act:vqd:` | Diagnóstico IA / Constructor visual de consultas |
| `act:slowq:` / `act:idxrec:` / `act:repl:` | Slow queries / Recomendación de índices / Lag de replicación |
| `act:compliance:` / `act:search-value:` | Cumplimiento / Búsqueda full-text entre tablas |
| `act:aicmt:` | IA: escribir comentarios |
| Prefijo `conn:` | Abrir directamente la conexión (grupo = "Conexiones") |

> En un workspace con 5 conexiones, la paleta puede listar más de 80 comandos; entre el filtro por grupo y el includes por substring, basta con 3-4 caracteres para localizar el correcto.

### Cómo extenderla

El código se concentra en el computed `paletteItems`. Para añadir comandos: añade `{ id, label, group }` al array y rama `else if (item.id === ...)` en `onPaletteSelect()` con el enrutado. Para "expandir por conexión", mira `act:compliance:`: `.map(c => ({ id: \`act:xxx:${c.id}\`, ... }))`, y descompón el id en el router con `item.id.startsWith()`.

---

## 3. Búsqueda global de objetos ⌘⇧O

Ubicación: `packages/ui/src/components/ObjectSearchDialog.vue`.

Pulsa ⌘⇧O (mac) / Ctrl+Shift+O (Win/Linux); aparece un diálogo que **busca de forma difusa tablas, vistas y columnas entre bases / schemas** en la conexión seleccionada.

### SQL de búsqueda

Usa `information_schema`; dos variantes para MySQL / PG:

| Familia | Schemas excluidos | Patrón |
|---|---|---|
| MySQL | `mysql / information_schema / performance_schema / sys` | `LIKE '%term%'`, con escape de 3 caracteres `%_\\` |
| PG | `pg_catalog / information_schema` | `ILIKE '%term%'` |
| Otros | — | Sin soporte; sugiere búsqueda manual |

Cada categoría (tablas / vistas / columnas) trae como máximo 100 resultados; tipeo con debounce de 280 ms.

### Comportamiento del resultado

- **Clic en una fila = reveal**: emite `reveal`; Workspace localiza y selecciona el objeto en el árbol (expandiendo lo necesario)
- **Hover muestra "Preview"**: emite `preview`; abre directamente `SELECT * FROM schema.table LIMIT 200` (con quoting por dialecto)
- **Iconos**: `▦` tabla / `◫` vista / `·` columna

### Seguridad de concurrencia

Cada entrada incrementa un `seq`; solo el resultado "más reciente" se commitea, para que una respuesta atrasada no sobreescriba la actual.

---

## 4. Biblioteca de snippets SQL

Ubicación: `packages/ui/src/snippets.ts` + `packages/ui/src/components/SnippetsPanel.vue`.

### Estructura de datos

```ts
interface Snippet {
  id: string        // `${timestamp}-${rand5}`
  name: string      // 用户起名,留空则取 SQL 前 40 字符
  sql: string
  tags?: string[]   // 归类标签,UI 里按 # 过滤
  dialects?: DbDialect[]  // 限定方言,空 = 通用
  createdAt: number
}
```

Persistencia en `localStorage.skylerx.snippets`, con `reactive` + `watch deep` en Vue.

### Añadir / eliminar

- En cualquier editor SQL, clic derecho → "Guardar como snippet" o pulsa `★` en la barra
- En el historial, el botón `★` de cada fila → guarda como snippet directamente
- `Settings → Editor → Guardar snippet` está mapeado por defecto a ⌘S (modificable)

### Plantillas con placeholders

Los `{{var}}` se piden por prompt al insertar:

```sql
SELECT * FROM {{table}} WHERE id = {{id}}
```

`applySnippetVars()` extrae los placeholders en orden y los pregunta uno a uno; si cancelas alguno → cancela todo y no se inserta una SQL a medio hacer.

### Filtro por dialecto

`snippetsForDialect(dialect)` filtra el panel según el dialecto activo:

- `dialects = []` o sin definir → visible en cualquier dialecto ("genérico")
- `dialects = [MySQL, MariaDB]` → solo aparece en conexiones MySQL / MariaDB

Para no ver sintaxis específica de MySQL en una conexión PG.

### Interacciones del panel

| Acción | Efecto |
|---|---|
| Caja de búsqueda superior | Filtra por substring en name + SQL + tags |
| Clic en `#xxx` | Filtra por etiqueta; clic de nuevo lo quita |
| Doble clic en una fila | Aplica los placeholders y lo inserta en el editor |
| `×` | Borra el snippet (sin confirmación) |

---

## 5. Historial de consultas

Ubicación: `packages/ui/src/components/HistoryPanel.vue`.

Cada ejecución (con éxito o fallo) escribe un registro en la SQLite local con `sql / executedAt / durationMs / success / pinned / tags / note`.

### Orden + filtro

| Control | Descripción |
|---|---|
| Caja de búsqueda | Substring en sql + tags + note |
| Selector de orden | `Más recientes` (por defecto) / `Por duración descendente` |
| `≥ N ms` | Filtro de slow query: las filas que superan el umbral se pintan en rojo (por defecto 500ms) |
| `📌` | Ver solo los fijados |
| `Limpiar` | Vacía la tabla entera |

Los fijados siempre van arriba (`pinned: 1`), el resto sigue el orden elegido.

### Acciones de fila

| Botón | Acción |
|---|---|
| `📌` | Alterna pin |
| `🏷` | Edita tags (separados por coma, p. ej. `daily,prod,join`) |
| `📝` | Edita note (texto libre) |
| `★` | Guarda como snippet SQL (emite `saveSnippet`) |
| Doble clic | Vuelve a cargar el SQL en el editor actual |

Los cambios de metadatos van a SQLite por `client.connections.historyMeta(id, patch)`, no por localStorage.

### Integración con notificaciones de slow query

`Settings → Notificaciones → Disparadores globales → Umbral de slow query (ms)` (`settings.slowQueryNotifyMs`). Si lo pones distinto de 0, cualquier ejecución que lo supere disparará `notify('slow-query', ...)` por el webhook correspondiente.

---

## 6. Favoritos

Ubicación: `packages/ui/src/favorites.ts`.

Hay tres `kind` de favorito:

| kind | Significado | Acción al pulsar |
|---|---|---|
| `table` | Tabla | Reveal en el árbol + preview de las primeras 200 filas |
| `view` | Vista | Igual |
| `query` | SQL personalizado | Lo abre como borrador en una pestaña |

### Regla de PK

- Objetos: `${connId}|${sqlName}`; una sola entrada por objeto y conexión; el segundo clic desactiva
- Consultas: `q|${connId}|${createdAt}|${rand4}`; permite guardar varias veces el mismo SQL (uso: "snapshot" en momentos distintos)

### Etiqueta de grupo

`setFavoriteTag(id, tag)` adjunta una etiqueta a un favorito; el panel pliega por tag. Cada favorito usa solo la primera etiqueta, simple y suficiente.

### Persistencia

`localStorage.skylerx.favorites`, reactive + watch deep.

### Favorito directo desde historial

`addQueryFavorite({ connId, connName, dialect, name, sql, tags })` es el atajo para "esta consulta vale la pena guardarla". El `★` del HistoryPanel guarda como snippet; el botón "Guardar consulta actual" de la barra usa esta función.

---

## 7. Atajos personalizados (K1)

Ubicación: `packages/ui/src/keybindings.ts` + `packages/ui/src/components/KeyBindingsDialog.vue`.

Entrada: `Settings → Atajos` / paleta → "Atajos personalizados".

### 12 comandos rebindeable

| ID | Chord por defecto | Para qué |
|---|---|---|
| `run-sql` | `CmdOrCtrl+Enter` | Ejecutar SQL |
| `palette` | `CmdOrCtrl+K` | Paleta de comandos |
| `object-search` | `CmdOrCtrl+Shift+O` | Búsqueda global de objetos |
| `ai-chat` | `CmdOrCtrl+Shift+L` | Alternar chat de IA |
| `new-conn` | `CmdOrCtrl+N` | Nueva conexión |
| `new-query` | `CmdOrCtrl+T` | Nueva consulta |
| `close-tab` | `CmdOrCtrl+W` | Cerrar pestaña |
| `find` | `CmdOrCtrl+F` | Buscar en editor |
| `replace` | `CmdOrCtrl+H` | Reemplazar en editor |
| `format-sql` | `CmdOrCtrl+Shift+F` | Formatear SQL |
| `save-snippet` | `CmdOrCtrl+S` | Guardar SQL actual como snippet |
| `settings` | `CmdOrCtrl+,` | Settings |

### Convención de visualización de `CmdOrCtrl`

| Plataforma | Cómo se muestra `CmdOrCtrl+Shift+K` |
|---|---|
| macOS | `⌘⇧K` (estilo menú del sistema, sin `+`) |
| Windows / Linux | `Ctrl+Shift+K` |

El almacenamiento siempre usa la cadena agnóstica `CmdOrCtrl+...`; el render lo adapta por plataforma con `formatChord()`.

### Flujo de captura

1. Clic en "Grabar" de una fila → entra en modo grabación; se renderiza un `input` invisible (`position: absolute; left: -9999px`) que captura el foco de teclado
2. Escucha `keydown` y `chordFromEvent(e)` parsea la combinación:
   - El orden de modificadores es fijo `CmdOrCtrl → Shift → Alt` (para que la igualdad de strings ↔ chords sea estable)
   - Letras simples en mayúsculas; espacio → `Space`; el resto `Enter` / `,` / `ArrowUp` tal cual
   - Solo modificadores (Shift sin tecla principal) → devuelve cadena vacía
3. Enter guarda / Esc cancela / Backspace en draft vacío significa "desactivar este comando" (se guarda como cadena vacía)

### Detección de conflictos

El computed `conflicts` recorre todas las asignaciones (incluido `draftChord` en grabación); si dos comandos comparten chord, la fila muestra en rojo `"conflicto con el comando XX"`.

### Persistencia + "Restaurar valores por defecto"

Solo se guardan en `settings.keyBindings` (`Record<string, string>`) los chords distintos del valor por defecto.

- Volver al valor por defecto → se elimina del override
- "Restaurar todo" → vacía `settings.keyBindings` con doble confirmación
- "Desactivar un comando" = escribe cadena vacía; **mantiene la key** con valor `''`

---

## 8. Dashboard — multi-SQL multi-tarjeta

Ubicación: `packages/ui/src/components/DashboardDialog.vue`.

Entrada: menú Herramientas → Dashboard / ⌘K → "Dashboard".

### Estructura de tarjeta

```ts
interface Card {
  id: string
  title: string
  connId: string
  sql: string
  lastRunAt?: number
  lastResult?: QueryResult | null
  lastError?: string | null
}
```

- Persiste en `localStorage.skylerx.dashboard.cards`, pero **no guarda `lastResult`** (puede ser pesado); al abrir, se borra
- Cada fila muestra título + conexión + preview del SQL (truncado a 200 caracteres) + últimas 5 filas del resultado (truncadas a 60 caracteres)

### Operaciones

| Botón | Acción |
|---|---|
| `+ Añadir tarjeta` | Pequeño formulario: título + conexión + SQL (textarea de 4 líneas) |
| `↻ Refrescar todo` | `Promise.all(cards.map(runCard))` en paralelo |
| `↻` de la tarjeta | Refresca esa tarjeta |
| `✎` de la tarjeta | Entra al formulario de edición |
| `×` de la tarjeta | Elimina (con confirmación) |

### Lo que NO se hace (compromiso deliberado)

- **Sin auto-refresh**: fácil de olvidar y deja procesos consumiendo en segundo plano; pulsa ↻ cuando lo necesites
- **Sin gráficos**: salta a ChartDialog con "→" para una experiencia más limpia
- **Sin compartir / colaboración**: pendiente; no se introducirán dependencias de nube antes de v0.5

---

## 9. Webhooks de notificación

Ubicación: `packages/ui/src/notifications.ts` + `packages/ui/src/components/NotificationSettingsDialog.vue`.

Entrada: `Settings → Notificaciones` / ⌘K → "Webhooks de notificación".

### Cuatro canales

| Channel | URL | Firma |
|---|---|---|
| `dingtalk` | Webhook de bot DingTalk | HMAC-SHA256(`ts\n${secret}`, key=`secret`); se añade a query `?timestamp=&sign=urlencoded(...)` |
| `feishu` | Webhook de bot Feishu | HMAC-SHA256 (data vacío, key=`ts\n${secret}`); la firma va en el body |
| `slack` | Slack incoming webhook | Sin firma (la URL es la credencial) |
| `webhook` | POST JSON genérico | Sin firma; el receptor parsea como quiera |

La firma usa el HMAC-SHA256 de `globalThis.crypto.subtle`, **sin dependencias de terceros**.

### Tres eventos

| Event | Disparador |
|---|---|
| `query-error` | Ejecución SQL falla |
| `slow-query` | Duración ≥ `settings.slowQueryNotifyMs` (0 = desactivado) |
| `manual` | El usuario pulsa "Test" / "Notificar" en la barra |

Cada configuración suscribe los tres eventos por separado (`subscribe: NotifEvent[]`).

### Configuración

```ts
interface NotifConfig {
  id: string
  name: string
  channel: 'dingtalk' | 'feishu' | 'slack' | 'webhook'
  webhookUrl: string
  secret?: string           // 钉钉/飞书加签密钥(选填)
  enabled: boolean
  subscribe: NotifEvent[]
}
```

Se guarda en `localStorage.skylerx.notifications`, separado de `settings` (las notificaciones cambian mucho y meterían ruido en settings).

### Envío de prueba

`Settings → Notificaciones`, selecciona una configuración → "Test". Para que aplique:

- `enabled === true`
- `webhookUrl` no vacío
- `subscribe.includes('manual')` (la prueba usa `notify('manual', ...)`)

Si algo falta, aviso por toast y no se envía nada.

### El despacho no bloquea el flujo principal

`notify(event, payload)` es fire-and-forget:

```ts
await Promise.all(targets.map(async (c) => {
  try { await dispatchOne(c, payload) }
  catch (e) { console.warn(`[notify] ${c.channel}/${c.name} failed:`, e) }
}))
```

Cualquier fallo se traga y solo se anota como warn en consola. **Las notificaciones son auxiliares; no deben frenar el flujo principal**.

### Proxy de fetch en escritorio

En Electron, primero intenta el proxy IPC `globalThis.api.ai.fetch` (esquiva CORS del navegador); en web, fallback al `fetch` nativo.

---

## 10. Estructura del menú de la app

Ubicación: `apps/desktop/src/main/menu.ts`.

7 menús principales (estilo DataGrip / Navicat):

| Menú | Elementos clave |
|---|---|
| **SkylerX** (solo mac) | Acerca de / Settings ⌘, / Comprobar actualizaciones / Servicios / Ocultar / Salir |
| **Archivo** | Nueva conexión ⌘N / Nueva consulta ⌘T / Abrir archivo SQL ⌘O / Importar · Exportar conexiones / Backup · Restore / Cerrar pestaña ⌘W |
| **Edición** | Roles del sistema (deshacer / rehacer / cortar / copiar / pegar / seleccionar todo) + Buscar ⌘F / Reemplazar ⌘H / Formatear SQL ⌘⇧F |
| **Ver** | Paleta ⌘K / Búsqueda de objetos ⌘⇧O / Chat IA ⌘⇧L / Favoritos / Log de operaciones / Zoom / Pantalla completa / DevTools |
| **Herramientas** | Actividad / Backup-Restore / Transferencia de datos / Schema diff / Data diff / Snapshots de schema / Dashboard / Búsqueda full-text entre tablas / Contratos de datos / Toolbox IA / Asistente IA |
| **Ventana** | Nueva ventana ⌘⇧N / Minimizar / Recargar / (mac) Traer todas al frente |
| **Ayuda** | Acerca de / Referencia de atajos / Repositorio GitHub / Reportar problema / Comprobar actualizaciones |

### Detalles de implementación

Los menús personalizados **no ejecutan lógica de negocio en el proceso principal** (no tiene acceso al estado Vue del renderer); se unifica en `webContents.send('menu:command', '<key>')` que notifica al renderer. En `Workspace.vue`, `window.api.menu.onCommand(key => ...)` se suscribe y enruta al `onPaletteSelect` del paletteItem correspondiente.

---

## 11. Vista general de Settings

Ubicación: `packages/ui/src/components/SettingsDialog.vue`.

El diálogo `Settings` tiene 5 categorías a la izquierda; los formularios se renderizan dinámicamente a la derecha.

| Categoría | Elementos |
|---|---|
| **General** ⚙ | Idioma (zh / en), tema (oscuro / claro), zoom UI (70% - 200%), modo de commit por defecto (auto / manual), orden del árbol por frecuencia de uso, **interruptor de desensibilización + edición de reglas** |
| **Editor** ⌨ | Tamaño de fuente, indentación, ajuste de línea, autocompletado, mayúsculas/minúsculas (upper / lower / preserve) |
| **Cuadrícula** ▦ | Tamaño de página por defecto (50 / 100 / 200 / 500 / 1000), texto para NULL |
| **Marca de agua** ⚠ | Texto, opacidad (0.04 - 0.5), ángulo (-90° - 90°), tamaño, color; preview en vivo |
| **Asistente IA** ✨ | Cambio de provider (Anthropic / OpenAI / DeepSeek / Codex / Grok), API Key / Model / Base URL, memoria y perfil (A texto libre / B hechos estructurados / C memoria vectorial) |

> **Sobre el tema**: `Settings → General → Tema` afecta a todos los paneles. Oscuro por defecto (`appearance: 'dark'` en las variables CSS de VitePress / Electron renderer).

### Tres niveles de "memoria IA"

| Nivel | Campo | Significado |
|---|---|---|
| A | `aiCustomInstructions` | Texto libre, se concatena al system prompt en cada conversación |
| B | `aiFacts[]` + `aiAutoExtractFacts` | Lista de hechos estructurados, manual o auto-extraídos |
| C | `aiVectorMemory` + tres ajustes de embedding + `aiVectorTopK` | Memoria vectorial; recuperación semántica entre sesiones |

El botón inferior `Restaurar valores por defecto` resetea toda la tabla de settings con doble confirmación.

---

## 12. Multi-ventana ⌘⇧N

Ubicación: `apps/desktop/src/main/index.ts` → `spawnExtraWindow()` + IPC `window:newSession`.

⌘⇧N (mac) / Ctrl+Shift+N (Win/Linux) abre una nueva BrowserWindow (1100 × 750) que reutiliza la URL del renderer pero con **sesión completamente independiente** de la principal.

### Casos típicos

| Escenario | Cómo |
|---|---|
| Local vs remoto | Ventana principal en dev local; nueva ventana en réplica de prod; lado a lado |
| Cambio de tenants | Una ventana por tenant A; otra por tenant B |
| Consulta lenta + escribir mientras | Una corre el SQL lento; otra escribe el siguiente |

Cada ventana tiene sus propias pestañas de SQL, conexión / base / schema activa y posición del cursor. El historial / favoritos / snippets se **comparten** (mismo origen en localStorage + único fichero SQLite).

No hay "sincronización entre ventanas" (la misma conexión ejecutada en dos ventanas no se ve cruzada; cada una mantiene su HistoryPanel); no hay "gestor de ventanas"; no hay tope al número de ventanas, usa Mission Control / Exposé del SO.

---

## 13. Resumen de atajos de productividad

Mapeo por defecto (rebindeable en `Settings → Atajos`; `new-window` es del menú, no aparece en `COMMANDS`).

| Acción | macOS | Windows / Linux | ID del comando |
|---|---|---|---|
| Paleta | ⌘K | Ctrl+K | `palette` |
| Búsqueda de objetos | ⌘⇧O | Ctrl+Shift+O | `object-search` |
| Ejecutar SQL | ⌘+Enter | Ctrl+Enter | `run-sql` |
| Chat IA | ⌘⇧L | Ctrl+Shift+L | `ai-chat` |
| Nueva conexión / consulta / cerrar pestaña | ⌘N / ⌘T / ⌘W | Ctrl+N / T / W | `new-conn` / `new-query` / `close-tab` |
| Buscar / reemplazar / formatear SQL | ⌘F / ⌘H / ⌘⇧F | Ctrl+F / H / Shift+F | `find` / `replace` / `format-sql` |
| Guardar snippet / Settings | ⌘S / ⌘, | Ctrl+S / Ctrl+, | `save-snippet` / `settings` |
| Nueva ventana | ⌘⇧N | Ctrl+Shift+N | (menú) |
