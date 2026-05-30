# Recursos avançados

Esta página reúne as capacidades para **usuários intensos (DBAs / engenheiros de dados / backend)**. Ficam em menus de contexto, na paleta `⌘K` ou em níveis mais profundos da toolbar; raramente usadas no dia a dia, mas indispensáveis em cenários como:

- Ver se o plano usa índice e qual nó é o mais lento
- Inferir quais índices criar com base no histórico de SQL
- Ver distribuição de valores / NULL ratio / tipos sobre-dimensionados de uma tabela
- Limpar duplicatas / preencher defaults históricos / recuperar soft-deleted
- Buscar onde um valor aparece em todo o banco
- Construir queries por drag-and-drop em vez de escrever SQL
- Gerenciar partições Doris/StarRocks / parts ClickHouse / binlog MySQL / extensões PG
- Migrar Oracle inteiro para DM (达梦)

Sequência "ver → editar → buscar → criar → migrar".

## 1. Visualização de EXPLAIN — PlanPanel

Quem escreve SQL conhece EXPLAIN, mas o texto puro não é claro. O SkylerX pendura um **painel Plan** ao lado do QueryPane que renderiza EXPLAIN como árvore + resumo.

### Gatilhos

| Entrada | Comportamento |
|---|---|
| Toolbar `📊 Plan` | EXPLAIN do SQL atual (sem executar) |
| `⌘⇧E` / Ctrl+Shift+E | Idem |
| `▶ Analyze` ao lado | EXPLAIN ANALYZE (**executa de verdade**; cuidado com DML) |

Internamente, `plan.ts → planQuery(dialect, sql, { analyze })`:

| Dialeto | Statement |
|---|---|
| PostgreSQL / Kingbase | `EXPLAIN (FORMAT JSON) <sql>` / `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) <sql>` |
| MySQL / MariaDB / OceanBase | `EXPLAIN FORMAT=TREE <sql>` / `EXPLAIN ANALYZE <sql>` (MySQL 8.0.18+) |
| Outros | Fallback EXPLAIN em tabela (renderizado em pre) |

### Renderização da árvore

JSON Plan do PG é parseado por `parsePgPlan` em árvore `PlanNode` e então `flattenPlan` em lista `{node, depth}`. Cada nó exibe:

- **Label**: `Seq Scan` / `Index Scan` / `Hash Join` ...
- **Detalhes**: `on users` / `using users_pk` / `inner join`
- **Barra de custo**: largura = `cost / maxCost * 60px`, gradiente verde→vermelho
- **Números**: `cost 1234.56 · est 1000 · act 1234 · 12.3ms` (act / ms apenas com ANALYZE)

### Operadores lentos coloridos

`PlanPanel` marca em vermelho os "1/3 mais caros":

```ts
function isSlow(node) {
  return node.cost >= maxCost.value * 0.33 && maxCost.value > 0
}
```

Fundo vermelho + label vermelho, **o que precisa otimizar aparece de cara**.

### Skew entre estimado e real

`estimateSkew(node)` calcula `max(est, act) / min(est, act)`. ≥ 10× = **estatísticas desatualizadas**; lateral amarelo + badge `⚠ 24×`. O resumo também aponta o "pior skew":

```ts
let skewWorst = null
for (const r of arr) {
  const sk = estimateSkew(r.node)
  if (sk == null) continue
  if (!skewWorst || sk > skewWorst.skew) skewWorst = { node: r.node, skew: sk }
}
```

Esse badge geralmente significa "`ANALYZE table`" ou "`pg_statistic refresh`".

### Resumo

Topo do painel:

| Campo | Significado |
|---|---|
| `Total Cost` | Cost do nó mais pesado (raiz acumulada) |
| `Actual ms` | Soma de tempos reais (com ANALYZE) |
| `Heaviest` | Nome do nó mais caro |
| `Skew` | Nó com maior desvio est vs act + múltiplo |

---

## 2. Recomendação de índices — IndexRecommender

`⌘K → Recomendar índices` ou clique direito no banco `🔧 Recomendar índices`.

### Entrada e saída

| Entrada | Origem |
|---|---|
| Padrões históricos | `client.connections.history(connId, 1000)` últimos 1000 |
| Índices existentes | MySQL `information_schema.STATISTICS` / PG `pg_index + pg_class` |

