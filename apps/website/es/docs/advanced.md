# Funcionalidades avanzadas

Esta sección reúne las capacidades pensadas para **usuarios intensivos (DBAs / ingenieros de datos / desarrolladores backend)**. Quedan escondidas tras menús contextuales, la paleta `⌘K` o niveles inferiores de la barra; en un SELECT cotidiano probablemente no las uses, pero ahorran mucho tiempo en escenarios como:

- Saber si una consulta usa el índice y qué nodo es el más lento
- Inferir qué índices crear a partir del SQL histórico
- Examinar la distribución de columnas / proporción de NULL / si el tipo está sobrado
- Eliminar duplicados / rellenar valores por defecto / recuperar registros soft-deleted
- Buscar dónde aparece un valor a lo largo de una base entera
- Construir consultas visualmente sin escribir SQL
- Gestionar particiones en Doris/StarRocks, parts en ClickHouse, binlog en MySQL o extensiones en PG
- Migrar una base Oracle completa a 达梦 (DM)

A continuación, en orden "ver → modificar → buscar → construir → migrar".

## 1. EXPLAIN visual — PlanPanel

Todos hemos leído un EXPLAIN, pero el texto plano no es intuitivo. SkylerX cuelga del QueryPane un **panel Plan** que renderiza el EXPLAIN como árbol + resumen.

### Disparadores

| Entrada | Acción |
|---|---|
| Barra del QueryPane `📊 Plan` | EXPLAIN del SQL actual (sin ejecutar) |
| `⌘⇧E` / Ctrl+Shift+E | Igual |
| `▶ Analyze` junto a `📊 Plan` | EXPLAIN ANALYZE (**ejecuta de verdad**; cuidado con DML) |

Internamente, `plan.ts → planQuery(dialect, sql, { analyze })`:

| Dialecto | Sentencia generada |
|---|---|
| PostgreSQL / Kingbase | `EXPLAIN (FORMAT JSON) <sql>` / `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) <sql>` |
| MySQL / MariaDB / OceanBase | `EXPLAIN FORMAT=TREE <sql>` / `EXPLAIN ANALYZE <sql>` (MySQL 8.0.18+) |
| Otros | Fallback al EXPLAIN tabular (pre render plano) |

### Render del árbol

El JSON Plan de PG lo parsea `parsePgPlan` a un árbol `PlanNode`; luego `flattenPlan` lo aplana en `{node, depth}` para renderizar. Cada nodo muestra:

- **Etiqueta**: `Seq Scan` / `Index Scan` / `Hash Join` …
- **Detalles**: `on users` / `using users_pk` / `inner join`
- **Barra de coste**: ancho = `cost / maxCost * 60px`, gradiente verde→rojo
- **Métricas**: `cost 1234.56 · est 1000 · act 1234 · 12.3ms` (act / ms solo con ANALYZE)

### Coloreado de operadores lentos

PlanPanel marca en rojo el "tercio más caro" de nodos:

```ts
function isSlow(node) {
  return node.cost >= maxCost.value * 0.33 && maxCost.value > 0
}
```

Fondo rojo + etiqueta roja: **se ve al instante dónde atacar** sin comparar números.

### Desviación estimado vs real

`estimateSkew(node)` calcula `max(est, act) / min(est, act)`. ≥ 10× se interpreta como **estadísticas obsoletas del optimizador**; se añade un borde amarillo a la izquierda y un badge `⚠ 24×` al final del nodo. En el resumen también se destaca "el nodo con mayor desviación":

```ts
let skewWorst = null
for (const r of arr) {
  const sk = estimateSkew(r.node)
  if (sk == null) continue
  if (!skewWorst || sk > skewWorst.skew) skewWorst = { node: r.node, skew: sk }
}
```

Cuando ves este badge, suele tocar `ANALYZE table` o `pg_statistic refresh`.

### Barra de resumen

Arriba del panel:

