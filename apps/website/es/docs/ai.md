# Asistente de IA

SkylerX divide la IA en **varios canales independientes** integrados en distintos puntos del producto; no hay un único chat que lo haga todo:

- **Panel de chat lateral** (`⌘⇧L`): conversación multi-turno + inyección de estructura + SQL listo para insertar/ejecutar
- **Autocompletado inline**: ghost text gris dentro del editor (estilo Copilot)
- **"Preguntar a la IA" en diagnóstico de errores**: botón en cualquier diálogo de error o en el área de resultados
- **AI Toolbox**: una entrada unificada para 7 prompts habituales
- **Diálogos especializados**: diagnóstico de salud / insights / diseño de tablas / inferencia inversa / comentarios / traducción / datos de prueba

Por debajo todos comparten **una abstracción de provider + 3 capas de memoria + IPC multicanal**. Esta sección se ciñe al código.

## 1. Resumen — multi-provider + canales paralelos

| Módulo | Archivo | Responsabilidad |
|---|---|---|
| `askAi()` / `askAiChat()` | `ai.ts` | Despacho por provider (Anthropic vs compatible OpenAI), petición HTTP (puede ir por IPC del main), cancelable |
| `pXxx()` prompts | `ai-prompts.ts` | 9 plantillas por dominio, montaje puramente con strings |
| Autocompletado inline | `aiInline.ts` | `InlineCompletionsProvider` de Monaco, debounce 600ms + AbortController |
| 3 capas de memoria | `memory.ts` | A perfil / B hechos / C memoria vectorial; unificado con `buildMemorySection()` en el system prompt |
| Panel de chat | `AiChatPanel.vue` | Drawer lateral derecho, inyección de schema + chat-bus |
| Diálogos especializados | `Ai*Dialog.vue` | Diagnóstico / insights / arquitecto / inversa / comentarios / datos de prueba |
| Traducción entre dialectos | `SqlTranslateDialog.vue` | Dos modos: SQL normal + procedimientos almacenados |

Todos los canales pasan por `askAi*` → IPC fetch → la misma configuración de provider. Cambiar de provider **actualiza al instante todos los canales**.

## 2. Configuración del provider

`Settings → AI Provider` admite 5 tipos:

| Provider | Protocolo | Endpoint |
|---|---|---|
| **Anthropic** | Anthropic Messages | `${baseUrl}/v1/messages`, autenticación `x-api-key` |
| **OpenAI** | OpenAI Chat | `${baseUrl}/v1/chat/completions`, autenticación `Authorization: Bearer` |
| **DeepSeek** | Compatible OpenAI | Igual |
| **Codex** | Compatible OpenAI | Igual |
| **Grok / xAI** | Compatible OpenAI | Igual |

Código real (`ai.ts → askAi`):

```ts
const provider = settings.aiProvider
const cfg = settings.aiProviders[provider]
if (!cfg?.apiKey?.trim()) throw new Error('NO_API_KEY')
if (provider === 'anthropic') return callAnthropic(o, cfg.apiKey.trim(), base, model)
return callOpenAiCompat(o, cfg.apiKey.trim(), base, model)
```

### Endpoints personalizados

Cada provider tiene su propio `baseUrl`:

| Caso | Configuración |
|---|---|
| Proxy Anthropic propio | provider=Anthropic, `baseUrl=https://tu-proxy.example.com` |
| Compatible OpenAI privado (vLLM / Ollama / one-api) | provider=OpenAI, edita `baseUrl` y `model` |
| DeepSeek directo | `https://api.deepseek.com`, `model=deepseek-chat` |
| Grok directo | `https://api.x.ai`, `model=grok-3-mini` |

### Cifrado de la API Key

La key viaja por el mismo llavero del SO que las contraseñas de conexión (macOS Keychain / Windows Credential / GNOME libsecret); en disco, `settings.aiProviders[*].apiKey` está cifrado.

### ¿IPC o fetch directo del navegador?

En escritorio, el preload expone `window.api.ai.fetch` (proxy del proceso principal, evita CORS del navegador y permite cancelación real). En web, fallback al `fetch` nativo. `ai.ts → aiBridge()` elige:

```ts
function aiBridge() {
  return globalThis.api?.ai ?? null
}
```