Saída: `IndexHint[]` — tabela, colunas, score combinado, motivo inferido, DDL `CREATE INDEX` executável.

### Algoritmo (`index-recommender.ts`)

Sem parser SQL (caro e por dialeto), usa **heurística regex** para extrair WHERE / JOIN / ORDER BY / GROUP BY:

1. **Agregação**: mesmo texto SQL → acumula `count + totalMs`
2. **Filtro**: somente `SELECT` / `WITH`, ignora DML/DDL
3. **Aliases**: `parseTableAliases(sql)` extrai `tbl [AS] alias` do `FROM`/`JOIN`
4. **Scan de 4 cláusulas**, score base por hit:

| Cláusula | Score base | Notas |
|---|---|---|
| `WHERE col = ?` / `LIKE` / `IN` / `IS NULL` / `BETWEEN` | 5 | Sinal forte |
| `JOIN ON a.col = b.col` | 3 | Ambos os lados pontuam |
| `ORDER BY col` | 2 | Ordenação precisa de índice ordenado |
| `GROUP BY col` | 2 | Idem para agrupamento |

5. **Peso temporal**: cada SQL `count × min(perMs/avgMs, MAX_TIME_MULTIPLIER=5)` — evita que 1-2 SQLs lentos dominem a tabela
6. **SQL multi-tabelas** exige alias; **single-tabela** permite coluna bare
7. **Filtra índices existentes**: `isCovered(table, cols, known)` (prefixo de índice existente cobre a sugestão) — skip
8. **Composto**: top-3 colunas por tabela pareadas duas a duas → sugestões compostas

### Geração DDL

```ts
function buildDdl(table, columns, dialect) {
  const idxName = `idx_${sanitize(table)}_${cols.map(sanitize).join('_')}`.slice(0, 60)
  return `CREATE INDEX ${quoteIdent(idxName)} ON ${quoteIdent(table)}(${cols.map(quoteIdent).join(', ')});`
}
```

MySQL usa backticks, PG usa aspas duplas.

### Fluxo

Ao abrir: `run()` → escaneia → lista candidatos (`scoreEstimate` desc). Cada linha:

- `[Adotar]` → `emit('runSql', h.ddl)` envia DDL ao QueryPane
- `[Copiar tudo]` → clipboard
- `[Re-escanear]` → re-roda

Apenas família MySQL / PG; outros mostram "não suportado".

---

## 3. Data Inspector

Clique direito na tabela `🔬 Inspecionar dados`. Um diálogo com 5 tabs cobrindo "ver saúde + manutenção de um clique". Por design, **não roda SQLs concorrentes** (medo de carga em prod): só busca dados quando o tab é aberto.

### Tab 1: Amostragem de coluna (A3)

Uma SQL para todas as estatísticas:

```sql
SELECT
  COUNT(*) AS total,
  COUNT(col) AS non_null,
  COUNT(DISTINCT col) AS distinct_cnt,
  MIN(col) AS min_val,
  MAX(col) AS max_val
FROM <table>
```

Mais o top-10:

```sql
SELECT col AS value, COUNT(*) AS cnt
FROM <table> GROUP BY col ORDER BY cnt DESC LIMIT 10
```

Cards de estatísticas + tabela top-N. NULL alto / distinct baixo (status) / valores extremos saltam à vista.

### Tab 2: Profile da tabela inteira (B6)

Uma SELECT grande com `COUNT(col)` + `COUNT(DISTINCT col)` para todas as colunas:

```sql
SELECT COUNT(*) AS total,
       COUNT(`a`) AS nn_a, COUNT(DISTINCT `a`) AS dc_a,
       COUNT(`b`) AS nn_b, COUNT(DISTINCT `b`) AS dc_b,
       ...
FROM <table>
```

Tabela: `coluna | tipo | NULL% | DISTINCT/total`. NULL% > 50 destaca amarelo.

### Tab 3: Scan de constraints (B5)

Lista colunas `IS_NULLABLE = 'NO'`; para cada uma, `SELECT COUNT(*) WHERE col IS NULL`. Hits > 0 = **violação** (sujeira histórica não limpa após adicionar NOT NULL).

