# Flujos de datos: importar / exportar / backup / migración

SkylerX concentra todos los caminos por los que los datos "entran o salen" en un conjunto de diálogos uniformes: comparten el `SaveFileDialog` propio (idéntico en todas las plataformas, no usa el nativo del SO) y todo el parseo (CSV/JSON/Excel) ocurre en memoria del renderer. Este capítulo se ordena en "salida → entrada → backup/restauración → migración entre bases → diccionario de datos → comparación de datos".

## 1. Resumen: qué cubre este apartado

| Escenario | Entrada | Diálogo / función principal | Formatos |
|---|---|---|---|
| Copiar una o varias filas al vuelo | Clic derecho en la cuadrícula → "Copiar como" | `ResultGrid.vue::copyRows` | CSV / TSV / JSON / Markdown / SQL VALUES |
| Descargar una tabla o un schema completo | NavTree clic derecho "Exportar SQL" → `ExportOptionsDialog` | `Workspace.vue::doTableExport` / `doSchemaExport` | SQL (CREATE + INSERT) |
| Mover un workspace entero | Paleta `act:export-conns` / `WorkspaceExportDialog` | `WorkspaceExportDialog.vue` | `.skylerxws` JSON |
| Cargar CSV/JSON/Excel a una tabla | NavTree clic derecho "Importar datos" → `ImportDialog` | `ImportDialog.vue` + `io.ts` | CSV / TXT / JSON / NDJSON / XLSX |
| Pegar directo del portapapeles desde Excel/Feishu | ⌘V en el área principal (o `PasteImportDialog`) | `PasteImportDialog.vue` | TSV / CSV |
| Ver un `.ndjson` directamente | Paleta `act:ndjson-viewer` | `NdjsonViewerDialog.vue` | `.ndjson` / `.jsonl` |
| Backup / restauración de toda la base | Paleta `act:backup:<id>` (una por conexión) | `BackupRestoreDialog.vue` | `.sql` / `.ndjson` |
| Copiar una tabla entre conexiones | NavTree clic derecho "Transferencia de datos" | `DataTransferDialog.vue` | SELECT por filas → INSERT por lotes |
| Generar diccionario de datos | NavTree clic derecho schema/db → "Diccionario de datos" | `Workspace.vue::genDataDict` + `dump.ts` | Markdown / HTML |
| Comparar datos de dos tablas | Paleta `act:data-diff` | `DataDiffDialog.vue` + `data-diff.ts` | Diff por filas → SQL de sincronización |

Las operaciones de archivo van todas por `client.files` (implementado en el proceso principal: `openText / saveText / listDir / commonDirs / mkdir`). En la web, `listDir` no está disponible y se cae al modelo descarga/subida del navegador (solo formatos de texto).

## 2. Exportar

### 2.1 Copiar el resultado en varios formatos

En `ResultGrid.vue`, clic derecho sobre celda/selección abre el submenú "Copiar como":

| Opción | Implementación | Uso |
|---|---|---|
| CSV | `io.ts::toCSV` | Pegar directamente como tabla en Excel / Numbers |
| TSV | `io.ts::toTSV` | Excel / Notion / Feishu Sheet (separador `\t`) |
| JSON | `io.ts::toJSON` | `JSON.parse` en código; `Date` → `toISOString()` automático |
| Markdown | `io.ts::toMarkdown` | Pegar tablas en documentación / descripción de PR (escapa `|` y saltos) |
| SQL VALUES | `io.ts::toSqlValuesList` | `(1, 'a'), (2, 'b')` listo para `INSERT...VALUES` / `VALUES (...) AS t` / `ON CONFLICT ... EXCLUDED` |
| SQL INSERT | `io.ts::toInsertSql` | `INSERT INTO tbl (...) VALUES (...)` ejecutable, una fila por sentencia |

**Detalles de restauración de tipos** (en `io.ts`):

- `null/undefined` → vacío (CSV) / `NULL` (SQL)
- `Date` → `toISOString()`
- `number` → directo; `Infinity/NaN` degradan a `NULL` en SQL
- `boolean` → `TRUE/FALSE` en SQL (en SQLite se vuelve a traducir a `1/0`)
- `object/array` → `JSON.stringify` y envuelto con comillas simples en SQL
- Las comillas simples `'` se duplican siempre (`a'b` → `'a''b'`) para evitar inyección

CSV solo añade comillas si la celda contiene `"`, `,` o salto de línea; TSV solo si hay `\t`, salto o `"`; no se entrecomilla a ciegas para mantener limpias las celdas al pegar en Excel.