La ruta IPC además puentea el `AbortSignal` del renderer hacia `ai:cancel` del main: **cancelación real de peticiones en vuelo** (no solo descartar la respuesta):

```ts
const reqId = `r${Date.now()}-${random}`
init.signal?.addEventListener('abort', () => bridge.cancel?.(reqId))
```

## 3. Panel de chat lateral — AiChatPanel

`⌘⇧L` / `Ctrl+Shift+L` lo muestra u oculta. Se redimensiona arrastrando el borde izquierdo (`280-800px`) y el ancho persiste en `skylerx.aiChat.width`.

### Barra de contexto (arriba)

| Control | Función |
|---|---|
| **Selector de conexión** | A qué conexión apunta la conversación (define dialecto + origen del schema) |
| **Selector de base / schema** | MySQL usa `SCHEMATA`; PG usa `pg_namespace`; las bases del sistema se filtran |
| **Casilla "Adjuntar schema"** | Cuando se activa, consulta `information_schema.COLUMNS` y ensambla `tbl(col1 type, col2 type, ...)` para meter en el system prompt (límite 6000 caracteres) |
| **Nueva conversación / Limpiar** | Vacía el historial y arranca de cero |

### Implementación de la inyección de schema

MySQL → `information_schema.COLUMNS`; PG → `information_schema.columns`. Se agrupa por tabla en `tbl(col1 type, col2 type, ...)`, una línea por tabla; si supera 6000 caracteres, se trunca y se añade `-- (truncated)`. **Solo se envían nombre de tabla + nombre de columna + tipo; nunca datos**.

### Conversación multi-turno

Los mensajes viven en `localStorage` bajo `skylerx.aiChat.messages`, máximo 50. Cada `send()`:

```ts
const memorySection = await buildMemorySection(text)  // A/B/C 三层记忆
const reply = await askAiChat({
  messages: messages.value,           // 全量历史
  dialect: connOf(connId.value)?.dialect,
  schema: useSchema.value ? schemaText.value : undefined,
  memorySection,
  signal: controller.signal,
})
```

Tras la respuesta, en segundo plano:
- `autoExtractFacts({ user, assistant })` — la LLM extrae 1-3 hechos memorables → capa B
- `rememberVector(\`Q: ${user}\nA: ${assistant}\`)` — embeddings → capa C

### Cronómetro de "pensando" + aviso de bloqueo

`elapsedTimer` cuenta segundos (`12s`). Si pasa de 20s, se añade el aviso `maybeStuck` en rojo. El botón `[Detener]` invoca `controller.abort()` (en ruta IPC se aborta de verdad).

### Render especial de bloques SQL