### Tab 4: Sugestões de tipo (B9)

Por categoria:

| Tipo atual | Verifica | Sugere |
|---|---|---|
| `VARCHAR(255)` | `MAX(CHAR_LENGTH(col))` | `VARCHAR(max(32, ceil(maxlen*1.5)))` se declarado > maxlen*4 e gap > 50 |
| `BIGINT` | `MAX(ABS(col))` | Se < 2³¹-1 → `INT` |
| `INT` | Idem | Se < 32767 → `SMALLINT` |

Cada sugestão explica (`max real 20, declarado 255 desperdiça 235 bytes`).

### Tab 5: Manutenção (B10)

Por dialeto, 4 botões:

| Família | Botões |
|---|---|
| MySQL | `ANALYZE TABLE` / `OPTIMIZE TABLE` / `CHECK TABLE` |
| PG | `ANALYZE` / `VACUUM FULL` / `VACUUM` / `REINDEX TABLE` |

Confirmação dupla em cada (VACUUM FULL locka).

---

## 4. Data Fixup

Clique direito na tabela `🩹 Corrigir dados`. 3 tabs, mesmo skeleton "input → gerar SQL → revisar → executar". **Sem commit direto** — entrega o SQL ao QueryPane como pending.

### Tab 1: Detecção de duplicatas (B3)

Marque colunas como **chave de negócio** (`email + tenant_id`); GROUP BY para ver duplicados:

```sql
SELECT col1, col2, COUNT(*) AS cnt
FROM <table>
GROUP BY col1, col2 HAVING COUNT(*) > 1
ORDER BY cnt DESC LIMIT 100
```

Após confirmar, `Gerar SQL de limpeza` produz `DELETE` com `ROW_NUMBER()` (versão PG) e comentário com versão MySQL self-join:

```sql
-- Mantém ROW_NUMBER() = 1, deleta os outros
DELETE FROM <table>
WHERE (col1, col2, ctid) IN (
  SELECT col1, col2, ctid FROM (
    SELECT col1, col2, ctid,
           ROW_NUMBER() OVER (PARTITION BY col1, col2 ORDER BY ctid) AS rn
    FROM <table>
  ) sub WHERE sub.rn > 1
);
```

### Tab 2: Backfill NULL (B4)

Escolha coluna + estratégia:

| Estratégia | Expressão SET |
|---|---|
| `literal` | `'<valor>'` |
| `avg` | `(SELECT AVG(col) FROM <table>)` |
| `min` / `max` | `(SELECT MIN/MAX(col) FROM <table>)` |
| `most_common` | `(SELECT col GROUP BY col ORDER BY COUNT(*) DESC LIMIT 1)` |

Gera `UPDATE <table> SET col = <expr> WHERE col IS NULL;` com comentário "rode SELECT COUNT primeiro".

### Tab 3: Restaurar soft-delete (B8)

Heurística para encontrar colunas (`deleted_at` / `is_deleted` / `deleted`):

| Coluna | Gera |
|---|---|
| `is_deleted` / `*_flag` | `UPDATE ... SET col = FALSE WHERE col = TRUE` |
| `deleted_at` / timestamp | `UPDATE ... SET col = NULL WHERE col IS NOT NULL` |

WHERE adicional opcional (`AND user_id = 42`) para limitar o escopo.

---

## 5. Cross-table search — SearchValueDialog

`⌘K → Busca cross-table` ou clique direito em célula `🔎 Onde mais aparece esse valor` (pré-preenche).

### Fluxo

1. **Listar colunas "pesquisáveis"** (`information_schema.columns`):
   - MySQL: `varchar / char / text / tinytext / mediumtext / longtext / json`
   - PG: `character varying / character / text / json / jsonb`
2. **Agrupar por tabela**: cada tabela gera `SELECT * FROM t WHERE col1 LIKE :v OR col2 LIKE :v ... LIMIT 50`
3. **Paralelo** (max 6, evitar saturar pool)
4. **Progresso + hits**

### Performance

Bancos grandes têm milhares de colunas; use `table_prefix` (`user_*`). `matchMode`:

- `contains` → `LIKE '%v%'` (lento mas completo)
- `exact` → `= 'v'` (rápido, para IDs)