### 2.2 ExportOptionsDialog — exportación completa de tabla / schema

Clic derecho en una tabla o un schema → "Exportar SQL"; primero aparece un diálogo binario `ExportOptionsDialog`:

- **Solo estructura** → `withData = false`, solo genera `CREATE TABLE`
- **Estructura + datos** → `withData = true`; tras el CREATE, hace `SELECT * FROM ref` y añade el listado de `INSERT`

Recibido el `pick`, `Workspace.vue` ejecuta `doTableExport` / `doSchemaExport`:

1. `client.connections.metadata(... group: 'columns')` para las columnas
2. `dump.ts::buildCreateFromColumns` **reconstruye `CREATE TABLE`** a partir de los metadatos (v1 con PK; sin índices ni FK porque sus sintaxis cambian demasiado entre dialectos)
3. Si `withData` está activo, `SELECT * FROM ref` (sin paginación; para tablas enormes usa backup/migración)
4. `buildTableDump` ensambla:

   ```sql
   -- 表结构
   CREATE TABLE `users` (...);

   -- 数据(N 行)
   INSERT INTO `users` (...) VALUES (...);
   ```

5. Nombre de archivo por defecto `<objeto>.sql`, extensión fija `.sql`; `client.files.saveText` lanza el `SaveFileDialog` propio para que elijas ruta

La exportación de un schema entero itera todas las base tables y antepone una línea `-- ws.dumpHeader { label, n }` con la metadata.

### 2.3 Exportación completa del workspace (`.skylerxws`)

`WorkspaceExportDialog.vue` cubre los escenarios "cambio de equipo / compartir con compañeros". Estructura del archivo:

```ts
interface WorkspaceFile {
  version: 1
  exportedAt: number
  source: string                  // 'SkylerX'
  connections?: ConnectionConfig[]
  snippets?: typeof snippets
}
```

Opciones de exportación (cada una independiente):

| Opción | Por defecto | Descripción |
|---|---|---|
| Incluir conexiones | ✓ | Usa `client.connections.list()`; por defecto **sin secretos** (sin contraseñas) |
| ⚠ Incluir contraseñas | ✗ | Si lo marcas, llama uno a uno a `client.connections.get(id)` para extraer texto plano. El archivo se descifra en otra máquina sin depender del keychain, pero el archivo en sí queda en plano: usar con cuidado |
| Incluir SQL Snippets | ✓ | Copia entera del JSON, sin renombrar IDs |

Nombre por defecto `skylerx-workspace-YYYY-MM-DD.skylerxws`; el filtro acepta `.skylerxws` y `.json`.

Al importar, se cuenta "Conexiones + Snippets" → confirmación → fusión según la estrategia de conflictos:

- **skip**: omite duplicados por nombre (por defecto)
- **overwrite**: mismo `name` con dup.id; ejecuta `update` y sobreescribe todos los campos (contraseña incluida, si está en el archivo)
- **rename**: sufija `name` con `(importado)` y crea como nuevo

### 2.4 Exportación cifrada `.sql.enc` (AES-256-GCM + PBKDF2)

`export-encrypt.ts` ofrece una API de funciones puras; la UI la llama según contexto (caso típico: enviar a un colaborador externo un dump SQL con datos sensibles). Decisiones:

| Aspecto | Valor | Justificación |
|---|---|---|
| Magic del archivo | `SKYLERX-ENC-v1` | Identifica versión al cambiar de algoritmo |
| KDF | PBKDF2-HMAC-SHA-256 | Nativo en navegador / Node, sin dependencias |
| Iteraciones | `DEFAULT_ITER = 200_000` | OWASP 2023 recomienda ≥ 600k; se compromete con máquinas viejas y se puede subir luego |
| Algoritmo | AES-GCM | Etiqueta de autenticación de 128 bits; contraseña errónea o archivo alterado lanzan `WRONG_PASSWORD` |
| Tamaño de clave | 256 bit | `deriveKey` produce AES-GCM 256 |
| Salt | 16 bytes aleatorios | Nuevo en cada cifrado |
| IV | 16 bytes aleatorios | Nuevo en cada cifrado |
| Serialización | JSON en una línea | Cómodo para lectura/escritura en streaming; `.sql.enc` legible a ojo en editor |

Formato persistido (una línea JSON):

```json
{ "magic": "SKYLERX-ENC-v1", "salt": "<b64>", "iv": "<b64>", "iter": 200000, "data": "<b64-cipher+tag>" }
```