`splitParts` parte por ` ``` `; los bloques SQL pasan por `editor.colorize` de Monaco (cacheado por hash de contenido en `sqlHtml`); el resto va por `renderMarkdown` (GFM).

Bajo cada bloque SQL, tres botones:

| Botón | Acción |
|---|---|
| `Copiar` | `navigator.clipboard.writeText` |
| `Insertar borrador` | `emit('insertSql', sql, connId)` → Workspace lo mete en QueryPane |
| `▶ Ejecutar` | Confirmación → `emit('runSql', ...)` → Workspace ejecuta |

### Badges de ejecución

Tras pulsar "Ejecutar", el bloque SQL muestra un badge (persistido en `skylerx.aiChat.runMarks`, máx. 200):

| Estado | Apariencia |
|---|---|
| `pending` | ⌛ fondo gris + "10:23 enviado" |
| `ok` | ✓ fondo verde + "10:23 ok" |
| `error` | ✗ fondo rojo + "10:23 fallo"; hover muestra el cuerpo del error |

Cuando QueryPane termina, dispara `onChatSqlExecuted` por bus de eventos y el panel del chat actualiza el badge.

### Selector de provider

El desplegable inferior solo lista los providers **con apiKey configurada** (evita seleccionar uno sin key y obtener `NO_API_KEY`); al lado, `⚙` emite `openSettings` y salta a la sección AI.

## 4. Autocompletado inline — aiInline.ts

`InlineCompletionsProvider` de Monaco, ghost text estilo Copilot. Se registra sobre el editor SQL:

```ts
monaco.languages.registerInlineCompletionsProvider('sql', provider)
```

### Estrategia de throttling

| Parámetro | Valor | Función |
|---|---|---|
| `DEBOUNCE_MS` | 600ms | Solo se llama al LLM tras 600ms de pausa |
| `MAX_PREFIX` | 2000 caracteres | Texto antes del cursor; trunca por la cola |
| Longitud mínima | 3 caracteres | `prefix.trim().length < 3` devuelve vacío |

Cada nuevo disparo **aborta el anterior**:

```ts
function clearPending() {
  if (!pending) return
  clearTimeout(pending.timer)
  pending.abort.abort()  // 真·取消上一个请求
  pending = null
}
```

Sin gastar quota y sin que un autocompletado viejo aparezca por sorpresa.

### Prompt + system prompt

```ts
const text = await askAiChat({
  messages: [{ role: 'user', content: buildPrompt(prefix, ctx) }],
  dialect: ctx.dialect,
  extraSystem: '你是 SQL 行内补全引擎。只输出光标处后续的 SQL 文本片段,'
             + '最多 1 行,不要带代码块、不要解释、不要重复已有上文。'
             + '如果上下文不足以补全,输出空字符串。',
  signal: abort.signal,
})
```

`buildPrompt` produce: `Dialecto: <d>\n\nSchema:\n<hint>\n\nContexto SQL (cursor al final):\n<prefix>`.

### Limpieza final (`sanitizeCompletion`)

- Elimina vallas ` ```sql ... ``` ` (a veces el modelo las añade)
- Si el modelo repite el prefix (empieza con los últimos 80 caracteres del prefix), se recorta
- Si responde varias líneas, solo se queda con la primera

### Aceptar / cancelar

| Tecla | Acción |
|---|---|
| `Tab` | Aceptar |
| `Esc` / `Backspace` / seguir tecleando | Cancelar (mecanismo de Monaco) |

### Interruptor maestro

Comparte `settings.enableCompletion` con el autocompletado SQL; si está apagado, no se llama al LLM. Los fallos son silenciosos (el inline no es mission-critical; si falla, no debe molestar al usuario).

## 5. Botón "Preguntar a la IA" para errores

Al fallar la ejecución, **cualquier alert o barra de error** lleva el botón `✨ Preguntar a la IA`. Pulsarlo dispara `AiChatPanel.askAboutError()`:

```ts
async function askAboutError(p: { connId, connName?, sql, error }) {
  controller?.abort()             // 1) 中断当前对话
  for (let i=0; i<30 && running.value; i++) await sleep(50)  // 等 finally 跑完
  connId.value = p.connId         // 2) 切到出错的连接
  useSchema.value = true          // 3) 强制启用 schema 上下文
  saveToStorage()
  const msg = `${t('aichat.askAiPrompt')}\n\n**连接**: ${p.connName}\n\n**SQL**\n\`\`\`sql\n${p.sql}\n\`\`\`\n\n**Error**\n\`\`\`\n${p.error}\n\`\`\``
  input.value = msg
  if (switching) await sleep(200) // 4) 等 schema 异步加载
  if (!schemaText.value) await loadSchema()
  await send()
}
```

### Formato del mensaje

El mensaje que se envía es algo así:

```markdown
请帮我看下这个 SQL 报错,给出可能的原因和修复建议。

**连接**: prod-mysql

**SQL**
```sql
INSERT INTO orders(user_id, amount) VALUES (42, 99.9)
```

**Error**
```
ERROR 1452 (23000): Cannot add or update a child row:
a foreign key constraint fails (`shop`.`orders`, CONSTRAINT `fk_user` ...)
```

Con la schema inyectada (que ya incluye `users(id int, ...)` y `orders(...)`), la IA suele identificar al segundo "el `user_id=42` no existe en `users.id`".

### Bus chat-bus

Este mecanismo lo usa más gente, no solo el chat: `MockDataDialog`, al fallar, también usa el bus para mostrar `askAi`:

```ts
toast.error(`执行失败: ${errMsg}`, {
  askAi: { sql: stmt, error: errMsg, connId, connName, dialect },
})
```

`ChatErrorAskEvent` es la forma unificada; cualquier punto que falle puede ofrecer "Preguntar a la IA" sin repetir implementación.

## 6. AI Toolbox (7 prompts especializados)

`🛠 AI Toolbox` o `⌘K → AI Toolbox`. Un diálogo cubre 7 tareas; al elegir y pulsar "Ejecutar con IA", se cierra el modal y el prompt se envía al panel de chat lateral.