`maxPerTable` (50) impede que uma tabela enorme exploda a memória.

### Exemplo

Investigar "por que o usuário `alice@x.com` recebeu push":

1. ⌘K → Busca cross-table
2. Valor `alice@x.com`, modo `exact`
3. Scan: `users(email)` + `subscription(email)` + `mail_logs(to_addr)` → localiza o fluxo

---

## 6. Row history — RowHistoryDialog

Resultado: clique direito na linha → `⏱ Ver versões`.

### Tabelas-sombra (heurística)

Dado PK (`{id: 42}`), busca em `information_schema.tables`:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name LIKE '<base>_%'
   OR table_name = 'audit_<base>'
   OR table_name = '<base>_history'
```

`<datalist>` para escolher ou digitar.

### Histórico

`SELECT * FROM <shadow> WHERE id = 42 ORDER BY changed_at, updated_at, created_at, version, revision DESC LIMIT 200`. Cada linha = uma versão; strings truncadas em 80 chars.

---

## 7. Builder visual — VisualQueryDialog

`⌘K → Construtor visual` ou clique direito no banco `🎨 Visual`.

**MVP sem canvas drag-and-drop** — usa "lista + cards" mais robusto.

### Layout

| Área | Conteúdo |
|---|---|
| Esquerda | Todas as tabelas do banco + busca + checkbox |
| Centro | Tabelas marcadas viram cards; cada coluna tem checkbox (marcada vai a SELECT) |
| Topo | WHERE / ORDER BY + `LIMIT` |
| Rodapé | SQL em tempo real + `Abrir como nova aba` |

### JOIN automático

Marcadas duas tabelas, detecta "colunas com cara de FK", gera `INNER JOIN`:

```ts
// inferConventionalFks
const m = /^(.+?)_id$|^(.+?)Id$/.exec(col.name)
// user_id → users.id  /  category_id → categories.id
```

Plural simples (`user → users`, `category → categories`). Sem path, degrada para `CROSS JOIN` (aviso visual).

### SQL gerado

```sql
SELECT users.id AS users_id, users.name AS users_name,
       orders.id AS orders_id, orders.amount AS orders_amount
FROM users
  INNER JOIN orders ON users.id = orders.user_id