Detalles de implementación:

- Usa `globalThis.crypto.subtle`, **sin dependencias de terceros**; si un Node antiguo carece de subtle, lanza error pidiendo actualizar runtime
- Los `Uint8Array` se respaldan con `new ArrayBuffer(n)` para esquivar el error de tipos por la restricción de `BufferSource` en TS 5.7 + lib.dom
- La codificación base64 se hace en bloques de 32 KB para no reventar la pila con `String.fromCharCode(...bytes)` en archivos grandes
- Al descifrar, cualquier fallo de validación GCM se traduce a `WRONG_PASSWORD` para **no filtrar** el `OperationError` original y evitar canales laterales

## 3. Importar

### 3.1 ImportDialog — asistente de 3 pasos para CSV / JSON / NDJSON / Excel

NavTree clic derecho en una tabla → "Importar datos"; `ImportDialog.vue` es un wizard de 3 pasos fijos (`step: 'pick' | 'map' | 'run'`).

#### Paso 1: elegir archivo

- Botón principal "Seleccionar archivo" → `client.files.openText`, filtros `csv / txt / json` (el JSON se detecta por `\.json$/i` o por el primer carácter `[`/`{` para usar `parseJSON`)
- Botón secundario "Excel…" → usa el `<input type=file>` del renderer; lee `ArrayBuffer` y **carga dinámicamente** `xlsx` (SheetJS). Solo lee la primera hoja, `raw: false` (toma el valor mostrado en Excel; las fechas no se convierten en número) y `defval: ''`. Va por canal binario, así que archivos grandes no saturan el IPC
- Tras parsear, se muestra una preview con las primeras 5 filas; la casilla "Cabecera en la primera fila" se puede alternar

`io.ts::parseCSV` es una máquina de estados a mano: BOM, escape `""`, CRLF / LF, comillas con comas o saltos dentro. Al final descarta filas con un único campo vacío.

`io.ts::parseJSON` soporta tres formas:

- **Array de objetos**: las claves (en orden de aparición) son la cabecera
- **Array de arrays**: la primera fila es la cabecera
- **Objeto único**: lo trata como 1 fila

#### Paso 2: mapeo de columnas + inferencia de tipos

`autoMap()` empareja columnas origen/destino por "minúsculas y igualdad exacta". Cada columna tiene un desplegable manual; "Omitir" = `-1`.

La inferencia `inferType(srcIdx)` muestrea los **primeros 50 valores no vacíos** y aplica en orden:

| Inferencia | Regex |
|---|---|
| `number` | `/^-?\d+(\.\d+)?$/` |
| `date` | `/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?Z?$/i` |
| `boolean` | `/^(true|false|t|f|y|n)$/i` |
| `string` | fallback |

Si hay cadenas vacías, se marca `nullable` (en UI: marca `·∅`). **Nota**: la inferencia es solo informativa; en la ejecución se inserta siempre como string y el casteo real corre por cuenta del motor de la BD; así se toleran las diferencias entre dialectos (MySQL convierte `'2024-01-01'` a DATE, SQLite lo trata como TEXT).

#### Paso 3: opciones + ejecución

| Opción | Por defecto | Comportamiento |
|---|---|---|
| TRUNCATE antes de importar | ✗ | Inserta `TRUNCATE TABLE <ref>` antes del INSERT; usar con cuidado, **no se puede revertir** (TRUNCATE en MySQL/PG es DDL) |
| Filas por lote | 200 (min 1, max 2000) | Controla cuántas filas por `INSERT INTO t (...) VALUES (...), (...), ...` para no chocar con límites del driver |

La ejecución va por `client.connections.executeBatch`; las cadenas vacías del origen (`''`) se tratan como `NULL` (en `io.ts::buildInsertStatements`: `s == null || s === '' ? 'NULL' : ...`); por eso **no se distingue "cadena vacía real" de "sin valor"** al importar. Si necesitas esa distinción, hazlo a mano desde el editor SQL.

### 3.2 PasteImportDialog — pegado directo

`PasteImportDialog.vue` es la versión ligera del ImportDialog: al abrir, llama a `navigator.clipboard.readText()` sin selector de archivo.

| Entrada | Ruta de parseo |
|---|---|
| Contiene `\t` | TSV (formato de copia por defecto en Excel / Feishu Sheet); split por `\t` |
| Sin `\t` | CSV simple a mano (soporta escape `""`, pero **no comillas anidadas complejas**; si las hay, cae al ImportDialog) |