| Toolbox | Plantilla | Entrada | Salida |
|---|---|---|---|
| **Escribir migración** | `pMigration` | Tabla destino + descripción del requisito | Tres bloques `\`\`\`sql` independientes: ALTER directo / rollback / migración de datos |
| **Optimizar SQL** | `pOptimizeSql` | SQL original + EXPLAIN opcional | Diagnóstico → propuesta reescrita (SQL) → recomendación de índices (SQL) → beneficio esperado |
| **Interpretar EXPLAIN** | `pExplainAnalysis` | SQL + EXPLAIN | Explicación nodo a nodo + "conclusión + lo que más vale la pena tocar" |
| **Generar datos de prueba** | `pTestData` | Tabla + nº de filas + contexto de negocio | Un único bloque `\`\`\`sql`, INSERTs fila a fila, FK-aware |
| **NL → SQL** | `pNl2Sql` | Descripción en lenguaje natural | Un único bloque `\`\`\`sql`; ante ambigüedad usa la lectura más común y la marca |
| **Documentación de columnas** | `pDataDictDoc` | Tabla + CSV de columnas | Tabla Markdown de 3 columnas: campo / tipo / significado |
| **Explicar el propósito de la tabla** | `pExplainTable` | Tabla + columnas + pistas de FK | Párrafo ≤ 200 caracteres + 3 bullets (quién inserta / quién lee / estrategia de borrado) |

### Campos del formulario

| Tarea | Requiere tabla | Requiere SQL | Requiere EXPLAIN | Extra |
|---|---|---|---|---|
| migration | ✓ | | | Texto del requisito |
| optimize | | ✓ | (opcional) | |
| explain-analysis | | ✓ | ✓ | |
| test-data | ✓ | | | nº filas + contexto |
| nl2sql | | | | Texto del requisito |
| doc | ✓ | | | Auto-extrae CSV |
| explain-table | ✓ | | | Auto-extrae CSV |

Al enviar, `pXxx(...)` arma el prompt → `emit('submit', { prompt, connId, connName, withSchema: true })` → Workspace lo manda a `AiChatPanel.askPredefined(...)`, igual que `askAboutError`.

### Notas de diseño

- El requisito original ("añade columna / renombra / optimiza") se conserva sin traducción para no perder semántica
- El contexto (SQL / nombre de tabla / EXPLIN) entra como bloque Markdown, más fácil de identificar para la IA
- El formato esperado es explícito ("dame ALTER + ALTER inverso + migración de datos") para evitar idas y vueltas
- Salida estrictamente formateada (tres bloques `\`\`\`sql` + títulos H3) permite al frontend trocear de forma estable

## 7. AI Health Check — Diagnóstico de la base

Barra → `❤️ Health Check`. Al abrirse, ejecuta cuatro pasos:

1. **Recolectar metadatos** — 3 SQL en paralelo:
   - MySQL: `COLUMNS / STATISTICS / KEY_COLUMN_USAGE` (filtra `REFERENCED_TABLE_NAME IS NOT NULL`)
   - PG: `information_schema.columns + pg_index + pg_class` + subconsulta de FK
2. **Serializar** — agrupa por tabla en texto compacto (columns / indexes / FKs)
3. **Enviar a la IA** — arma el prompt con `pHealthCheck`, llama a `askAiChat`
4. **Renderizar** — el Markdown se divide por H2 en 6 tarjetas

### 6 categorías de antipatrones (`pHealthCheck`)

| Sección | Título | Qué hace la IA |
|---|---|---|
| 1 | Columnas de filtro frecuente sin índice | Heurística sobre `status / created_at / user_id / type / is_* / *_at` y otras candidatas a filter/sort sin índice |
| 2 | Nombre tipo FK pero sin restricción | `xxx_id` / `xxxId` cuya tabla no tiene FOREIGN KEY → señala posibles padres |
| 3 | Estilo de nombres mezclado | snake_case + camelCase mezclados en la tabla o la base; sugiere unificar |
| 4 | Tipos demasiado grandes | `VARCHAR(255)` para strings cortas / `BIGINT` para enteros pequeños / fechas como `VARCHAR` |
| 5 | Tablas/columnas clave sin comentario | `user / order / payment / account` sin COMMENT; sugiere columnas críticas |
| 6 | Soft-delete sin índice | `deleted_at / is_deleted` sin estar indexada → propone `CREATE INDEX` |
| Conclusión | — | 3-5 acciones priorizadas por relación impacto/coste |