WHERE amount > 100
ORDER BY users.id DESC
LIMIT 200
```

Aliases `<table>_<col>` evitam conflito de nome.

---

## 8. MPP — gerenciamento de partição (MppPartitionDialog)

Para Doris / StarRocks (família MySQL). Clique direito no banco `🗂 Partições`.

### Campos

`SHOW PARTITIONS FROM <db>.<tbl>` retorna:

| Campo | Significado |
|---|---|
| `PartitionId` / `PartitionName` | Metadados |
| `State` | NORMAL etc. |
| `PartitionKey` / `Range` | Chave / range |
| `DistributionKey` / `Buckets` | Bucketing |
| `ReplicationNum` | Réplicas |
| `StorageMedium` | HDD / SSD |
| `CooldownTime` | Tempo para HDD |
| `DataSize` | Em KB/MB/GB |

### Ações

| Botão | Ação |
|---|---|
| `+ Nova partição` | Prompt para `ADD PARTITION ...`; prefixa `ALTER TABLE <db>.<tbl>` |
| `DROP` por linha | Confirmação + `ALTER TABLE <db>.<tbl> DROP PARTITION <name>` |
| `🔄 Refresh` | Re-roda SHOW PARTITIONS |

---

## 9. Avançado por dialeto

### 9.1 MysqlAdvancedDialog

MySQL / MariaDB / OceanBase / TiDB / Doris / StarRocks. 3 tabs:

| Tab | SQL |
|---|---|
| **Binlog** | `SHOW MASTER STATUS` + `SHOW BINARY LOGS` + `SHOW BINLOG EVENTS IN '<file>' LIMIT N` |
| **Replica status** | `SHOW REPLICA STATUS` (8.0+), fallback `SHOW SLAVE STATUS` (MariaDB / antigo) |
| **Variables / Status** | `SHOW GLOBAL VARIABLES` / `SHOW GLOBAL STATUS` com filtro; Variables permite `SET GLOBAL k = v` |

### 9.2 PgAdvancedDialog

PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift. 3 tabs:

| Tab | Origem |
|---|---|
| **Extensions** | `pg_available_extensions`; `CREATE EXTENSION IF NOT EXISTS "<name>" WITH SCHEMA "<schema>"` / `DROP EXTENSION` |
| **Publications / Subscriptions** | `pg_publication` + `pg_publication_tables` + `pg_subscription` |
| **Slots** | `pg_replication_slots` (slot_name / plugin / slot_type / active / restart_lsn / confirmed_flush_lsn / wal_status); `DROP_REPLICATION_SLOT` |

### 9.3 ClickHouseAdvancedDialog

4 tabs, todas em `system.*`, leitura:

| Tab | Origem | Uso |
|---|---|---|
| **Partições** | `system.parts` (active) | `rows / bytes_on_disk / data_compressed_bytes / marks / min_date / max_date / level`; `DROP / DETACH / ATTACH PARTITION` |
| **Mutation** | `system.mutations` | `is_done / command / parts_to_do / latest_failed_part / latest_fail_reason` |
| **Réplicas** | `system.replicas` | `is_leader / queue_size / inserts_in_queue / merges_in_queue / total_replicas / active_replicas / zookeeper_path` |
| **Tabelas (metadata)** | `system.tables` | `engine / total_rows / total_bytes / partition_key / sorting_key / primary_key / sampling_key / storage_policy` |

Todas têm filtros `database / table` no topo, essencial em clusters grandes.

---

## 10. Assistente de migração Oracle → DM (达梦)

Cenário comum em 信创: migrar um Oracle inteiro para 达梦. `⌘K → Oracle → DM` abre o assistente.

### Fluxo de 5 passos

| Passo | Ação |
|---|---|
| 1. **Conexões** | Lista conexões `dialect == Oracle` / `dialect == DM`, escolhe origem e destino |
| 2. **Objetos** | Carrega `tables / views / sequences / procedures`; todos marcados, alternáveis |
| 3. **Preview** | Cada objeto: `DBMS_METADATA.GET_DDL` → `translateDdl()` → warnings + editável |
| 4. **Executar** | `client.connections.execute(dstConnId, ddl)` por objeto; erros coletados, sem interromper |
| 5. **Relatório** | Markdown resumindo sucessos / warnings; Copy / saveText |

### Regras de tradução (`oracleToDm.ts`)

**Mapa de tipos** (`TYPE_MAP`):

| Oracle | DM | Notas |
|---|---|---|
| `VARCHAR2` | `VARCHAR` | — |
| `NVARCHAR2` | `NVARCHAR` | — |
| `NUMBER` | `NUMERIC` | DM aceita NUMBER, NUMERIC é mais padrão |
| `CLOB` / `NCLOB` / `BLOB` | iguais | — |
| `DATE` | `DATE` | ⚠ Oracle DATE inclui hora, DM DATE não |
| `TIMESTAMP` | `TIMESTAMP` | — |
| `RAW` / `LONG RAW` | `VARBINARY` | — |
| `LONG` | `CLOB` | Oracle deprecado |
| `BINARY_FLOAT` / `BINARY_DOUBLE` | `FLOAT` / `DOUBLE` | — |
| `ROWID` / `UROWID` | `VARCHAR(18)` / `VARCHAR(4000)` | DM sem equivalente |
| `XMLTYPE` | `XML` | XPath/XQuery podem precisar reescrita |

**Implementação**: ordenada por "chave mais longa primeiro" (`LONG RAW` antes de `LONG`); `NUMBER` bare sem comprimento não preenche; `NUMBER(p,s)` copia números. Cada hit adiciona warning de `TYPE_NOTES`.

**Mapa de funções / keywords** (`FN_MAP`):

| Oracle | DM | Notas |
|---|---|---|
| `SYSDATE` / `SYSTIMESTAMP` | `CURRENT_TIMESTAMP` | DM aceita SYSDATE, padrão é mais estável |
| `NVL(a, b)` | `COALESCE(a, b)` | DM aceita NVL, COALESCE é mais portável |
| `NVL2(...)` | mantém | Se não suportado, `CASE WHEN expr IS NOT NULL THEN a ELSE b END` |
| `MINUS` | `EXCEPT` | DM aceita MINUS, EXCEPT é padrão |
| `DUAL` / `ROWNUM` | mantém | DM suporta |

**Avisos de sintaxe complexa** (`HARD_WARNINGS`, não toca SQL, gera `[review]`):

| Padrão | Aviso |
|---|---|
| `DECODE(...)` | Funciona, mas sugira `CASE WHEN` para legibilidade |
| `CONNECT BY` | Mostly compat; `NOCYCLE` / `SYS_CONNECT_BY_PATH` etc. exigem revisão |
| `MERGE INTO` | Branches complexos (`DELETE WHERE` / `UPDATE` multi-source) podem divergir |
| `INSTEAD OF (INSERT/UPDATE/DELETE) TRIGGER` | Semântica de triggers DM difere |
| `SDO_GEOMETRY` / `MDSYS.*` | Oracle Spatial sem equivalente |
| `DBMS_*` | Apenas simulação parcial (`DBMS_OUTPUT`/`DBMS_LOB`) |
| `UTL_*` (`UTL_HTTP`/`UTL_FILE`) | Normalmente não suportado |
| `INTERVAL YEAR/DAY TO ...` | Algumas versões só suportam forma simplificada |
| `PIVOT(...)` / `UNPIVOT(...)` | DM 8.x parcial; versões antigas precisam `CASE WHEN` |
| `BULK COLLECT` / `FORALL` | DMSQL difere |

### O que não é feito

- **Não traduz semântica PL/SQL** — só migra shell de procedure; corpo manual
- **Triggers idem**
- **Não ordena dependências de constraints** — ordem lexicográfica; falha → re-run
- **Sem atomicidade transacional** — por objeto, falhas em vermelho

### Migração de dados (experimental)

Passo 4 com "incluir dados (100 linhas por tabela)":

```sql
-- Origem
SELECT * FROM "<table>"  -- limitado a 100