| Campo | Significado |
|---|---|
| `Total Cost` | Coste del nodo raíz (suma agregada) |
| `Actual ms` | Suma del tiempo real por nodo (con EXPLAIN ANALYZE) |
| `Heaviest` | Nombre del nodo más caro |
| `Skew` | Nodo con mayor desviación estimado/real + multiplicador |

---

## 2. Recomendador de índices — IndexRecommender

`⌘K → Recomendador de índices` o clic derecho en una base del árbol → `🔧 Recomendar índices`.

### Entradas y salidas

| Entrada | Origen |
|---|---|
| Patrones de SQL histórico | `client.connections.history(connId, 1000)` (los últimos 1000) |
| Índices existentes | MySQL `information_schema.STATISTICS` / PG `pg_index + pg_class` |

Salida: `IndexHint[]`, cada uno con nombre de tabla, columnas, score, razón y DDL `CREATE INDEX` listo para ejecutar.

### Algoritmo (`index-recommender.ts`)

Sin parser SQL (caro y dependiente del dialecto); heurística con regex sobre WHERE / JOIN / ORDER BY / GROUP BY:

1. **Agregar historial**: SQL idénticos se unen sumando `count` + `totalMs`
2. **Filtrar**: solo `SELECT` / `WITH`; se descartan DML/DDL
3. **Resolver alias**: `parseTableAliases(sql)` extrae `tbl [AS] alias` de `FROM`/`JOIN`
4. **Escanear 4 tipos de cláusula**; cada hit pondera con score base:

| Cláusula | Base | Comentario |
|---|---|---|
| `WHERE col = ?` / `LIKE` / `IN` / `IS NULL` / `BETWEEN` | 5 | Señal fuerte |
| `JOIN ON a.col = b.col` | 3 | Ambos lados suman |
| `ORDER BY col` | 2 | El ordenado necesita índice ordenado |
| `GROUP BY col` | 2 | Igual para agrupado |

5. **Peso temporal**: por SQL `count × min(perMs/avgMs, MAX_TIME_MULTIPLIER=5)`, para que un par de consultas lentas no anulen a la tabla
6. **SQL multitabla**: solo cuenta nombres de columna con alias; **SQL de una tabla**: permite nombres desnudos
7. **Filtrar lo ya cubierto**: `isCovered(table, cols, known)` descarta sugerencias que ya estén cubiertas por el prefijo de un índice existente
8. **Sugerencias compuestas**: por tabla, los 3 mejores se emparejan dos a dos para generar índices de dos columnas

### Generación del DDL

```ts
function buildDdl(table, columns, dialect) {
  const idxName = `idx_${sanitize(table)}_${cols.map(sanitize).join('_')}`.slice(0, 60)
  return `CREATE INDEX ${quoteIdent(idxName)} ON ${quoteIdent(table)}(${cols.map(quoteIdent).join(', ')});`
}
```

MySQL usa backticks \``\`; PG usa comillas dobles `"`.

### Flujo UI

Al abrir, `run()` automáticamente: escanea → lista candidatos (ordenados por `scoreEstimate`). Por fila:

- `[Adoptar]` → `emit('runSql', h.ddl)` envía el DDL al QueryPane (el usuario revisa y ejecuta)
- `[Copiar todo]` copia al portapapeles todos los candidatos
- `[Rescanear]` repite el proceso

Soporta familias MySQL / PG; en otros dialectos muestra "Sin soporte".

---

## 3. Inspector de datos — DataInspector

Clic derecho en una tabla → `🔬 Inspector`. Un diálogo con 5 pestañas para "salud del dato + mantenimiento de un clic", clave para diagnóstico DBA. **No corre SQL en paralelo** (para no saturar producción): cada pestaña tira sus datos cuando se abre.

### Pestaña 1: Muestreo de columna (A3)

Eliges una columna y una sola SQL trae todas las estadísticas:

```sql
SELECT
  COUNT(*) AS total,
  COUNT(col) AS non_null,
  COUNT(DISTINCT col) AS distinct_cnt,
  MIN(col) AS min_val,
  MAX(col) AS max_val
FROM <table>
```