**Salida estricta**: obligatoriamente seis H2 (`## 1.` ~ `## 6.`) para que el frontend trocee en tarjetas; las secciones sin hallazgos también deben tener título y escribir "Sin hallazgos significativos".

### Recolección de metadatos

MySQL: `information_schema.COLUMNS / STATISTICS / KEY_COLUMN_USAGE`; PG: `information_schema.columns + pg_index/pg_class + table_constraints` con subconsulta FK; tres SQL en paralelo (cada uno limita ~5000 filas). El prompt corta los metadatos a ~12K caracteres para no explotar la ventana de tokens; solo soporta familias MySQL / PG.

## 8. AI Insights — SQL lento + raíz del error

Dos pestañas; basta pegar el SQL o el error (sin necesidad de conexión):

### Tab 1: Optimización de SQL lento

Entrada: SQL (obligatorio) + EXPLAIN (opcional) + estadísticas o nº de filas (opcional). La IA produce 4 bloques: puntos sospechosos (full scan / sin índice / cartesiano / conversión implícita / estadísticas obsoletas) → índices recomendados (`CREATE INDEX`) → propuestas de reescritura (cubriente / subconsulta → JOIN / equivalencias) → mejora estimada.

`extraSystem`: `You are a database performance expert. Be specific and reference actual cost trade-offs.`

### Tab 2: Raíz del error

Entrada: mensaje (obligatorio) + contexto (opcional: SQL ejecutado / hora / usuario). La IA produce: significado del error (traducido a lenguaje humano) → 3 causas más probables (por probabilidad) → pasos para diagnosticar → plan de reparación.

`extraSystem`: `You are an SRE/DBA. Be practical, prioritize quick mitigation.`

Diferencia con "Preguntar a la IA": Insights es un **deep dive manual** (estudias un error); el botón es **un clic que asocia el SQL actual + error + schema de la conexión activa** al chat para seguir la conversación.

## 9. AI Schema Architect — Diseñar tablas

Asistente conversacional. Le das un requisito de negocio → produce el DDL completo de varias tablas + FK + índices, iterable.

### System prompt (fijo en el componente)

```text
You are a senior database architect. The user describes a business domain (in any language).
Your job:
1. Design multiple related tables (with primary keys, foreign keys, indexes,
   sensible types for the <dialect> dialect).
2. Output a single ```sql code block containing the COMPLETE CREATE TABLE statements
   (including foreign keys and indexes) so the user can copy-paste-run.
3. Explain key design decisions briefly in 2-4 bullet points.
4. When the user asks to revise, output the FULL updated SQL again (not just a diff)
   — they will execute the whole block.

Stay concise. Prefer normalized design unless user asks for denormalized.
```

### Flujo

1. El usuario describe el negocio (`"Sistema de pedidos: usuarios, productos, pedidos, líneas, cupones"`)
2. `askAiChat({ messages, dialect, extraSystem })` devuelve Markdown
3. `extractAllSql(reply)` saca todos los bloques `\`\`\`sql` como `sqlBlocks`
4. Iteración → se reenvía todo el historial → la IA devuelve **la versión completa** (no diff; obligado en el system prompt)

### Ejecución en un clic

El botón inferior `▶ Ejecutar la versión más reciente` toma todos los `sqlBlocks` de la última respuesta, los une, los pasa por `splitStatements` y los ejecuta uno a uno con `client.connections.execute`. Confirmación que muestra cuántos `CREATE` + base destino.

## 10. AI Schema Reverse — Inferencia inversa

Le das CSV / TSV / JSON de muestra → la IA infiere el schema → produce `CREATE TABLE` + INSERT opcional.

### Entrada

| Campo | Descripción |
|---|---|
| Formato | CSV / TSV / JSON |
| Nombre de tabla | Por defecto `inferred_table`; modificable |
| Datos de muestra | Bastan unas filas; con cabecera/nombres es más preciso |
| Generar también INSERT | Checkbox; si se marca, el prompt añade "5. Genera el INSERT con todos los datos" |

### Estructura del prompt

