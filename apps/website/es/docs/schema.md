# Gestión de estructura

Una base de datos no es solo "meter datos"; gran parte del tiempo se invierte en diseñar tablas, modificarlas, cotejarlas y migrarlas. SkylerX agrupa las capacidades relacionadas con la estructura en un conjunto de herramientas orientadas a base / tabla / schema, desde la mera lectura hasta la alineación entre dos bases.

Esta página las presenta de menor a mayor peso: **ver → diseñar → editar → diagrama → snapshot → comparación entre bases → drift → crear base/schema → ayuda de IA**.

## Resumen

| Herramienta | Disparador | Propósito | Genera SQL | Lo aplica directamente |
|---|---|---|---|---|
| Estructura de tabla (TableStructure) | Árbol izquierdo: doble clic en una tabla | Lectura: columnas / índices / claves / DDL | — | No |
| Diseñador de tabla (TableDesigner) | Clic derecho en árbol → Nueva tabla / Diseñar tabla | Diseño visual + ALTER consciente del diff | ✓ (preview) | ✓ (tras confirmar) |
| Editor DDL (DdlEditor) | Clic derecho → Crear / editar vista, función, procedimiento, trigger | Escribir / modificar DDL directamente | ✓ (editor) | ✓ |
| Diagrama ER (ErdView) | Clic derecho en schema → Diagrama ER | Visualización completa + arrastre para crear tablas / FK | ✓ (export `.sql`) | ✓ (aplicar a la BD) |
| Snapshots de schema (SchemaSnapshots) | Paleta `act:snapshots:{connId}` | Guarda los DDL actuales en localStorage para comparar después | — | No |
| Comparación de schema (SchemaDiff) | Paleta `act:schema-diff` | Compara dos conexiones + genera script de alineación | ✓ (abrible como consulta) | No |
| Drift de schema (SchemaDrift) | Paleta `act:drift` | Detección profunda entre dos conexiones del mismo dialecto (columnas / índices / FK) | ✓ (script de alineación) | ✓ (tras confirmar) |
| Nueva base de datos (NewDatabase) | Clic derecho en la conexión → Nueva base | Genera `CREATE DATABASE` por dialecto | ✓ (preview editable) | ✓ |
| Nuevo schema (NewSchema) | Clic derecho en la base → Nuevo schema | PG / SQL Server / Oracle, etc. | ✓ | ✓ |
| AI: crear tablas (SchemaArchitect) | Paleta → Asistente IA para crear tablas | Descripción de negocio → DDL multitabla | ✓ | ✓ |
| AI: ingeniería inversa (SchemaReverse) | Paleta → Inferencia inversa por IA | Datos de muestra → CREATE TABLE | ✓ | ✓ |

Detallamos cada una.

## 1. Vista de estructura de tabla (TableStructure)

La forma más sencilla de "ver cómo es esta tabla"; al pulsar el nodo de tabla se abre una pestaña de solo lectura. El código está en `packages/ui/src/components/TableStructure.vue`.

Cuatro pestañas con el contador en el sufijo:

- **Campos** — nombre / tipo / NULL / PK / valor por defecto / comentario
- **Índices** — lista de nombres de índices (solo el nombre; los detalles en el diseñador)
- **Claves** — nombres de PK / FK / claves únicas
- **DDL** — el `CREATE TABLE` completo

La estrategia para obtener el DDL depende del dialecto:

```ts
if (isMysql) {
  // MySQL 系直接 SHOW CREATE TABLE，最权威
  const r = await client.connections.execute(connId, `SHOW CREATE TABLE ${ref}`)
  // 取 row['Create Table']
}
// 非 MySQL：buildCreateFromColumns(...) 用列信息重建一份简化 DDL
```

Es decir: en **MySQL / MariaDB / OceanBase** el DDL es el que devuelve la propia BD; en PostgreSQL / Oracle / SQL Server, etc., es una versión simplificada ensamblada a partir de la metadata de columnas, suficiente para revisión, sin sintaxis compleja tipo GENERATED / EXTENDS.

El botón de refresco `⟳` arriba a la derecha vuelve a tirar metadatos (`Promise.all([meta('columns'), meta('indexes'), meta('keys')])`), útil para confirmar tras un cambio.

## 2. Diseñador visual de tablas (TableDesigner)