Y otra para el top-10:

```sql
SELECT col AS value, COUNT(*) AS cnt
FROM <table> GROUP BY col ORDER BY cnt DESC LIMIT 10
```

Se muestran como tarjetas + tabla top-N. NULL% alto / distinct mínimo (posible enum) / extremos anómalos se ven al instante.

### Pestaña 2: Perfilado de la tabla entera (B6)

Un SELECT calcula simultáneamente `COUNT(col)` + `COUNT(DISTINCT col)` para todas las columnas:

```sql
SELECT COUNT(*) AS total,
       COUNT(`a`) AS nn_a, COUNT(DISTINCT `a`) AS dc_a,
       COUNT(`b`) AS nn_b, COUNT(DISTINCT `b`) AS dc_b,
       ...
FROM <table>
```

Tabla resultado: `columna | tipo | NULL% | DISTINCT/total`. NULL% > 50 se marca amarillo: "puede que esta columna nadie la use".

### Pestaña 3: Escaneo de restricciones (B5)

Para columnas declaradas `IS_NULLABLE = 'NO'`, ejecuta `SELECT COUNT(*) WHERE col IS NULL`. Hits > 0 son **violaciones de restricción** (típico: NOT NULL añadido a posteriori sin limpiar los nulos previos).

### Pestaña 4: Sugerencias de tipo (B9)

Recorta tipos por estrategia:

| Tipo actual | Comprobación | Sugerencia |
|---|---|---|
| `VARCHAR(255)` | `MAX(CHAR_LENGTH(col))` real | `VARCHAR(max(32, ceil(maxlen*1.5)))` si declared > maxlen*4 y diferencia > 50 |
| `BIGINT` | `MAX(ABS(col))` | Si < 2³¹-1 → `INT` |
| `INT` | Igual | Si < 32767 → `SMALLINT` |

Cada sugerencia incluye la justificación (`Máx real 20; declarado 255; desperdicia 235 bytes`).

### Pestaña 5: Mantenimiento (B10)

Botones por dialecto:

| Dialecto | Botones |
|---|---|
| Familia MySQL | `ANALYZE TABLE` / `OPTIMIZE TABLE` / `CHECK TABLE` |
| Familia PG | `ANALYZE` / `VACUUM FULL` / `VACUUM` / `REINDEX TABLE` |

Doble confirmación (VACUUM FULL bloquea la tabla).

---

## 4. Reparación de datos — DataFixup

Clic derecho en tabla → `🩹 Reparación`. Tres pestañas con la misma estructura "condiciones → generar SQL → revisar → ejecutar". **No commitea directamente**: lanza el SQL como pending al QueryPane.

### Pestaña 1: Detección de duplicados (B3)

Marcas algunas columnas como **clave de negocio** (`email + tenant_id`); primero `GROUP BY` para detectar:

```sql
SELECT col1, col2, COUNT(*) AS cnt
FROM <table>
GROUP BY col1, col2 HAVING COUNT(*) > 1
ORDER BY cnt DESC LIMIT 100
```

Confirmados los duplicados, `Generar SQL de limpieza` produce un DELETE con `ROW_NUMBER()` (versión PG), con un comentario que ofrece la versión MySQL por self-join:

```sql
-- 留每组里 ROW_NUMBER() = 1 的那条,删其余
DELETE FROM <table>
WHERE (col1, col2, ctid) IN (
  SELECT col1, col2, ctid FROM (
    SELECT col1, col2, ctid,
           ROW_NUMBER() OVER (PARTITION BY col1, col2 ORDER BY ctid) AS rn
    FROM <table>
  ) sub WHERE sub.rn > 1
);
```

### Pestaña 2: Rellenar NULL (B4)

Eliges columna + estrategia:

| Estrategia | SET resultante |
|---|---|
| `literal` | `'<valor del usuario>'` |
| `avg` | `(SELECT AVG(col) FROM <table>)` |
| `min` / `max` | `(SELECT MIN/MAX(col) FROM <table>)` |
| `most_common` | `(SELECT col GROUP BY col ORDER BY COUNT(*) DESC LIMIT 1)` |

