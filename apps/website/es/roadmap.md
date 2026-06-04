---
title: Hoja de ruta
description: Próximas bases de datos y planes de funciones de SkylerX, actualizados cada trimestre.
---

# Hoja de ruta

> Última actualización: 2026-06-04
> Plan direccional, no es un compromiso. La cadencia real depende del feedback y los recursos.
> Fuente completa: [ROADMAP.md en GitHub](https://github.com/duhbbx/SkylerX/blob/main/ROADMAP.md)

¿Quieres impulsar algo?

- 👍 vota en el [issue](https://github.com/duhbbx/SkylerX/issues) correspondiente
- Abre una nueva petición: [New Feature Issue](https://github.com/duhbbx/SkylerX/issues/new/choose)
- Discute la arquitectura: [Discussions](https://github.com/duhbbx/SkylerX/discussions)

## Leyenda

- ✅ Publicado
- 🟢 En curso / este trimestre
- 🔵 Próximo trimestre
- ⚪ Candidato — la prioridad cambia con el feedback
- 🟣 Largo plazo / requiere cambios de arquitectura

---

## 1. Soporte de bases de datos

### 1.1 Ya soportadas (a fecha de 2026-05)

| Categoría | Drivers |
|---|---|
| **Relacional (OSS)** | MySQL · MariaDB · PostgreSQL · SQLite · H2 |
| **Relacional (comercial)** | Oracle · SQL Server |
| **China / 信创** | DM (达梦) · KingbaseES (人大金仓) · OceanBase · TiDB · GBase |
| **Analíticas (MPP/OLAP)** | ClickHouse · Snowflake · Amazon Redshift · Apache Doris · StarRocks · DuckDB |
| **Series temporales** | TDengine |
| **NoSQL** | MongoDB · Redis · Elasticsearch |

### 1.2 Plan de incorporación

#### 🟢 2026 Q3 (jul–sep)

| Base de datos | Tipo | Notas |
|---|---|---|
| **PolarDB-PG / -X** | Nativa de nube | Reutiliza el driver existente |
| **GaussDB (Huawei)** | 信创 | Modo compatible con PG |
| **TimescaleDB** | Series temporales (ext. PG) | Hypertables / agregados continuos |
| **Cassandra / ScyllaDB** | NoSQL wide-column | CQL sobre el canal SQL |
| **InfluxDB 3.x** | Series temporales | FlightSQL |

#### 🔵 2026 Q4 (oct–dic)

| Base de datos | Tipo | Notas |
|---|---|---|
| **Trino / Presto** | SQL federado | API HTTP, el árbol de catálogos mapea subfuentes |
| **Apache Hive (HS2)** | SQL big-data | JDBC sobre Kerberos / LDAP |
| **Neo4j** | Grafo | Bolt + Cypher, canal nuevo |
| **Couchbase** | NoSQL multimodelo | N1QL |
| **AWS DynamoDB** | KV / documento | PartiQL, canal NoSQL |
| **pgvector / Milvus / Qdrant** | Vectorial | Visor dedicado de campos vectoriales |

#### ⚪ Candidatas para 2027 H1

Apache IoTDB · Nebula Graph · SequoiaDB · GreatSQL · Hologres (Aliyun PG) · Lindorm (Aliyun HBase) · TDSQL-C (Tencent) · QuestDB · Apache Druid · Apache Pinot · Flink SQL Gateway · Materialize · RisingWave · Vertica · BigQuery · Athena

#### 🟣 Largo plazo (según la demanda)

Apache HBase · Impala · DynamoDB Streams · Cassandra CDC · visores LMDB / RocksDB · Weaviate / Chroma · ArangoDB (multimodelo)

---

## 2. Hoja de ruta de funciones

### 2.1 Editor y experiencia de consulta

| Estado | Función |
|---|---|
| ✅ | SQL Linter + autocompletado inline con IA |
| ✅ | Historial de consultas con etiquetas + fijado |
| ✅ | **Modo Notebook** — SQL / Markdown multi-celda, persistido localmente; al estilo Jupyter |
| 🟢 | **Visual Query Builder** — JOIN por arrastre, auto-JOIN, agregación por GUI |
| 🔵 | **Speech-to-SQL** — Whisper offline → traducción con IA |
| 🔵 | **Traductor de SPs entre dialectos** — Oracle PL/SQL ↔ PG PL/pgSQL ↔ DM |
| ✅ | **Editor de reglas de linter personalizadas** — patrones prohibidos / reglas de estilo definidos por el usuario (coincidencia por regex + nivel de severidad) |
| ⚪ | Biblioteca de snippets + sincronización entre dispositivos |

### 2.2 Experiencia del grid de resultados

| Estado | Función |
|---|---|
| ✅ | Edición inline + commit de DML, "Pregunta a la IA" ante errores, visor de celdas |
| ✅ | **Diff de resultados de consulta** — compara dos conjuntos de resultados por fila / celda, marcando añadidos / eliminados / modificados |
| ✅ | **Enmascarado al exportar** — con el enmascarado activado, copiar / exportar (CSV/JSON/SQL/…) enmascara columnas completas según las reglas, de forma consistente con el grid — se acabó el "muestra enmascarado, exporta en texto plano" |
| 🟢 | **Vista Form** — editor vertical de una sola fila para tablas anchas |
| 🟢 | **Filtro multi-valor estilo Excel** |
| 🔵 | **Vínculo Maestro/Detalle** — selecciona una fila, carga automáticamente las tablas relacionadas |
| 🔵 | **Desplegable de búsqueda de FK** al editar columnas FK |
| ⚪ | Expansión de columnas por JOIN en vivo · Pivot · Visor en árbol de columnas JSON |

### 2.3 Esquema y modelado

| Estado | Función |
|---|---|
| ✅ | Generación de DDL · Diff de esquemas · Mock data v1 |
| ✅ | Asistente de migración Oracle → DM |
| ✅ | **Evaluación de migración** — perfilado del origen (17 categorías de objetos + métricas de riesgo) + calificación A/B/C/D + conversión de PL/SQL con IA + exportación a Word/PDF/Excel; diseño IR hub-and-spoke |
| ✅ | **Auto-disposición de diagramas ER** — ingeniería inversa desde el esquema en vivo, auto-enlaces de claves foráneas (hijo → padre), tamaño de nodo según número de columnas, tablas PK resaltadas, foco en una tabla + vecinos, exportación a PNG / SVG |
| 🔵 | **Ingeniería directa (forward)** — edita el diagrama ER → emite la migración |
| ✅ | **Migración entre bases de datos v2** — IR hub-and-spoke: parsea MySQL/Oracle/DM/SQL Server → emite PG/Oracle/DM/MySQL con tipos / índices / vistas / FKs completos; migración de datos (parametrizada por bloques + incremental + validación) |
| ✅ | **Grafo de linaje de datos** — parsea SQL → linaje a nivel de tabla (a nivel de columna en la hoja de ruta) |
| ⚪ | Integración con dbt · Linaje a nivel de columna |

### 2.4 DBA / operaciones

| Estado | Función |
|---|---|
| ✅ | Visualizador de EXPLAIN · sparklines de consultas lentas · Health check v1 |
| ✅ | **Killer de consultas de larga duración** — lista de procesos/sesiones entre dialectos (MySQL `information_schema.PROCESSLIST` / PG `pg_stat_activity` / MSSQL `sys.dm_exec_requests` / Oracle `v$session`); KILL por fila con confirmación escribiendo `KILL` en conexiones de producción |
| 🟢 | **Detección de índices muertos** + estadísticas de tamaño |
| 🟢 | **Consulta lenta → reescritura automática + sugerencia de índice** |
| 🔵 | Dashboard de retraso de replicación |
| ✅ | **Predicción de tendencia de crecimiento de almacenamiento** — snapshots de tamaños de db/tablas, ajuste de curva de capacidad a 7/30/90 días + aviso de límite |
| ⚪ | Tuning del pool de conexiones · Log de auditoría firmado · Planificador de backups |

### 2.5 IA

| Estado | Función |
|---|---|
| ✅ | Chat de IA · Pregunta a la IA ante errores · Mock data v1 · Health check v1 |
| 🟢 | **Mock data v2** — consciente de FKs entre tablas + campos semánticos (nombres, direcciones, teléfonos) |
| 🟢 | **Health check v2** — biblioteca de anti-patrones ampliada a más de 50 comprobaciones |
| 🔵 | **Completado en streaming (estilo Cursor)** — sugerencias a medida que escribes |
| ✅ | **RAG sobre esquema + docs** — esquema (tablas / vistas / funciones) + docs troceados → vector (compatible con OpenAI /v1/embeddings) + recuperación híbrida BM25 (fusión RRF) + umbral de relevancia; inyecta solo las tablas relevantes en el contexto de la IA; fallback léxico elegante cuando no hay embeddings |
| ⚪ | Reglas de enmascarado sugeridas por IA · SQL → diagrama ER |

### 2.6 Colaboración / multi-dispositivo

| Estado | Función |
|---|---|
| ✅ | Multi-ventana · i18n en 7 idiomas |
| 🔵 | **Sincronización de conexiones cifrada de extremo a extremo (E2E)** — entre dispositivos, cifrada en reposo |
| 🔵 | **Biblioteca de queries en equipo** — solo lectura / comentario / fork |
| ⚪ | Edición web · Visor móvil de solo lectura |
| 🟣 | Consulta en pareja en tiempo real (protocolo Yjs) |

### 2.7 Integraciones y exportación

| Estado | Función |
|---|---|
| ✅ | Exportación a CSV / Excel / JSON / SQL / Parquet / Markdown |
| ✅ | **Visor de gráficos (ECharts)** — un clic desde el grid de resultados: línea / barras / pastel / dispersión; autodetecta columnas numéricas para Y, no numéricas para X; admite zoom + multi-serie; renderizado en el hilo principal hasta 5000 filas |
| 🔵 | **Presets de gráficos / dashboards** — guarda "esta query → este gráfico" para reutilizar |
| 🔵 | **Exportación a BI** — fuentes de datos de Metabase / Superset / PowerBI / Tableau |
| ⚪ | Endpoints mock REST / GraphQL |

### 2.8 Plugins / extensibilidad

| Estado | Función |
|---|---|
| 🔵 | **API de plugins de drivers de terceros** |
| ⚪ | Plugins de formatos de exportación / plugins de temas |

### 2.9 Árbol de navegación / navegación del workspace

El NavTree es el punto de entrada del 95 % del trabajo diario — una oleada de mejoras que acaba de llegar:

| Estado | Función |
|---|---|
| ✅ | **Multi-selección + operaciones por lotes** — Ctrl/⌘+clic / Shift+rango; DROP / TRUNCATE / mover a grupo / copiar plantilla SELECT / exportar DDL / probar conexiones en paralelo; el SQL por lotes usa multi-destino nativo donde se admite (PG `DROP TABLE a, b, c`) o secuencial fail-fast en el resto (Oracle/DM/SQLite). Refs #25 |
| ✅ | **Arrastrar para ajustar el ancho** — 200-600px, doble clic restablece, persistido en los ajustes. Refs #17 |
| ✅ | **Filtro de DB/Schema visibles por conexión** — chip N/M estilo DataGrip junto al nombre de la conexión; v2 admite filtro de schema por base de datos (escenario PG con 50 schemas en una sola DB). Refs #24 |
| ✅ | **Búsqueda local en el árbol (Ctrl/⌘+F)** — filtro en vivo sobre los nodos cargados, expande forzosamente las ramas con coincidencias |
| ✅ | **Índice de objetos de todo el catálogo + búsqueda entre árboles** — caché plana de catálogo por conexión (~5MB / 100k objetos / escaneo de 10ms); construcción silenciosa en segundo plano en la primera búsqueda; las coincidencias aparecen sobre el árbol; cubre tablas / vistas / funciones / procedimientos / secuencias / triggers / índices; filtrado por pill de tipo |
| ✅ | **Clic-para-enlazar de claves Redis** — un solo clic sobre una clave Redis en la navegación enfoca la pestaña RedisPane correspondiente y selecciona la clave; no abre una pestaña nueva. Refs #19 |
| ✅ | **Completitud de tipos de objeto entre dialectos** — Oracle/DM (incl. la corrección del object_type `CLASS` de DM para tipos), Vastbase/openGauss + toda la familia PG (vistas materializadas / procedimientos / tipos; openGauss también packages / synonyms), SQL Server (funciones / procedimientos / triggers / secuencias / tipos / synonyms) |
| ✅ | **Excluir DBs/schemas de sistema con un clic** — en la configuración de DBs/schemas visibles, un clic desmarca las DBs/schemas de sistema (mysql / pg_catalog / SYS / SYSAUDITOR …), sin tocar los objetos de usuario; los dialectos de un solo nivel (MySQL, etc.) dejan de mostrar un desplegable de schema inútil |
| ✅ | **Copiar info de conexión** — clic derecho en una conexión → submenú "Copiar info de conexión": URL JDBC / JSON / multi-línea / una línea (;) — nunca incluye la contraseña |
| ✅ | **Mover a grupo (combobox)** — mover en bloque a un grupo: elige un grupo existente del desplegable o escribe un nombre nuevo (recortado, creado si no existe); vacío = quitar del grupo |
| 🟢 | **Buscador global de objetos Cmd+Shift+P** — modal difuso entre conexiones, complementa la búsqueda dentro del árbol |
| 🔵 | **Persistir el índice en IndexedDB** — resultados de arranque en frío en milisegundos (con marcador de obsolescencia) |
| 🔵 | **revealObject para todos los tipos** — actualmente revela tablas/vistas en el árbol; ampliar a funciones / procedimientos / secuencias |
| ⚪ | **Operaciones por lotes entre conexiones seleccionadas** — p. ej. informe nocturno sobre todas las conexiones etiquetadas como `prod` |

---

## 3. Plataforma / ingeniería

| Estado | Elemento |
|---|---|
| ✅ | Matriz de builds multi-arquitectura (macOS arm/x64 · Windows · Linux) |
| ✅ | Espejo en Aliyun OSS + conmutador de canal de auto-actualización |
| 🟢 | **Firma de código** — Apple Developer + Windows (vía SignPath OSS) |
| 🟢 | **Reporte de crashes** — Sentry auto-alojado con source maps |
| 🔵 | E2E con Playwright + matriz de CI |
| 🔵 | Integración con Codecov |
| ⚪ | AppImage / Snap / Flatpak / MS Store / MAS / tap de Homebrew |

---

## 4. Documentación / comunidad

| Estado | Elemento |
|---|---|
| ✅ | Sitio en 7 idiomas + SEO + Umami auto-alojado |
| ✅ | Docs de DBA / Esquema / NoSQL / Seguridad / IA / Productividad |
| 🟢 | **Tutoriales en vídeo** (Bilibili + YouTube, < 3 min por función principal) |
| 🔵 | Casos de éxito / Sitio público de changelog |

---

## Hitos

| Fecha | Destacado |
|---|---|
| 2026-06 | RAG sobre esquema (vector + híbrido BM25) · diagrama ER + exportación PNG/SVG · diff de resultados de consulta · enmascarado al exportar · completitud de tipos de objeto en la navegación entre dialectos · verificación en vivo del lector entre dialectos (DM/Oracle/MySQL/Vastbase) |
| 2026-05 | Ajustes de IA → SQLite cifrado · SEO en 7 idiomas · Umami auto-alojado |
| 2026-04 | Oleada de drivers ClickHouse / Snowflake / Doris / StarRocks / Redshift / H2 |
| 2026-03 | Canal NoSQL (MongoDB / Redis / Elasticsearch) · SQL Linter · IA inline |
| 2026-02 | Visualizador de EXPLAIN · sparklines de consultas lentas · asistente Oracle → DM |
| 2026-01 | Primera versión pública (MySQL / PG / Oracle / SQL Server / DM / KingbaseES) |

---

## ¿Quieres contribuir?

- Consulta [CONTRIBUTING.md](https://github.com/duhbbx/SkylerX/blob/main/CONTRIBUTING.md) para la configuración, las pruebas y las reglas de PR
- Nuevos drivers: copia cualquier `packages/core-driver/src/drivers/*` como plantilla
- La propia hoja de ruta vive en [ROADMAP.md](https://github.com/duhbbx/SkylerX/blob/main/ROADMAP.md) — los PRs son bienvenidos