`packages/ui/src/components/TableDesigner.vue`, **880 líneas**: la pieza principal de la gestión de estructura. Dos modos:

- `mode: 'create'` — nueva tabla (desde cero)
- `mode: 'alter'` — modificar (carga columnas + índices + FK existentes)

### Barra superior

| Botón | Acción |
|---|---|
| Nueva / Resetear | `resetTable()` vuelve a una tabla vacía |
| Guardar | Modo create → `CREATE TABLE`; modo alter → secuencia de `ALTER TABLE` diff |
| Guardar como | `prompt` de nuevo nombre → `CREATE TABLE` con la estructura actual (equivale a "copiar estructura") |
| ➕ Campo / Insertar / Borrar / PK / ⬆⬇ | Splice directo sobre el array de columnas |
| Caja del nombre de tabla | En modo alter es de solo lectura (renombrar va por RENAME, fuera del alcance del diseñador) |

### Pestañas internas (visibles según dialecto)

El array `INNER` define 10 pestañas: `fields / indexes / fk / unique / check / trigger / options / storage / comment / sql`. Cada una es un subformulario reactivo; al cambiar se actualiza el preview SQL al instante.

**Tabla de campos** (edición en línea):

| Columna | Edición |
|---|---|
| Nombre del campo | input normal |
| Tipo | input + datalist (`type-list`), candidatos por dialecto (`typeOptions(dialect)`) |
| Longitud / precisión | input numérico |
| NULL / PK | checkbox |
| Valor por defecto / comentario | input |

Bajo la fila seleccionada aparece el bloque "Propiedades del campo"; en familia MySQL muestra `UNSIGNED / ZEROFILL / AUTO_INCREMENT / ON UPDATE CURRENT_TIMESTAMP / CHARSET / COLLATION`; en cualquier dialecto, la expresión `GENERATED`.

**Índices**: el desplegable de tipo cambia por dialecto: familia MySQL `BTREE / HASH / FULLTEXT / SPATIAL`; familia PG `btree / hash / gin / gist`. PG añade dos columnas `WHERE` (índice parcial) y `CONC` (`CREATE INDEX CONCURRENTLY`, no bloquea la tabla).

**Claves foráneas**: también por dialecto: candidatos `ON DELETE / ON UPDATE` fijados a `CASCADE / SET NULL / RESTRICT / NO ACTION`; PG añade `MATCH FULL/PARTIAL/SIMPLE` y `DEFERRABLE`.

**Opciones**:

- Familia MySQL: Engine / Charset / Collation / Row Format (`DYNAMIC / COMPRESSED / COMPACT / REDUNDANT`) / valor inicial del Auto-increment
- Familia PG: `TABLESPACE / FILLFACTOR / INHERITS`
- Otros: aviso de campos vacíos

### ALTER consciente del diff (núcleo del modo alter)

Al entrar en modo alter, `loadExisting()` llama a `client.connections.metadata` para extraer las columnas en `ColumnDef[]`, y `loadIndexes()` / `loadForeignKeys()` consultan `information_schema` para índices y FK; **todo el snapshot se guarda en `original.value / originalIndexes.value / originalForeignKeys.value`** como baseline del diff.

Después, `alterStmts` es `computed(() => buildAlterTable(dialect, tableRef, original.value, spec, { indexes: originalIndexes.value, foreignKeys: originalForeignKeys.value }))`.

`buildAlterTable` hace diff campo a campo entre origen y estado actual:

- Cambio de nombre de columna (y `originalName` existe) → `ALTER TABLE ... RENAME COLUMN / CHANGE COLUMN`
- Fila eliminada → `DROP COLUMN`
- Fila nueva → `ADD COLUMN`
- Cambio en tipo / NULL / default / comentario → `MODIFY COLUMN` (MySQL) o `ALTER COLUMN` (PG/MSSQL)
- Diff de índices / FK vs `originalIndexes.value` → altas/bajas

La pestaña de preview SQL (`inner === 'sql'`) muestra la lista de ALTER generados; si no hay cambios, aparece el placeholder `designer.noChanges`. **Guardar** ejecuta cada ALTER individualmente con `client.connections.execute`; si alguna falla, se detiene allí y enfoca la pestaña SQL, sin revertir las que ya pasaron (en gestión de tablas suele ser aceptable; el error se muestra en la barra).