Las columnas de la tabla destino se obtienen en directo de `information_schema.columns` (MySQL / MariaDB / OB / TiDB / Doris / StarRocks vía `table_schema + table_name`; PG y otros vía `table_name + table_catalog`). El emparejamiento es por normalización (`toLowerCase + sin _-espacios`); el resto se elige a mano, vacío = omitir.

Tamaño de lote fijo `BATCH = 500`, cada uno arma un `INSERT INTO ... VALUES (...), (...)`; `sqlLiteral` simplifica: vacío → `NULL`, números directos, el resto entre comillas simples (`'` se duplica). **Los dialectos no SQL (Redis / docs) se filtran antes** (solo conexiones con `dialectKind === DbKind.Sql`).

Caso de uso: pegar decenas a miles de filas desde Feishu/Excel. Para más volumen usa el ImportDialog (`executeBatch`) o el DataTransferDialog (paginación).

## 4. Visor NDJSON (`NdjsonViewerDialog`)

Paleta `act:ndjson-viewer` → elige `.ndjson` / `.jsonl` → se ve como tabla, **sin necesidad de conexión a BD**.

Reglas de parseo (`parse()`):

- Split por línea; las líneas vacías o no parseables suman a `skipped` (no bloquean)
- Reconoce el envoltorio estilo dbgate Archives `{ __table, data }`: la fila pertenece a `__table` y los datos están en `data`
- Reconoce la marca de error `{ __error: "..." }` → `skipped++`
- El resto se considera JSON normal con `table = ''`

Características de UI:

- **Pestañas entre tablas**: pestañas por cada `__table` visto; al pulsar se filtra a esa tabla
- **Unión de columnas**: la cabecera es la unión de `Object.keys` de las filas visibles (los campos que falten se muestran como `null`)
- **Detalle de fila**: doble clic abre el JSON completo a la derecha/abajo
- **Copiar todo / Guardar como**: copia el archivo completo al portapapeles o `saveText` para guardar (mantiene el nombre original)
- **Solo lectura v1**: no se edita ni se reimporta a la BD; pendiente

## 5. Backup / restauración (`BackupRestoreDialog`)

Paleta `act:backup:<connId>` → `BackupRestoreDialog`. **El MVP es SQL puro**: no llama a `mysqldump` / `pg_dump` externos (las rutas multi-plataforma son un infierno y los usuarios no siempre los tienen). Si más adelante se requiere DDL completo (orden de trigger / view / FK), se usará IPC con `child_process.spawn`.

#### Formatos de backup

| Formato | Implementación | Características |
|---|---|---|
| **SQL** | Reutiliza "Exportar SQL" del menú contextual del NavTree (`doSchemaExport`) | Camino clásico; lo comen `mysql/psql` directamente |
| **NDJSON** | `doBackupNdjson()` propio | Estilo dbgate Archives; cómodo para importar/exportar entre conexiones |

Flujo de backup NDJSON:

1. `metadata({ group: 'tables', path: [database] })` obtiene todas las base tables
2. Tabla a tabla, `SELECT * FROM <sqlName>` y escribe una línea `{"__table":"t","data":{...}}\n`
3. Si una tabla falla, **no se aborta**; se escribe `{"__table":"t","__error":"..."}` (visible al restaurar)
4. `saveText` guarda `skylerx-<conexión>-<timestamp>.ndjson`; el filtro acepta `.ndjson / .jsonl`
5. Barra de progreso (`done / total · phase`) + botón "⏹ Detener" (`stopRequested` se chequea antes de cada tabla)

Limitación conocida: `BLOB / Buffer` pasan por `JSON.stringify` y se convierten en `{ type: 'Buffer', data: [...] }`; **no se restauran como binario**. Para escenarios estrictos usa la ruta SQL.

#### Flujo de restauración

| Ruta | Proceso |
|---|---|
| SQL | `client.files.openText` → `splitStatements(content)` parte por `;` → confirmación → `execute` secuencial; **un fallo individual no aborta**; los errores van a `restoreProgress.errors[]` (truncados a 200 caracteres) |
| NDJSON | Agrupa por `__table` → **un `INSERT` grande por grupo**, en chunks de `chunkSize = 100` para no chocar con `max_allowed_packet` → misma recogida de errores |

UI con barra de progreso + listado de errores (truncados + wrap) + toast final tri-estado `restoreOk / restoreWithErrors / restoreStopped`.