-- Destino
INSERT INTO "<table>" (col1, col2, ...) VALUES (v1, v2, ...)  -- por linha
```

Apenas esqueleto — migração completa exige paginação + conversão de tipos + batch. Para produção, use DTS / `expdp + impdp`.

### Relatório

Markdown exemplo:

```markdown
# Relatório de migração Oracle → DM

- Conexão fonte: `prod-oracle`
- Conexão alvo: `dm-test`
- Tempo: 2026-05-30 10:23:11
- Total: 142, sucesso 138, falha 4

## Objetos com sucesso
- [tables] ORDERS (124ms)
- [tables] USERS (89ms)
...

## Objetos com falha
- [procedures] CALC_BONUS
  - Erro: ORA-00942 tabela ou view não existe

## Avisos de tradução (review manual)
- (ORDERS) [type] DATE: Oracle DATE inclui hora, DM DATE não; se a coluna dependia de hora, use TIMESTAMP
- (ORDERS_REPORT) [review] PIVOT/UNPIVOT: DM 8.x parcial; versões antigas precisam de CASE WHEN
```

`Copiar` ou `Salvar` em `.md`.

---

## 11. Quando usar qual?

| Quero… | Use… |
|---|---|
| Ver onde uma SQL lenta trava | **PlanPanel** + ANALYZE |
| Não sei que índice criar | **IndexRecommender** |
| Avaliar a saúde de uma tabela nova | **DataInspector** profile + types |
| Limpar duplicatas / dados sujos | **DataFixup** |
| Onde aparece este valor? | **SearchValueDialog** |
| Histórico de uma linha | **RowHistoryDialog** |
| Demonstrar query para não-tech | **VisualQueryDialog** |
| Gerenciar partições Doris | **MppPartitionDialog** |
| MySQL binlog / replicação | **MysqlAdvancedDialog** |
| Extensão PG / replicação lógica | **PgAdvancedDialog** |
| CH part / Mutation | **ClickHouseAdvancedDialog** |
| Migrar Oracle para DM | **OracleToDmWizard** |

Use com [Assistente de IA](./ai) e multiplique — PlanPanel com nó lento → "Perguntar à IA"; IndexRecommender duvidoso → IA explica; DataInspector com sugestão de tipo → IA avalia risco.