### Comprobación de cambios + transición de create a alter

La comprobación de dirty compara `JSON.stringify({ tableName, spec })` con la baseline; al cerrar la pestaña, el componente padre llama a `isDirty()` para decidir si pedir confirmación. Tras guardar / resetear, la baseline se sincroniza y una pestaña recién abierta no se marca como dirty por error.

Al guardar con éxito en modo create, el componente cambia `runtimeMode` a `alter` y marca como `originalName` las columnas recién creadas, de modo que los guardados posteriores siguen el camino ALTER diff. Efecto: pulsas guardar, la tabla queda creada, la pestaña sigue abierta sin saltos, y puedes seguir añadiendo campos o cambiando tipos: optimización para el flujo "diseñar mientras se piensa".

## 3. Editor DDL (vistas / funciones / procedimientos / triggers)

`packages/ui/src/components/DdlEditor.vue`. Para los objetos de schema fuera del diseñador se escribe SQL directamente; este componente es un wrapper de Monaco con detección de dialecto.

- **mode: 'create'** — `objectTemplate(dialect, kind, ctx)` proporciona el esqueleto mínimo (p. ej. `CREATE VIEW v AS SELECT 1;`)
- **mode: 'edit'** — `objectDdlQuery(dialect, kind, ref, node)` recupera la definición existente

`objectDdlQuery` devuelve uno de tres modos:

| mode | Aplicación | Obtención |
|---|---|---|
| `showCreate` | Familia MySQL | `SHOW CREATE VIEW / PROCEDURE / FUNCTION / TRIGGER`; toma el campo de la row que empieza por `^create` |
| `viewdef` | Vistas PG | `pg_get_viewdef(...)`; el componente prepone `prefix` (`CREATE OR REPLACE VIEW ... AS\n`) |
| `funcdef` / `oracle-ddl` | Funciones PG / DBMS_METADATA de Oracle | Lee directamente `row.ddl` |

Barra:

- **Guardar / Ejecutar** (texto según el modo) — todo el bloque se ejecuta como una sola sentencia (los cuerpos de funciones/procedimientos contienen `;`, no se pueden partir por punto y coma)
- **Formatear** — `sql-formatter` por dialecto: familia `mysql` → mysql, familia `pg` → postgresql, `sqlserver` → transactsql, `oracle/dm` → plsql. Si el parseo falla, no bloquea la edición
- **Cancelar** — cierra la pestaña

La barra de errores muestra el mensaje crudo del backend; en triggers / procedimientos suele ser un problema de `;` / DELIMITER.

## 4. Diagrama ER (ErdView)

`packages/ui/src/components/ErdView.vue`, lienzo SVG dibujado a mano. Apertura: clic derecho en un nodo de base / schema → Diagrama ER; se abre una nueva pestaña `kind: 'erd'`.

### Modo vista (por defecto)

- Carga todas las tablas (`loadErd`, vía `information_schema` / `pg_constraint`, etc.) → layout automático en cuadrícula
- Rueda del ratón = zoom; arrastrar en zonas vacías = pan
- Las cajas de tabla son arrastrables a cualquier posición (incluidas negativas; el canvas no recorta)
- Barra superior: `－ / + / 1:1 / ⟳ / Editar` para zoom y refresco

### Modo edición (al pulsar "Editar")

Tres modificaciones simultáneas, aplicables al confirmar:

1. **Nueva tabla** — `addTable()` añade una caja; se agregan columnas, se cambia el tipo, se marca PK
2. **Nueva FK** — pulsar en el puerto a la derecha de una columna → arrastrar hasta una columna de otra tabla → `newFks.push(...)`; visualmente, línea morada discontinua
3. **ALTER añadir columna** (D1) — botón "+ ALTER añadir columna..." de la tabla existente → dos `prompt` (nombre / tipo) → entra en `alterAddCols[tableName]`; se marca dentro de la caja en morado con prefijo `+`

### Salida

`generateDdl()` llama a `client.files.saveText` y produce un `.sql` con:

```sql
CREATE TABLE "t1" (
  "id" int,
  ...
);

ALTER TABLE "orders" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id");

ALTER TABLE "users" ADD COLUMN "phone" varchar(64);
```