Finalmente: `UPDATE <table> SET col = <expr> WHERE col IS NULL;`, con comentario "antes de ejecutar, mira el COUNT del impacto".

### Pestaña 3: Recuperar soft-delete (B8)

Heurística sobre el nombre de columna (`deleted_at` / `is_deleted` / `deleted`). Según sea booleano o timestamp:

| Nombre | Generado |
|---|---|
| `is_deleted` / `*_flag` | `UPDATE ... SET col = FALSE WHERE col = TRUE` |
| `deleted_at` / otros timestamps | `UPDATE ... SET col = NULL WHERE col IS NOT NULL` |

Permite añadir un "WHERE extra" (`AND user_id = 42`) para acotar y no revivir todo de golpe.

---

## 5. Búsqueda de valor entre tablas — SearchValueDialog

`⌘K → Búsqueda entre tablas` o clic derecho en una celda → `🔎 Encuentra este valor en otras tablas` (el segundo prerrellena).

### Flujo

1. **Recolectar columnas de texto buscables** (`information_schema.columns`):
   - MySQL: `varchar / char / text / tinytext / mediumtext / longtext / json`
   - PG: `character varying / character / text / json / jsonb`
2. **Agrupar por tabla**: una SQL por tabla `SELECT * FROM t WHERE col1 LIKE :v OR col2 LIKE :v ... LIMIT 50`
3. **Ejecutar en paralelo** (máx 6 a la vez para no agotar el pool)
4. **Barra de progreso** + lista de hits

### Límites de rendimiento

En bases grandes hay miles de columnas; usa `table_prefix` (`user_*`) para acotar. `matchMode`: `contains` / `exact`:

- `contains` → `LIKE '%v%'` (más lento, más amplio)
- `exact` → `= 'v'` (más rápido, ideal para IDs exactos)

`maxPerTable` limita a 50 hits por tabla para no explotar memoria.

### Ejemplo

Diagnóstico en producción "por qué `alice@x.com` recibió la notificación":

1. ⌘K → Búsqueda entre tablas
2. Valor `alice@x.com`, modo `exact`
3. Una pasada por todas las bases → ves `users(email)` + `subscription(email)` + `mail_logs(to_addr)` con ese valor → traza el flujo

---

## 6. Historial de cambios de fila — RowHistoryDialog

Clic derecho sobre una fila → `⏱ Ver historial`.

### Búsqueda heurística de tabla espejo

Dada la PK de la fila (`{id: 42}`), escanea `information_schema.tables` para candidatas:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name LIKE '<base>_%'
   OR table_name = 'audit_<base>'
   OR table_name = '<base>_history'
```

El usuario elige en el `<datalist>` o teclea.

### Extraer historial

Filtra por PK y ordena por `changed_at / updated_at / created_at / version / revision` desc:

```sql
SELECT * FROM <shadowTable>
WHERE id = 42
ORDER BY changed_at, updated_at, created_at, version, revision DESC
LIMIT 200
```

Cada fila del resultado es una versión; las columnas son las del shadow; los strings se truncan a 80 caracteres.

---

## 7. Constructor visual de consultas — VisualQueryDialog

`⌘K → Constructor visual` o clic derecho en una base → `🎨 Constructor visual`.

**El MVP no usa lienzo arrastrable**; opta por una disposición "lista + tarjetas" más estable, útil de verdad y no solo demo.

### Layout

| Zona | Contenido |
|---|---|
| Izquierda | Todas las tablas de la base + buscador + checkboxes |
| Centro | Las tablas marcadas se despliegan en tarjetas; cada columna tiene checkbox (marca = entra al SELECT) |
| Arriba | Inputs WHERE / ORDER BY + caja `LIMIT` |
| Abajo | SQL generado en tiempo real + botón `Abrir como nueva consulta` |

### JOIN automático

Al marcar dos tablas detecta columnas "tipo FK" y genera `INNER JOIN`:

```ts
// inferConventionalFks
const m = /^(.+?)_id$|^(.+?)Id$/.exec(col.name)
// user_id → users.id  /  category_id → categories.id
```

Candidatos: `<base>` tal cual + plural simple (`user → users`, `category → categories`). Si no encuentra FK → degrada a `CROSS JOIN` con aviso visual.

### SQL generado

```sql
SELECT users.id AS users_id, users.name AS users_name,
       orders.id AS orders_id, orders.amount AS orders_amount