```text
请基于下面的 CSV 示例数据,反向推断 schema 并生成 mysql 方言的 CREATE TABLE SQL...

要求:
1. 推断每列**最合适**的类型(考虑长度、是否纯数字、是否日期、是否 enum 等)
2. 推断哪些列适合做**主键**(自增 vs 业务键)、哪些**必须 NOT NULL**
3. 推荐 1-2 个**索引候选**(基于经验:外键样的列、常用过滤列)
4. 表名: `inferred_table`

示例数据:
```
id,name,email,created_at
1,alice,a@x.com,2026-01-01
...
```

请严格按这个结构输出:

### 推断说明
(列名 → 类型 → 理由,2-3 句)

### CREATE TABLE
```sql
CREATE TABLE ...
```

### 索引建议
- ...
```

### Editar y ejecutar

El SQL devuelto se carga en una caja editable (`sqlEdit`); tras tus retoques pulsa `▶ Ejecutar` → confirmación → `splitStatements` → ejecución secuencial.

## 11. AI Comment Writer — Escribir comentarios

Clic derecho en la tabla → `💬 AI Comment` o desde la barra. Flujo:

1. **Listar columnas** — MySQL con `information_schema.COLUMNS` (name / type / nullable / default / comment); PG añade `pg_catalog.col_description` para los comentarios existentes
2. **Serializar** — arma `columnsCsv`: `- col type [NOT NULL] [DEFAULT ...]`
3. **Enviar a la IA** — `pComment(ctx, columnsCsv)` exige **un único bloque `\`\`\`json`**
4. **Parsear** — extrae el JSON → `[{ col, comment }]`
5. **Tabla comparativa** — comentario actual vs sugerencia; checkbox por fila
6. **Aplicar** — genera ALTER:
   - MySQL: `ALTER TABLE ... MODIFY <col> <type> [NOT NULL] [DEFAULT ...] COMMENT '...'` (hay que devolver tipo / nullable / default para no perderlos)
   - PG: `COMMENT ON COLUMN <table>.<col> IS '...'`

### Restricción del prompt (`pComment`)

El prompt obliga: **un único bloque `\`\`\`json` sin texto adicional**; cada elemento `{ "col": "nombre", "comment": "frase de negocio" }`; `col` se copia tal cual (case-sensitive, no se traduce); `comment` ≤ 30 caracteres; si no se sabe, `"?(sugerir manualmente)"`; **lista todas las columnas** (incluso `id / created_at`).

La salida estricta permite a `parseSuggestion()` extraer con regex estable ` ```json ... ``` `; si falla, fallback a tratar el texto completo como JSON crudo. Como `col` se conserva, casa con el estado actual sin desalinearse.

### Comentario de la tabla

Además de las columnas, puedes generar el comentario de la tabla: MySQL `ALTER TABLE ... COMMENT='...'`; PG `COMMENT ON TABLE ... IS '...'`.

## 12. Traducción de SQL — SqlTranslateDialog

`🌐 Translate`. Cuatro dialectos fijos: `mysql / postgresql / sqlserver / oracle`.

### Dos modos

| Modo | Prompt |
|---|---|
| **SQL** (consulta normal / DDL) | `pTranslate(from, to, sql)` |
| **Procedimientos / Funciones** | `pTranslateProcedure(from, to, code)` — añade parámetros / BEGIN-END / DECLARE / manejo de errores / cursores / DELIMITER |

`extraSystem` también cambia:

- SQL: `You are a senior SQL polyglot. Translate SQL across dialects precisely; flag every non-portable construct honestly.`
- Procedimientos: `You are a senior SP/PL/SQL polyglot. Translate stored procedures faithfully; preserve control flow and explicit error handling.`

### Restricción de salida (`pTranslate`)

Tres bloques obligatorios:

1. **SQL traducido** — un bloque `\`\`\`sql`, una sola sentencia, sin explicaciones
2. **`### Advertencias`** — bullets con lo no portable (`MySQL ON DUPLICATE KEY UPDATE` → `PG ON CONFLICT DO UPDATE`, semánticamente cercano pero con detalles distintos; `DATETIME vs TIMESTAMP`; `NVARCHAR vs NVARCHAR2`; paginación / autoincremento / concatenación / estilo de comillas; conversiones implícitas, orden de NULL); si no aplica, "Sin sintaxis no portable evidente"
3. **`### Sugerencias`** — bullets con escrituras más idiomáticas en el dialecto destino (CTE / `LIMIT OFFSET` / `COALESCE` en lugar de `IFNULL`); si nada, "Traducción literal suficiente"