`applyChanges()` parte `buildDdl(true)` (solo lo nuevo) por `;\n` y manda `executeBatch` a la conexión; si va bien, llama a `load()` y vuelve al modo vista. Si falla, hay un alert y la estructura del usuario no se altera.

## 5. Snapshots de schema (SchemaSnapshotsDialog)

`packages/ui/src/components/SchemaSnapshotsDialog.vue`. Se dispara desde la paleta con `act:snapshots:{connId}`.

Objetivo: comparar la **misma conexión en distintos momentos**. No se solapa con SchemaDiff (dos conexiones) ni con SchemaDrift (drift profundo).

### Hacer una snapshot

Pulsa "📸 Snapshot" → toma los DDL de todas las tablas de la primera base/schema. MySQL usa `SHOW CREATE TABLE`; PG arma un DDL simplificado (columnas + tipo + NULL + DEFAULT). Al terminar, un `prompt` te pide un comentario ("antes del release / tras tocar pedidos / ..."), y se guarda en `localStorage['skylerx.schema-snapshots']`; se conservan como máximo `MAX_PER_CONN = 20` por conexión y se descartan los más antiguos en LRU.

### Comparar

Marca dos snapshots en la lista (si seleccionas más, salen los más antiguos) → "⟷ Comparar". El algoritmo es directo:

- Solo en A → `added` (verde)
- Solo en B → `removed` (rojo)
- En ambas con distinto contenido → `changed` (amarillo)
- Idénticos → `same` (oculto por defecto)

Al pulsar una fila del diff aparece a la derecha el DDL en dos columnas para comparar a ojo.

> Limitación: solo mira la primera base/schema; en escenarios multibase haz una snapshot por base. Se usa `localStorage` para no contaminar la SQLite de migraciones con datos "tipo log"; los 5MB de cuota suelen cubrir decenas de tablas × veinte snapshots.

## 6. Comparación de schema (SchemaDiffDialog) — comparar dos conexiones + SQL de alineación

`packages/ui/src/components/SchemaDiffDialog.vue`. Disparador: paleta `act:schema-diff`.

### Condiciones de uso

- Elige conexión y schema origen, conexión y schema destino
- Deben pertenecer a la **misma familia** (MySQL ↔ MySQL / PG ↔ PG); entre familias la sintaxis SQL no coincide y la UI muestra "solo se soporta MySQL ↔ MySQL / PG ↔ PG"

Al cambiar de conexión, `onPickSrc / onPickTgt` rellena el schema por defecto: PG → `public`, MySQL → `database` de la conexión.

### Extracción y comparación

Lanza en paralelo una consulta a `information_schema.COLUMNS` por lado (`TABLE_NAME / COLUMN_NAME / tipo / NULL / PK / default`) → `TableSnapshot[]` → `diffSchemas` produce tres categorías: `added / changed / removed`. Cada `changed` lleva además los `columnChanges` (`add / drop / modify`).

### Salida

`generateMigration` produce SQL de alineación para el dialecto destino, con un resumen al principio (cuántas tablas nuevas, modificadas, eliminadas). Debajo dos botones:

- **Copiar** — al portapapeles
- **Abrir como consulta en la conexión destino** — `emit('openSql', tgtId, migration)`; Workspace abre una nueva pestaña con el SQL para que lo revises antes de ejecutarlo. Este paso garantiza **que no se aplica automáticamente**.

## 7. Detección de drift de schema (SchemaDriftDialog)

`packages/ui/src/components/SchemaDriftDialog.vue`, **925 líneas**, va más al fondo que SchemaDiff. Disparador en la paleta: `act:drift`.

Diferencia: SchemaDiff solo mira columnas; SchemaDriftDialog mira también **índices** y **claves foráneas**, y el script generado se puede **ejecutar directamente desde SkylerX**.

### TableProfile

Cada tabla se normaliza en un `TableProfile`: `columns: Map<name, {type, nullable, default, pk}>` + `indexes: Map<name, {unique, columns[]}>` + `fks: Map<name, "(c1,c2) → other(c1,c2)">`, más el DDL original para inspección humana.

Fuentes de extracción por dialecto: MySQL usa `SHOW CREATE TABLE` + `information_schema.COLUMNS / STATISTICS / KEY_COLUMN_USAGE`; PG usa `information_schema.columns` + `pg_indexes` (regex sobre `indexdef` para sacar unique y nombres) + `information_schema.constraint_column_usage`.