## 6. Migración entre conexiones (`DataTransferDialog`)

NavTree clic derecho en una tabla → "Transferencia de datos". Más estrecho que el backup: **una tabla origen a una tabla destino**, eliges origen y ya está; perfecto para mover datos dev → staging.

| Campo | Por defecto | Descripción |
|---|---|---|
| Conexión destino | la actual | Lista todas las conexiones con sufijo `(actual)` |
| database destino | ctx origen | El significado varía: en PG es catalog, en MySQL es base |
| schema destino | ctx origen | PG/KB obligatorio (por defecto `public`); MySQL vacío |
| Nombre de tabla destino | mismo que origen | Si no existe falla el INSERT; no se crea la tabla |
| Filas por lote | 500 | Tamaño de paginación de `SELECT ... LIMIT ? OFFSET ?` |
| TRUNCATE destino antes | ✗ | Realmente ejecuta `DELETE FROM <ref>` (no `TRUNCATE`, así puede revertir en transacción) |

Bucle de ejecución:

```ts
for (let page = 0; page < 100000; page++) {
  const res = await execute(srcId, `SELECT * FROM ${srcRef}`, [],
    { ..., limit: size, offset: page * size })
  if (!res.rows.length) break
  await executeBatch(tgtId, rowInserts(tgt.dialect, dstRef, cols, res.rows), dstOpts)
  if (res.rows.length < size) break    // 提前停
}
```

- Tope de 100.000 páginas como salvavidas anti bucle infinito
- Las columnas se sacan del `metadata` de la tabla origen; por tanto **la tabla destino debe tener los mismos nombres de columna** (el orden da igual, `rowInserts` lista columnas explícitas)
- La conversión de tipos depende de JS → literal SQL (`io.ts::sqlLiteral`) + el cast implícito del motor destino. Los tipos complejos (Postgres `jsonb`, MySQL `BIT(1)`) pueden tener pequeñas pérdidas; tras la migración, haz un spot-check

## 7. Exportar diccionario de datos (Markdown / HTML)

NavTree clic derecho en schema (o base) → "Diccionario de datos → Markdown / HTML". `Workspace.vue::genDataDict` llama a `dump.ts::buildDataDictMarkdown / buildDataDictHtml`.

Una sección por tabla; las columnas de la tabla de campos son fijas:

| Campo | Tipo | Nullable | PK | Default | Comentario |
|---|---|---|---|---|---|
| `id` | `bigint unsigned` | N | 🔑 | | Clave primaria de usuario |
| `email` | `varchar(255)` | Y | | `NULL` | Email |

Fuente: lo que devuelve `metadata({ group: 'columns' })` en `MetadataNode.detail.{dataType, nullable, primaryKey, defaultValue, comment}`.

#### Diferencias entre Markdown y HTML

| Aspecto | Markdown | HTML |
|---|---|---|
| Escape | `|` → `\|`, salto → espacio | Entidades `&<>` |
| Índice | Ninguno (usa el outline del IDE) | TOC en 3 columnas con anclas `#t-<urlencoded>` |
| Maquetación | Markdown puro | `<style>` inline; sans-serif, bordes de tabla, filas zebra, `@media print` para no cortar secciones entre páginas |
| Indicado para | Wiki / GitLab / repositorio docs | Abrir en navegador e imprimir como PDF |

Nombre `<schema-o-db>-data-dict.md|html`. Generación **totalmente offline**: el diccionario suele necesitarse en auditorías, ejecutable sin red.

## 8. Comparación de datos (`DataDiffDialog`)

Paleta `act:data-diff`. **Dos conexiones × dos tablas → diff por filas → SQL de sincronización**.

El algoritmo está en `data-diff.ts::diffRows` (función pura, testable):

```ts
diff = {
  inserts: Row[],            // 源有 / 目标无
  updates: RowUpdate[],      // 主键相同,非键列有不同
  deletes: Row[]             // 目标有 / 源无
}
```

Claves de emparejamiento (`keyCols`):

- Por defecto, lee la **PK** del origen vía `information_schema.table_constraints + key_column_usage` (SQL común a MySQL / PG)
- El usuario puede sobrescribir `keyColsInput` (separado por comas)

La comparación `same(a, b)` **normaliza a string**: `null/undefined` se equiparan a vacío; el resto se compara con `String(a) === String(b)`. Tolera diferencias entre drivers (`MySQL2` devuelve `BigInt`, `pg` devuelve `Number`, SQLite devuelve `string`).