FROM users
  INNER JOIN orders ON users.id = orders.user_id
WHERE amount > 100
ORDER BY users.id DESC
LIMIT 200
```

Alias `<table>_<col>` para evitar colisiones entre tablas.

---

## 8. Gestión de particiones MPP — MppPartitionDialog

Para Doris / StarRocks (familia protocolo MySQL). Clic derecho en una base → `🗂 Particiones`.

### Campos

Llama a `SHOW PARTITIONS FROM <db>.<tbl>`:

| Campo | Significado |
|---|---|
| `PartitionId` / `PartitionName` | Metadatos |
| `State` | NORMAL / etc. |
| `PartitionKey` / `Range` | Columna y rango |
| `DistributionKey` / `Buckets` | Distribución y nº buckets |
| `ReplicationNum` | Réplicas |
| `StorageMedium` | HDD / SSD |
| `CooldownTime` | Tiempo de enfriamiento (degrada a HDD) |
| `DataSize` | Tamaño (formato KB/MB/GB) |

### Operaciones

| Botón | Acción |
|---|---|
| `+ Añadir partición` | Diálogo con cláusula `ADD PARTITION ...`; prefijo `ALTER TABLE <db>.<tbl>` automático |
| `DROP` por fila | Confirmación + `ALTER TABLE <db>.<tbl> DROP PARTITION <name>` |
| `🔄 Refrescar` | Re-ejecuta SHOW PARTITIONS |

---

## 9. Avanzado por dialecto

### 9.1 MysqlAdvancedDialog

Compatible con MySQL / MariaDB / OceanBase / TiDB / Doris / StarRocks. 3 pestañas:

| Pestaña | SQL |
|---|---|
| **Binlog** | `SHOW MASTER STATUS` + `SHOW BINARY LOGS` + `SHOW BINLOG EVENTS IN '<file>' LIMIT N` |
| **Estado de replicación** | Prioriza `SHOW REPLICA STATUS` (8.0+); fallback a `SHOW SLAVE STATUS` |
| **Variables / Estado** | `SHOW GLOBAL VARIABLES` / `SHOW GLOBAL STATUS` con filtro; en Variables puede `SET GLOBAL k = v` |

### 9.2 PgAdvancedDialog

Compatible con PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift. 3 pestañas:

| Pestaña | Fuente |
|---|---|
| **Extensions** | `pg_available_extensions`; un clic `CREATE EXTENSION IF NOT EXISTS "<name>" WITH SCHEMA "<schema>"` / `DROP EXTENSION` |
| **Publications / Subscriptions** | `pg_publication` + `pg_publication_tables` + `pg_subscription` (replicación lógica) |
| **Slots** | `pg_replication_slots` (slot_name / plugin / slot_type / active / restart_lsn / confirmed_flush_lsn / wal_status); botón `DROP_REPLICATION_SLOT` |

### 9.3 ClickHouseAdvancedDialog

4 pestañas, mayormente lectura sobre `system.*`:

| Pestaña | Fuente | Para qué |
|---|---|---|
| **Particiones** | `system.parts` (filtra active) | `rows / bytes_on_disk / data_compressed_bytes / marks / min_date / max_date / level`; `DROP / DETACH / ATTACH PARTITION` |
| **Mutation** | `system.mutations` | `is_done / command / parts_to_do / latest_failed_part / latest_fail_reason` |
| **Réplicas** | `system.replicas` | `is_leader / queue_size / inserts_in_queue / merges_in_queue / total_replicas / active_replicas / zookeeper_path` |
| **Metadata de tablas** | `system.tables` | `engine / total_rows / total_bytes / partition_key / sorting_key / primary_key / sampling_key / storage_policy` |

Filtro `database / table` en la cabecera de cada pestaña, imprescindible en clusters grandes.

---

## 10. Asistente Oracle → DM (达梦)

Escenario habitual en proyectos de outsourcing 信创: migrar una base Oracle a 达梦. `⌘K → Asistente Oracle → DM`.

### 5 pasos

| Paso | Acción |
|---|---|
| 1. **Elegir conexiones** | Filtra las configuradas; elige una `dialect == Oracle` y una `dialect == DM` |
| 2. **Elegir objetos** | Tira `tables / views / sequences / procedures`; todo marcado por defecto; checkboxes por grupo / individuales |
| 3. **Preview** | Cada objeto: `DBMS_METADATA.GET_DDL` → `translateDdl()` → muestra warnings y permite editar |
| 4. **Ejecutar** | `client.connections.execute(dstConnId, ddl)` por objeto; recoge errores sin abortar |
| 5. **Reporte** | Markdown con resumen + warnings; copiable / `saveText` |

### Reglas de traducción (`oracleToDm.ts`)

**Mapeo de tipos** (`TYPE_MAP`):

| Oracle | DM | Nota |
|---|---|---|
| `VARCHAR2` | `VARCHAR` | — |
| `NVARCHAR2` | `NVARCHAR` | — |
| `NUMBER` | `NUMERIC` | DM acepta NUMBER, pero NUMERIC es estándar |
| `CLOB` / `NCLOB` / `BLOB` | Mismos | — |
| `DATE` | `DATE` | ⚠ Oracle incluye hora; DM no |
| `TIMESTAMP` | `TIMESTAMP` | — |
| `RAW` / `LONG RAW` | `VARBINARY` | — |
| `LONG` | `CLOB` | Deprecado en Oracle |
| `BINARY_FLOAT` / `BINARY_DOUBLE` | `FLOAT` / `DOUBLE` | — |
| `ROWID` / `UROWID` | `VARCHAR(18)` / `VARCHAR(4000)` | DM sin equivalente; degradación |
| `XMLTYPE` | `XML` | Posiblemente reescribir XPath/XQuery |

**Implementación del reemplazo**: coincidencia por "claves largas primero" (`LONG RAW` antes que `LONG`); `NUMBER` desnudo sin longitud no rellena; `NUMBER(p,s)` se copia; cada hit añade el warning `TYPE_NOTES` correspondiente.

**Mapeo de funciones / keywords** (`FN_MAP`):

| Oracle | DM | Nota |
|---|---|---|
| `SYSDATE` / `SYSTIMESTAMP` | `CURRENT_TIMESTAMP` | DM acepta SYSDATE; CURRENT_TIMESTAMP es portable |
| `NVL(a, b)` | `COALESCE(a, b)` | DM admite NVL; COALESCE es más estándar |
| `NVL2(...)` | Igual | Si no soportado: `CASE WHEN expr IS NOT NULL THEN a ELSE b END` |
| `MINUS` | `EXCEPT` | DM acepta MINUS; EXCEPT es estándar |
| `DUAL` / `ROWNUM` | Igual | Soportado en DM |

**Avisos sintácticos complejos** (`HARD_WARNINGS`; no cambia el SQL, solo emite `[review]`):

| Patrón | Mensaje |
|---|---|
| `DECODE(...)` | Sigue válido; revisa pasar a `CASE WHEN` por legibilidad |
| `CONNECT BY` | Mayoría compatible; `NOCYCLE` / `SYS_CONNECT_BY_PATH` requieren revisión manual |
| `MERGE INTO` | Ramas complejas (`DELETE WHERE` / múltiples sources `UPDATE`) pueden diferir |
| `INSTEAD OF (INSERT/UPDATE/DELETE) TRIGGER` | Semántica diferente en DM; cuerpos a migrar manualmente |
| `SDO_GEOMETRY` / `MDSYS.*` | Oracle Spatial sin equivalente; DMGeo o tercero |
| `DBMS_*` | Solo emulación parcial (`DBMS_OUTPUT`/`DBMS_LOB`); paquetes de negocio se reescriben |
| `UTL_*` (`UTL_HTTP`/`UTL_FILE`) | Normalmente no soportado; sustituir con script externo |
| `INTERVAL YEAR/DAY TO ...` | Versiones antiguas solo aceptan formas simplificadas |
| `PIVOT(...)` / `UNPIVOT(...)` | DM 8.x soporte parcial; antiguas → `CASE WHEN` agregado |
| `BULK COLLECT` / `FORALL` | DMSQL difiere ligeramente en sintaxis PL/SQL masiva |

### Lo que no se hace a propósito

- **Sin traducción semántica de bloques PL/SQL**: solo se migra el CREATE del SP; el cuerpo lo revisa el usuario
- **Sin traducción de cuerpos de triggers**
- **Sin orden de dependencias**: lexicográfico; si falla, se vuelve a correr
- **Sin atomicidad transaccional**: cada objeto va por su cuenta; los fallos se marcan en rojo

### Migración de datos (experimental)

Si marcas "Incluir datos (primeras 100 filas)" en el Paso 4:

```sql
-- 源
SELECT * FROM "<table>"  -- 限 100 行