### Informe

Tres columnas: **solo en origen / solo en destino / contenido distinto**. La tercera se despliega mostrando cambios de columnas (`+ name / − name / ~ name`), de índices (`+ idx_x`), de FK (`~ fk_x`). Al pulsar la fila se expande el diff de DDL en dos columnas.

### Script de alineación (producto clave)

Cada fila tiene un botón "+ Alinear" que **añade** el SQL de reparación a la caja de preview:

| Estado | Sentencia generada |
|---|---|
| Solo en origen | Copia tal cual el DDL del origen (`CREATE TABLE`) |
| Solo en destino | `-- DROP TABLE \`x\`; -- comentado; el usuario lo descomenta a mano` |
| Columna add | `ALTER TABLE \`t\` ADD COLUMN \`c\` {srcType};` |
| Columna drop | `-- ALTER TABLE ... DROP COLUMN ...` comentado (por seguridad) |
| Columna modify | MySQL: `MODIFY COLUMN`; PG: `ALTER COLUMN ... TYPE` |
| Diff de índices / FK | Solo comentarios `-- INDEX +xx` / `-- FK -xx`; **no se generan automáticamente** (la sintaxis de reconstrucción de índices es compleja, mejor manual) |

Ejecución: `▶ Ejecutar script` pide confirmación crítica → divide por `;\s*\n`, salta los comentarios `--` → `executeBatch`.

> Compromiso de diseño: drop de tabla / columna por defecto comentado; add columna y cambio de tipo, SQL ejecutable. "Lo destructivo comentado, lo reparador permitido", el menos arriesgado en escenarios de operaciones.

## 8. Crear base de datos (NewDatabaseDialog)

`packages/ui/src/components/NewDatabaseDialog.vue`. Clic derecho en el nodo de conexión → Nueva base.

En el diálogo: **Nombre (obligatorio)** + sección plegable "Opciones avanzadas" (charset / collation / comentario) + **Preview SQL (editable)**. Lo que se ejecuta es el texto del preview, no el formulario; tras la previa puedes añadir manualmente `IF NOT EXISTS`, etc.

### Matriz de dialectos

| Dialecto | Soporte | Notas |
|---|---|---|
| MySQL / MariaDB / OceanBase / TiDB / Doris / StarRocks | ✓ | `CREATE DATABASE \`n\` [DEFAULT CHARACTER SET ...] [DEFAULT COLLATE ...]` (sin COMMENT) |
| PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift | ✓ | `CREATE DATABASE "n" [ENCODING '...']` + `COMMENT ON DATABASE` aparte |
| SQL Server | ✓ | `CREATE DATABASE [n]` (sin charset) |
| ClickHouse | ✓ | `CREATE DATABASE \`n\` COMMENT '...'` |
| Snowflake | ✓ | `CREATE DATABASE "n" COMMENT = '...'` |
| TDengine | ✓ | `CREATE DATABASE n` (sin comillas) |
| **Oracle / DM** | ✗ | La base = instancia; requiere DBCA. Se sugiere "crear schema (usuario) en su lugar" |
| SQLite / DuckDB | ✗ | Basadas en archivo; base = archivo; "crear" mediante nueva conexión eligiendo ruta |
| H2 | ✗ | Lo determinan los parámetros de arranque; no se crea con SQL en caliente |
| MongoDB / Redis / Elasticsearch | ✗ | Se usan collection / index / db0-15, no `CREATE DATABASE` |

En los dialectos no soportados, la UI muestra un aviso rojo y no permite enviar.

### Opciones de charset

Recomendaciones por dialecto:

- Familia MySQL: `utf8mb4 / utf8 / latin1 / gbk`; collations `utf8mb4_general_ci / unicode_ci / 0900_ai_ci / bin`
- Familia PG: `UTF8 / SQL_ASCII / LATIN1 / GBK`

Al confirmar, se parte por `;\s*\n` y se ejecuta sentencia a sentencia.

## 9. Nuevo schema (NewSchemaDialog, caso especial Oracle)

`packages/ui/src/components/NewSchemaDialog.vue`. Clic derecho en la base → Nuevo schema.

### Matriz de dialectos