Matriz: **solo familia MySQL (MySQL / MariaDB / OB) + familia PostgreSQL (PG / KingbaseES)**; el resto (SQLite / Oracle / SQL Server / Redis, etc.) muestran "Solo MyPg disponible" y el botón queda gris.

Resultado:

| Métrica | Significado |
|---|---|
| `inserts` | Completa el destino al estado del origen |
| `updates` | Pone destino al mismo estado que origen (solo SET en columnas realmente distintas) |
| `deletes` | Filas sobrantes en destino; **van al final y comentadas** "solo en destino; confirmar antes de ejecutar" para evitar borrados accidentales |

Al final, `generateDataSync` arma un SQL legible que puedes "copiar" o "abrir en una consulta" para ejecutar en destino: una ventana de dry-run / revisión humana.

`LIMIT` (por defecto 2000) evita reventar la memoria; si la PK difiere mucho, acota antes el ámbito.

## 9. Seguridad (resumen)

Detalle en [Modelo de seguridad](./troubleshooting.md). Puntos del capítulo:

- **La exportación de workspace no incluye contraseñas por defecto**; si las marcas, el JSON queda en plano y la UI marca claramente con rojo "⚠"
- **`.sql.enc` (exportación cifrada)** usa AES-256-GCM; contraseña errónea y archivo manipulado dan el mismo error, sin filtrar canal lateral
- **El backup NDJSON no anonimiza**; para anonimizar real, usa el PII Scanner en la generación o escribe a mano `SELECT replace(...)` desde el editor SQL
- Los datos temporales de import/export viven **solo en memoria**, no se escriben archivos intermedios y se liberan al cerrar el diálogo

## 10. Matriz de compatibilidad

| Capacidad | Familia MySQL | Familia PG | SQLite | Oracle | SQL Server | DM / KingbaseES | Redis | MongoDB |
|---|---|---|---|---|---|---|---|---|
| Copiar como CSV/TSV/JSON/MD | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Copiar como SQL VALUES/INSERT | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Exportar tabla/schema SQL | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Exportación completa `.skylerxws` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Exportación cifrada `.sql.enc` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| ImportDialog (CSV/JSON/Excel) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Usa RedisImportExport | Usa ruta NDJSON |
| Pegado del portapapeles | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Visor NDJSON | No depende de BD | No depende de BD | — | — | — | — | — | — |
| Backup/restore vía SQL | ✓ | ✓ | ✓ | Parcial | ✓ | ✓ | — | — |
| Backup/restore vía NDJSON | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Migración entre conexiones | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Diccionario de datos (MD/HTML) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Diff por filas + SQL de sync | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ (KB) | — | — |

"✗" = deshabilitado en UI; "—" = sin sentido para ese dialecto (KV / docs usan su propio `RedisImportExportDialog`).

## Disparadores rápidos

| Acción | Barra | Menú contextual | ⌘K Paleta | Atajo |
|---|---|---|---|---|
| Copiar resultado como CSV / TSV / ... | — | Cuadrícula → Copiar como → ... | — | — |
| Exportar tabla SQL | — | NavTree tabla → Exportar SQL | — | — |
| Exportar schema SQL | — | NavTree schema → Exportar SQL | — | — |
| Exportar workspace | Engranaje superior → Exportar | — | `Exportar workspace` (`act:export-conns`) | — |
| Importar workspace | Engranaje superior → Importar | — | `Importar workspace` (`act:import-conns`) | — |
| Importar datos (CSV/JSON/Excel) | — | NavTree tabla → Importar datos | — | — |
| Importar del portapapeles | — | — | `PasteImport` (menú superior) | — |
| Ver archivo NDJSON | — | — | `Visor NDJSON` (`act:ndjson-viewer`) | — |
| Backup / restauración | — | — | `Backup/Restore · <conexión>` (`act:backup:<id>`) | — |
| Transferencia de datos | — | NavTree tabla → Transferencia de datos | — | — |
| Diccionario de datos | — | NavTree schema/base → Diccionario de datos → MD / HTML | — | — |
| Comparación de datos | — | — | `Data diff` (`act:data-diff`) | — |

Nota: cualquier "Guardar como" pasa por el mismo `SaveFileDialog` propio (`packages/ui/src/components/SaveFileDialog.vue`); idéntico en macOS / Windows / Linux, **no abre el nativo del SO**; soporta favoritos, directorios recientes, navegación ↑↓, Enter para guardar y ⌘L para foco en la barra de direcciones.