Los H3 permiten al frontend trocear el render.

### Render en dos columnas

| Izquierda | Derecha |
|---|---|
| `extractSql(answer)` saca el SQL traducido → Monaco `colorize` + `Copiar` | Markdown restante tras quitar el primer `\`\`\`sql` (advertencias + sugerencias) → `renderMarkdown` |

### Detalles

- `swapDialects()`: intercambia from/to con un clic, útil para traducir y volver
- **Atajo mismo dialecto**: si `from === to`, responde un texto "No requiere traducción" sin gastar petición
- Durante la traducción se puede `controller?.abort()`

## 13. AI Mock Data — Datos de prueba FK-aware

Clic derecho en la tabla → `🧪 Generar datos de prueba`. El núcleo es un **motor de reglas** (`mockgen.ts` infiere `SemanticKind` por nombre + tipo SQL); la IA participa en dos puntos:

### 13.1 `aiInfer()` — Que la IA proponga el tipo semántico de todas las columnas a la vez

Botón `✨ Inferir con IA`. El prompt está en inglés (el modelo es más estable con JSON instruction en inglés) y restringe:

- Elegir solo de la whitelist `SEMANTIC_KINDS` (`auto / integer / decimal / money / name_cn / phone_cn / id_card_cn / address_cn / email / enum / lorem_cn / ...`); cualquier otro es inválido
- Para contexto chino (`name/姓名 / 手机/phone / 身份证 / 地址`), preferir variantes `_cn`
- **Prohibido** `auto` (genera texto aleatorio sin sentido); hay que escoger un tipo concreto
- `money/price/amount/cost` → `money`; `decimal/float` → `decimal`
- PK enteras marcadas `[PK]` → `integer` (el generador autoincrementa); `status/state/role` → `enum`; `description/content/remark/note` → `lorem_cn`
- **Solo se imprime** un object JSON tipo `{"user_id":"integer","name":"name_cn","mobile":"phone_cn"}`

Tras la respuesta, `/\{[\s\S]*\}/` extrae el primer JSON (tolera texto suelto); cada entrada se valida contra la whitelist + columnas de `baseColumns`.

### 13.2 Mostrar "Preguntar a la IA" cuando falle la ejecución

Si el INSERT falla (NOT NULL ausente / FK inexistente / tipo no concuerda), el toast trae el botón `askAi`, que envía sentencia + error + info de conexión al chat por el chat-bus.

La generación real del INSERT corre a cargo de `buildMockInserts(dialect, tableRef, columns, count)` (en chunks de 100 filas); la IA **no genera** el SQL, solo **infiere semántica** y **diagnostica errores**.

## 14. Memoria de tres niveles — memory.ts

Se configura en `Settings → AI → Memoria`; cada conversación la inyecta en la cabecera del system prompt (los modelos son más sensibles al contexto temprano).

| Nivel | Nombre | Formato | Uso | Disparo |
|---|---|---|---|---|
| **A** | `aiCustomInstructions` | Texto libre | Identidad / preferencias a largo plazo | Inyección completa cada turno |
| **B** | `aiFacts` | `{id, text, createdAt}[]` | Hechos estructurados | Inyección completa cada turno; si `aiAutoExtractFacts` está activo, se extraen 1-3 por turno |
| **C** | `aiVectorMemories` | `{id, text, vec, createdAt}[]` | Notas masivas | Top-K por similitud coseno (por defecto `aiVectorTopK`); solo se usa si score > 0.3 |

### Orden de ensamblado de `buildMemorySection(query)`

Bloque Markdown en orden A → B → C:

- A: `## User profile & preferences` + texto libre
- B: `## Known facts` + lista
- C: `## Relevant past notes` + lista (requiere query + endpoint de embeddings; `recallRelevant(query)` toma top-K con umbral > 0.3)

### Configuración de embeddings

C necesita endpoint de embeddings. `Settings → AI → Memoria`:

| Campo | Default |
|---|---|
| `aiEmbeddingBaseUrl` | (vacío; el usuario lo rellena) |
| `aiEmbeddingApiKey` | (vacío) |
| `aiEmbeddingModel` | `text-embedding-3-small` |

La petición usa el endpoint OpenAI compatible `${base}/v1/embeddings`; DeepSeek / Grok también encajan. Las peticiones cortas de embedding tienen timeout de 15s para no frenar el chat.

### Truncado LRU

Capacidad de C limitada a 1000 entradas; las más antiguas se descartan:

```ts
if (settings.aiVectorMemories.length > 1000) {
  settings.aiVectorMemories.splice(1000, settings.aiVectorMemories.length - 1000)
}
```

### Extracción automática de hechos (nivel B)

Si `aiAutoExtractFacts` está activo, tras cada turno `autoExtractFacts({ user, assistant })` pide al LLM extraer **≤ 3 hechos memorables** (`"usa MySQL 8"` / `"trabaja en el schema 'orders'"` / `"prefiere snake_case"`), descartando ephemeral; si responde `none` no se guarda nada; si falla, silencioso (no debe bloquear la conversación). `extraSystem`: `You are a memory curator. Output bullet list of durable facts only.`

## 15. Privacidad y seguridad

| Comportamiento por defecto | Detalle |
|---|---|
| API Key cifrada | En el llavero del SO (macOS / Windows / libsecret en Linux) |
| La API Key nunca sale del equipo | En escritorio va por IPC directo al proveedor; en web por el navegador (modificable vía baseUrl con tu proxy) |
| Por defecto **no se envían datos** | "Adjuntar schema" está desactivado; al activarse, solo se envía el resumen `tbl(col1 type, col2 type, ...)`, no filas |
| Límite de 6KB del schema | Excedente se trunca con `-- (truncated)`, sin reventar la ventana |
| `request log` auditable | `Settings → AI → Log de peticiones` (registro completo en ruta IPC del escritorio) |
| El botón "Preguntar a la IA" indica claramente qué se envía | SQL completo + código de error + metadatos de conexión + hint de schema |

## 16. Control de costes

| Aspecto | Cómo |
|---|---|
| Cambiar provider | Desplegable del panel de chat / `⌘K → Cambiar provider` |
| Cambiar modelo | `Settings → AI Provider → <provider> → model` (modelos baratos para inline + Health Check; potentes para arquitecto / traducción) |
| Apagar inline | `Settings → Autocompletado`, reutiliza `enableCompletion` (consume muchos tokens, apaga si quieres) |
| Apagar memoria vectorial | `Settings → AI → Memoria → Memoria vectorial` (cada conversación llama a embeddings; apagar ahorra tokens) |
| Apagar extracción automática de hechos | `aiAutoExtractFacts` apagado evita la petición extra por turno |
| Contexto largo vs corto | Activa "Adjuntar schema" solo cuando preguntes por la base (preguntas tipo "explica esta sintaxis SQL" no lo necesitan) |

---

## 17. Comparativa rápida

| Quiero… | Qué canal uso |
|---|---|
| Conversar a varios turnos | **AiChatPanel** |
| Que el editor me autocomplete | **Autocompletado inline** (`aiInline.ts`) |
| Diagnosticar un error rápido | **Botón "Preguntar a la IA"** (chat-bus) |
| Generar migración / optimización / EXPLAIN para una tabla | **AiToolboxDialog** |
| Escanear antipatrones de toda la base | **AiHealthCheckDialog** |
| Hacer deep dive sobre un SQL lento o un error | **AiInsightsDialog** |
| Diseñar varias tablas desde un requisito | **AiSchemaArchitectDialog** |
| Inferir schema a partir de datos de muestra | **AiSchemaReverseDialog** |
| Escribir comentarios para todas las columnas | **AiCommentDialog** |
| Traducir SQL / procedimiento entre dialectos | **SqlTranslateDialog** |
| Poblar tabla con datos de prueba (semántica + FK-safe) | **MockDataDialog** |
| Dar memoria de largo plazo a la IA | **memory.ts → niveles A/B/C** |

Combínalo con [Avanzado](./advanced) y multiplicas la potencia: si no entiendes un EXPLAIN, preguntas a la IA; si dudas con la recomendación de índices, le pides interpretación; si haces migración Oracle → DM, le encargas evaluar el riesgo de las advertencias de traducción.