| supportInfo | Dialecto | Sintaxis |
|---|---|---|
| `pg` | PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift | `CREATE SCHEMA "n" [AUTHORIZATION "owner"]` + opcional `COMMENT ON SCHEMA` |
| `sqlserver` | SQL Server | `CREATE SCHEMA [n] [AUTHORIZATION owner]` |
| `snowflake` | Snowflake | `CREATE SCHEMA "n" [COMMENT = '...']` |
| `oracle` | Oracle / DM | **Schema = User**; vía CREATE USER + GRANT (ver abajo) |
| `null` | MySQL / SQLite / ClickHouse / TDengine / NoSQL | No tienen concepto de schema; muestra "este dialecto no tiene schema" |

### Caso especial Oracle / DM

En Oracle "schema" es sinónimo de "user"; el diálogo aplica unos defaults razonables para desarrollo:

```sql
CREATE USER :name IDENTIFIED BY :password
  DEFAULT TABLESPACE USERS
  TEMPORARY TABLESPACE TEMP
  QUOTA UNLIMITED ON USERS;

GRANT CONNECT, RESOURCE, UNLIMITED TABLESPACE,
      CREATE VIEW, CREATE SYNONYM, CREATE SEQUENCE,
      CREATE PROCEDURE, CREATE TRIGGER, CREATE TYPE,
      CREATE MATERIALIZED VIEW, CREATE DATABASE LINK
   TO :name;
```

(Los placeholders `:name` / `:password` representan el nombre y la contraseña reales.)

Los comentarios del código explican el porqué:

- `QUOTA UNLIMITED ON USERS` — sin esto, el primer INSERT del nuevo usuario lanza `ORA-01950: insufficient quota on tablespace USERS`
- Desde Oracle 12c+, `RESOURCE` ya no incluye `CREATE VIEW / SEQUENCE`, etc.; hay que añadir explícitamente los habituales en desarrollo
- No se otorgan `SELECT ANY TABLE / DBA / SYSDBA` — el usuario "solo juega en su schema"
- Nombre / contraseña por defecto **sin comillas**: como identificadores legales sin comillas, Oracle los pasa a mayúsculas (evita "doble comilla minúscula → ALTER USER no lo encuentra"). Si quieres minúsculas o caracteres especiales, añade tú las comillas en el preview

Si la contraseña queda vacía, se rellena con el placeholder `CHANGE_ME_123` para recordar cambiarla.

### Envío

`execute` lleva el contexto `database` (en familia PG el schema pertenece a la base; primero USE, luego CREATE). En caso de fallo, el toast del error incluye el enlace `askAi` con el SQL + error (típico: tablespace inexistente / permisos insuficientes en Oracle).

## 10. Asistencia de IA: Schema Architect + Schema Reverse

Dos herramientas conversacionales; ambas dejan el SQL final para que el usuario revise antes de ejecutar.

### Schema Architect (descripción de negocio → DDL multitabla)

`packages/ui/src/components/AiSchemaArchitectDialog.vue`. Conversación con múltiples rondas.

Esencia del System Prompt:

> You are a senior database architect. The user describes a business domain.
> 1. Design **multiple related tables** with PK, FK, indexes for the **`{dialect}`** dialect.
> 2. Output a single ```sql code block containing the COMPLETE CREATE TABLE statements.
> 3. Explain key design decisions in 2-4 bullets.
> 4. When user asks to revise, output the FULL updated SQL again (not a diff).

Flujo:

1. Describes el negocio ("Un sistema de pedidos: usuarios, productos, pedidos, líneas, con cupones")
2. La IA responde con markdown: justificación de diseño + bloque SQL completo
3. En la conversación pides ajustes ("añade un campo status" / "convierte order_items en tabla particionada") y la IA reescribe **el SQL entero**
4. Botón superior `▶ Ejecutar la versión más reciente` — toma `latestSql` (el bloque SQL de la última respuesta), parte por `;\s*(?:\n|$)` y ejecuta secuencialmente

`latestSql` siempre toma la última ronda — si has iterado cinco veces, se ejecuta la quinta, sin contaminación de las anteriores.

### Schema Reverse (datos de muestra → CREATE TABLE)

`packages/ui/src/components/AiSchemaReverseDialog.vue`. No conversacional, ideal para "tengo un CSV, créame la tabla".

Entrada: **Formato** (CSV / TSV / JSON) + **Nombre de tabla** + **Datos de ejemplo** (basta con pegar algunas filas; con cabecera es más preciso) + opcional "generar también el INSERT".

El prompt fuerza cuatro secciones de salida: **explicación de la inferencia** (columna → tipo → razón), **CREATE TABLE** (bloque `sql`), **INSERT (datos)** (opcional, bloque `sql`), **sugerencias de índice** (bullet list).

Cuando la IA responde, `extractSql(text)` extrae el primer bloque SQL en la caja inferior; lo puedes ajustar y luego `▶ Ejecutar`.

> Sobre las sugerencias de índices: en Schema Reverse la IA solo "sugiere" por experiencia, sin crearlos. Si quieres recomendaciones basadas en SQL histórico real + índices existentes → ver [Avanzado e ingeniería → Recomendador de índices](./advanced.md).

## Matriz de compatibilidad

Resumen del soporte por dialecto. `▣` = soporte completo, `◐` = parcial, `-` = no aplica / se omite.

| Herramienta | Familia MySQL | Familia PG | SQL Server | Oracle / DM | SQLite | ClickHouse | NoSQL |
|---|---|---|---|---|---|---|---|
| TableStructure | ▣ (`SHOW CREATE TABLE` original) | ◐ (reconstrucción por columnas) | ◐ (reconstrucción) | ◐ (reconstrucción) | ◐ | ◐ | - |
| TableDesigner — CREATE | ▣ | ▣ | ▣ | ▣ | ◐ (menos tipos / opciones) | ◐ | - |
| TableDesigner — ALTER diff | ▣ | ▣ | ◐ | ◐ | ◐ | ◐ | - |
| DdlEditor | ▣ (SHOW CREATE) | ▣ (`pg_get_viewdef` / `funcdef`) | ◐ | ▣ (DBMS_METADATA) | ◐ | ◐ | - |
| ErdView | ▣ | ▣ | ◐ | ◐ | ◐ | - | - |
| SchemaSnapshots | ▣ | ◐ (DDL simplificado) | - | - | - | - | - |
| SchemaDiff | ▣ | ▣ | - | - | - | - | - |
| SchemaDrift | ▣ | ▣ | - | - | - | - | - |
| NewDatabase | ▣ | ▣ | ▣ | - (usa NewSchema) | - (basada en archivo) | ▣ | - (vía comando específico) |
| NewSchema | - (sin concepto) | ▣ | ▣ | ▣ (=User) | - | - | - |
| AI Architect / Reverse | ▣ | ▣ | ▣ | ▣ | ▣ | ▣ | ◐ |

"Familia MySQL" cubre MySQL / MariaDB / OceanBase / TiDB / Doris / StarRocks. "Familia PG" cubre PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift / H2 (compatible PG).

## Flujos típicos encadenados

**Levantar una base de negocio desde cero**:
1. Clic derecho en la conexión → Nueva base → revisa el preview SQL → ejecutar
2. Paleta → Asistente IA crear tablas → describe el negocio → recibe el DDL completo → ejecuta sobre la nueva base
3. Clic derecho en el schema → Diagrama ER → revisa relaciones / ajustes
4. Cambiar un campo: clic derecho en la tabla → Diseñar tabla (modo alter) → guardar (ALTER diff)

**Alinear dos bases**:
1. Paleta `act:schema-diff` → elige conexiones dev / prod → recibes el SQL de migración → "Abrir como consulta en destino" → revisas → ejecutas
2. Si sospechas que alguien tocó prod a mano: `act:drift` → elige baseline / prod → revisa el informe de tres columnas → pulsa "+ Alinear" en lo necesario → revisa el preview → ejecuta

**Revisión histórica**:
1. Antes del release: `act:snapshots:{connId}` → toma snapshot → comenta "antes de v2.0"
2. Tres meses después: abre el diálogo → marca "antes de v2.0" + una snapshot nueva → comparar → ves qué tablas cambiaron

Con esto cubres toda la gestión de estructura. Para ver el plan de ejecución, slow log y recomendación de índices, ve a [Avanzado e ingeniería](./advanced.md); para migraciones entre dialectos, ve a [Soporte de bases de datos](./databases.md).