-- 目标
INSERT INTO "<table>" (col1, col2, ...) VALUES (v1, v2, ...)  -- 逐行
```

Solo un **esqueleto**: una migración completa requiere paginación + conversión de tipos + inserción en bloque; el asistente lo deja para después. En producción, mejor DTS / `expdp + impdp`.

### Reporte

Tras la ejecución, paso 5: Markdown como este:

```markdown
# Oracle → DM 迁移报告

- 源连接: `prod-oracle`
- 目标连接: `dm-test`
- 时间: 2026-05-30 10:23:11
- 总对象数: 142,成功 138,失败 4

## 成功对象
- [tables] ORDERS (124ms)
- [tables] USERS (89ms)
...

## 失败对象
- [procedures] CALC_BONUS
  - 错误: ORA-00942 表或视图不存在

## 翻译警告(人工 review)
- (ORDERS) [type] DATE: Oracle DATE 含时分秒,DM DATE 不含;原列若依赖时间分量请改用 TIMESTAMP
- (ORDERS_REPORT) [review] PIVOT/UNPIVOT:DM 8.x 起部分支持,旧版本需改写为 CASE WHEN 聚合
```

Botones `Copiar` al portapapeles o `Guardar` como `.md`.

---

## 11. ¿Cuándo usar qué?

Tabla "el remedio adecuado":

| Quiero... | Herramienta |
|---|---|
| Ver dónde se atasca una consulta lenta | **PlanPanel** + ANALYZE |
| No sé qué índices crear | **IndexRecommender** |
| Auditar la salud de una tabla nueva | **DataInspector** (perfilado + sugerencias de tipo) |
| Limpiar datos sucios / duplicados | **DataFixup** |
| Localizar dónde aparece un valor | **SearchValueDialog** |
| Ver el historial de una fila | **RowHistoryDialog** |
| Mostrar a un compañero no técnico cómo construir una consulta | **VisualQueryDialog** |
| Gestionar particiones Doris | **MppPartitionDialog** |
| Binlog MySQL / lag de replicación | **MysqlAdvancedDialog** |
| Instalar extensiones PG / replicación lógica | **PgAdvancedDialog** |
| Ver parts / Mutations en CH | **ClickHouseAdvancedDialog** |
| Migrar Oracle a 达梦 | **OracleToDmWizard** |

Combina con el [Asistente de IA](./ai) y multiplica la potencia: el PlanPanel detecta un nodo lento y "Preguntas a la IA"; el IndexRecommender propone candidatos y la IA te los explica; el DataInspector sugiere tipos y la IA evalúa el riesgo.
