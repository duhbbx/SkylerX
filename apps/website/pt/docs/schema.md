# Gerenciamento de estrutura

Banco de dados não é só "enfiar dados"; passa-se muito mais tempo desenhando, alterando, conciliando e migrando tabelas. O SkylerX agrupa as capacidades relacionadas a estrutura num conjunto de ferramentas orientado a banco / tabela / Schema, do "somente leitura" ao "alinhamento de dois bancos", tudo num só lugar.

Esta página apresenta na ordem do mais leve ao mais pesado: **visualizar → desenhar → editar → diagrama ER → snapshots → comparação entre bancos → drift → criar banco/Schema → ajuda da IA**.

## Visão geral

| Ferramenta | Gatilho | Objetivo | Gera SQL? | Aplica direto no DB? |
|---|---|---|---|---|
| Estrutura de tabela (TableStructure) | Árvore esquerda: nó tabela → duplo clique (padrão) | Ver colunas/índices/chaves/DDL em modo leitura | — | Não |
| Designer de tabela (TableDesigner) | Clique direito na árvore → Nova tabela / Designar tabela | Criar tabela visualmente + ALTER ciente de diff | ✓ (preview) | ✓ (após confirmar) |
| Editor DDL (DdlEditor) | Clique direito na árvore → Novo / Editar view, função, procedure, trigger | Escrever / alterar DDL do objeto diretamente | ✓ (editor) | ✓ |
| Diagrama ER (ErdView) | Clique direito no schema → Diagrama ER | Visualização do banco completo + arrastar e soltar para criar tabelas / FK | ✓ (exporta .sql) | ✓ (aplicar ao DB) |
| Snapshots de schema (SchemaSnapshots) | Paleta `act:snapshots:{connId}` | Salva o DDL de todas as tabelas em localStorage para comparação futura | — | Não |
| Comparação de schemas (SchemaDiff) | Paleta `act:schema-diff` | Comparação horizontal entre duas conexões + gera script de alinhamento | ✓ (abrir em consulta) | Não |
| Drift de schema (SchemaDrift) | Paleta `act:drift` | Detecção profunda de drift entre duas conexões do mesmo dialeto (colunas/índices/FK) | ✓ (script de alinhamento) | ✓ (após confirmar) |
| Novo banco (NewDatabase) | Clique direito no nó de conexão → Novo banco | Gera `CREATE DATABASE` por dialeto | ✓ (preview editável) | ✓ |
| Novo Schema (NewSchema) | Clique direito no nó de banco → Novo Schema | PG / SQL Server / Oracle etc. | ✓ | ✓ |
| IA cria tabelas (SchemaArchitect) | Paleta → Assistente de IA para tabelas | Descrição de negócio → DDL multi-tabelas | ✓ | ✓ |
| IA reverse (SchemaReverse) | Paleta → Inferência reversa da IA | Dados de amostra → CREATE TABLE | ✓ | ✓ |

A seguir, cada item em detalhes.

## 1. Visualização da estrutura (TableStructure)

A maneira mais simples de "ver como é a tabela": clicar no nó de tabela na árvore abre uma aba somente leitura. Código em `packages/ui/src/components/TableStructure.vue`.

A interface tem quatro abas, com contagem no sufixo:

- **Campos** — nome / tipo / nullable / PK / valor padrão / comentário
- **Índices** — lista de nomes (detalhes vão no designer)
- **Chaves** — nomes de PK / FK / unique
- **DDL** — `CREATE TABLE` completo

A estratégia de obtenção do DDL varia por dialeto:

```ts
if (isMysql) {
  // Família MySQL: SHOW CREATE TABLE direto, o mais fiel
  const r = await client.connections.execute(connId, `SHOW CREATE TABLE ${ref}`)
  // pega row['Create Table']
}
// Não-MySQL: buildCreateFromColumns(...) monta um DDL simplificado pela info de colunas
```

Ou seja: **MySQL / MariaDB / OceanBase** retornam o DDL original do banco; PostgreSQL / Oracle / SQL Server etc. obtêm uma versão aproximada montada pelas colunas, suficiente mas sem GENERATED / EXTENDS.

Botão `⟳` no canto superior direito recarrega (`Promise.all([meta('columns'), meta('indexes'), meta('keys')])`), útil depois de alterar a tabela.

## 2. Designer visual (TableDesigner)

`packages/ui/src/components/TableDesigner.vue`, **880 linhas**, é o motor do gerenciamento de estrutura. Dois modos:

- `mode: 'create'` — nova tabela (do zero)
- `mode: 'alter'` — alterar tabela (carrega colunas + índices + FK existentes)

### Barra superior

| Botão | Ação |
|---|---|
| Novo / Reset | `resetTable()` zera para estado vazio |
| Salvar | Modo create → `CREATE TABLE`; modo alter → sequência de `ALTER TABLE` por diff |
| Salvar como | `prompt` para novo nome → `CREATE TABLE` com as colunas atuais (equivale a "copiar estrutura") |
| ➕ Campo / Inserir campo / Remover campo / PK / ⬆⬇ | splice direto no array de columns |
| Input do nome da tabela | Somente leitura em alter (renomear vai via RENAME, fora do escopo deste designer) |

### Abas internas (exibidas por dialeto)

O array `INNER` define 10 abas fixas: `fields / indexes / fk / unique / check / trigger / options / storage / comment / sql`. Cada aba é um sub-formulário reativo; mudanças refletem imediatamente no preview SQL.

**Tabela de campos** (edição inline):

| Coluna | Modo de edição |
|---|---|
| Nome do campo | input comum |
| Tipo | input + datalist (`type-list`), candidatos por dialeto (`typeOptions(dialect)`) |
| Comprimento / Precisão | input numérico |
| NULL / PK | checkboxes |
| Padrão / Comentário | input |

Abaixo da linha selecionada há a área "Propriedades do campo": apenas MySQL exibe `UNSIGNED / ZEROFILL / AUTO_INCREMENT / ON UPDATE CURRENT_TIMESTAMP / CHARSET / COLLATION`; todos exibem expressão `GENERATED`.

O dropdown de tipo de **índice** varia por dialeto: MySQL `BTREE / HASH / FULLTEXT / SPATIAL`, PG `btree / hash / gin / gist`. PG adiciona `WHERE` (índice parcial) e `CONC` (`CREATE INDEX CONCURRENTLY`, sem lock de tabela).

**Chaves estrangeiras** por dialeto: `ON DELETE / ON UPDATE` fixos em `CASCADE / SET NULL / RESTRICT / NO ACTION`; PG adiciona `MATCH FULL/PARTIAL/SIMPLE` e `DEFERRABLE`.

Aba **Opções**:

- MySQL: Engine / Charset / Collation / Row Format (`DYNAMIC / COMPRESSED / COMPACT / REDUNDANT`) / valor inicial de auto-increment
- PG: `TABLESPACE / FILLFACTOR / INHERITS`
- Outros: aviso de vazio

### ALTER ciente de diff (núcleo do modo alter)

Ao entrar em modo alter, `loadExisting()` chama `client.connections.metadata` para mapear colunas em `ColumnDef[]`; depois `loadIndexes()` / `loadForeignKeys()` puxam índices e FKs via `information_schema`. **Todo o snapshot é salvo como `original.value / originalIndexes.value / originalForeignKeys.value`** como baseline do diff.

`alterStmts` é `computed(() => buildAlterTable(dialect, tableRef, original.value, spec, { indexes: originalIndexes.value, foreignKeys: originalForeignKeys.value }))`.

`buildAlterTable` é um diff por coluna entre original e atual:

- Renomear coluna (com `originalName`) → `ALTER TABLE ... RENAME COLUMN / CHANGE COLUMN`
- Linha removida → `DROP COLUMN`
- Linha nova → `ADD COLUMN`
- Tipo / NULL / default / comentário alterado → `MODIFY COLUMN` (MySQL) ou `ALTER COLUMN` (PG/MSSQL)
- Índices / FKs comparados com `originalIndexes.value` → adições/remoções

A página de preview SQL (`inner === 'sql'`) mostra a lista de ALTERs gerada; sem alterações, exibe o placeholder `designer.noChanges`. **Salvar** executa cada ALTER individualmente via `client.connections.execute`; qualquer falha interrompe e foca na aba SQL, sem rollback dos sucessos (no contexto de alter table, é aceitável; o erro é exibido na barra).

### Dirty check + transição para alter após criar

A checagem de dirty usa `JSON.stringify({ tableName, spec })` contra a baseline; ao fechar a aba, o pai chama `isDirty()` para decidir se exibe "não salvo". Após salvar / resetar, a baseline é sincronizada.

Após criar com sucesso, o componente alterna `runtimeMode` para `alter` e marca as colunas recém-criadas como `originalName`. Cada salvamento subsequente vai via ALTER diff. Efeito: clica em salvar, a tabela é criada, a aba não fecha, dá para continuar adicionando colunas e alterando tipos — otimização do fluxo "ir desenhando enquanto pensa".

## 3. Editor DDL (view / função / procedure / trigger)

`packages/ui/src/components/DdlEditor.vue`. Objetos de schema fora do designer são escritos em SQL direto; este componente é um wrapper Monaco com detecção de dialeto.

- **mode: 'create'** — `objectTemplate(dialect, kind, ctx)` fornece um esqueleto mínimo (ex.: `CREATE VIEW v AS SELECT 1;`)
- **mode: 'edit'** — `objectDdlQuery(dialect, kind, ref, node)` busca a definição existente

`objectDdlQuery` retorna um de três modos:

| mode | Aplica a | Como obtém a definição |
|---|---|---|
| `showCreate` | Família MySQL | `SHOW CREATE VIEW / PROCEDURE / FUNCTION / TRIGGER`, pega do campo da row que começa com `^create` |
| `viewdef` | Views PG | `pg_get_viewdef(...)`, o componente concatena prefixo (`CREATE OR REPLACE VIEW ... AS\n`) |
| `funcdef` / `oracle-ddl` | Funções PG / DBMS_METADATA do Oracle | Lê direto de `row.ddl` |

Barra de ferramentas:

- **Salvar / Executar** (texto varia conforme o mode) — executa o trecho inteiro como uma única statement (corpo de função / procedure tem `;`, não pode dividir)
- **Formatar** — `sql-formatter` por dialeto: família `mysql` → mysql, família `pg` → postgresql, `sqlserver` → transactsql, `oracle/dm` → plsql. Em caso de falha, mantém original sem bloquear
- **Cancelar** — fecha a aba

A barra de erros mostra o erro original do backend; trigger / procedure costuma ter problema de `;` / `DELIMITER`.

## 4. Diagrama ER (ErdView)

`packages/ui/src/components/ErdView.vue`, canvas SVG desenhado à mão. Acesso: clique direito em um banco / Schema → Diagrama ER, abre uma aba `kind: 'erd'`.

### Modo visualização (padrão)

- Carrega todas as tabelas (`loadErd`, via `information_schema` / `pg_constraint` etc.) → layout em grade automático
- Scroll do mouse = zoom, arrastar no espaço vazio = pan
- Cada tabela pode ser arrastada para qualquer posição (incluindo coordenadas negativas; o canvas não corta)
- Topo: `－ / + / 1:1 / ⟳ / Editar` — zoom e refresh

### Modo edição (clique em "Editar")

Três alterações simultâneas, aplicadas no commit:

1. **Nova tabela** — `addTable()` cria uma caixa, com colunas, tipos e PK
2. **Nova FK** — pressione na porta à direita de qualquer coluna → arraste até a coluna de outra tabela e solte → `newFks.push(...)`; visualmente, linha tracejada roxa
3. **ALTER add column** (D1) — botão "+ ALTER add column..." de tabela existente → dois prompts (nome / tipo) → entra em `alterAddCols[tableName]`, exibido com destaque roxo e prefixo `+`

### Saída

`generateDdl()` chama `client.files.saveText`, produzindo um arquivo `.sql`:

```sql
CREATE TABLE "t1" (
  "id" int,
  ...
);

ALTER TABLE "orders" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id");

ALTER TABLE "users" ADD COLUMN "phone" varchar(64);
```

`applyChanges()` pega `buildDdl(true)` (apenas as adições), divide por `;\n` e usa `executeBatch` para enviar tudo à conexão atual; em sucesso, `load()` recarrega e volta ao modo visualização. Em falha, alerta — a estrutura do usuário não muda.

## 5. Snapshots de schema (SchemaSnapshotsDialog)

`packages/ui/src/components/SchemaSnapshotsDialog.vue`. Paleta: `act:snapshots:{connId}`.

Propósito: comparar DDLs **da mesma conexão em momentos diferentes**. Não se sobrepõe a SchemaDiff (duas conexões) ou SchemaDrift (drift profundo).

### Tirar snapshot

Clique em "📸 Tirar snapshot" → puxa todos os DDLs das tabelas do primeiro database/schema. MySQL via `SHOW CREATE TABLE`, PG com DDL simplificado (colunas + tipo + NULL + DEFAULT). Ao final, um prompt pede comentário ("antes do release / depois de mudar o sistema de pedidos / ..."), salvo em `localStorage['skylerx.schema-snapshots']`. Limite de `MAX_PER_CONN = 20` por conexão, com descarte LRU.

### Comparar

Selecione dois (acima de dois, descarta o mais antigo) → "⟷ Comparar". Algoritmo simples:

- Só em A → `added` (verde)
- Só em B → `removed` (vermelho)
- Em ambos, mas diferentes → `changed` (amarelo)
- Iguais → `same` (escondido por padrão)

Clique em uma linha de diff → painel duplo de DDL à direita para comparar a olho.

> Limitação: só observa o primeiro database/schema; cenários multi-bancos exigem snapshot por banco. Armazenamento em `localStorage` para não interferir nas migrações do SQLite; cota de 5MB cobre dezenas de tabelas × vinte snapshots.

## 6. Comparação de schemas (SchemaDiffDialog) — duas conexões + SQL de alinhamento

`packages/ui/src/components/SchemaDiffDialog.vue`. Paleta: `act:schema-diff`.

### Pré-requisitos

- Selecione conexão fonte + schema fonte, conexão destino + schema destino
- Devem ser da **mesma família** (MySQL ↔ MySQL / PG ↔ PG); cross-family é incompatível e a UI mostra "apenas MySQL ↔ MySQL / PG ↔ PG"

Ao trocar de conexão, `onPickSrc / onPickTgt` preenchem o schema default: PG → `public`, MySQL → `database` da config da conexão.

### Coleta + comparação

Executa em paralelo nos dois lados `information_schema.COLUMNS` (`TABLE_NAME / COLUMN_NAME / tipo / nullable / PK / default`), obtendo `TableSnapshot[]` → `diffSchemas` retorna três categorias: `added / changed / removed`. Cada linha changed traz `columnChanges` (`add / drop / modify`).

### Saída

`generateMigration` produz um SQL de alinhamento no dialeto destino, com cabeçalho resumindo quantas adições/alterações/remoções. Dois botões abaixo:

- **Copiar** — clipboard
- **Abrir na consulta da conexão destino** — `emit('openSql', tgtId, migration)`; o Workspace abre uma nova aba de query com o SQL para você revisar e executar. Garante que **não há aplicação automática**.

## 7. Detecção de drift de schema (SchemaDriftDialog)

`packages/ui/src/components/SchemaDriftDialog.vue`, **925 linhas**, mais profundo que SchemaDiff. Paleta: `act:drift`.

Diferença: SchemaDiff vê apenas colunas; DriftDialog também vê **índices** e **FKs**, e o script gerado pode ser **executado diretamente no SkylerX**.

### TableProfile

Cada tabela é normalizada como `TableProfile`: `columns: Map<name, {type, nullable, default, pk}>` + `indexes: Map<name, {unique, columns[]}>` + `fks: Map<name, "(c1,c2) → other(c1,c2)">`, além do DDL bruto para comparação visual.

Origem dos dados por dialeto: MySQL via `SHOW CREATE TABLE` + `information_schema.COLUMNS / STATISTICS / KEY_COLUMN_USAGE`; PG via `information_schema.columns` + `pg_indexes` (regex em `indexdef` para unique e colunas) + `information_schema.constraint_column_usage`.

### Relatório

Três colunas: **só na fonte / só no destino / conteúdo diferente**. A terceira expande mudanças de coluna (`+ name / − name / ~ name`), de índice (`+ idx_x`) e de FK (`~ fk_x`). Clique para abrir o DDL lado a lado.

### Script de alinhamento (saída-chave)

Cada linha tem um botão "+ Alinhar" que **anexa** o SQL de correção no preview de script:

| Estado | Instrução gerada |
|---|---|
| Só na fonte | Copia o DDL da fonte (`CREATE TABLE`) |
| Só no destino | `-- DROP TABLE \`x\`; -- comentado, descomentar manualmente` |
| Coluna add | `ALTER TABLE \`t\` ADD COLUMN \`c\` {srcType};` |
| Coluna drop | `-- ALTER TABLE ... DROP COLUMN ...` comentado (evitar deleções acidentais) |
| Coluna modify | MySQL: `MODIFY COLUMN`; PG: `ALTER COLUMN ... TYPE` |
| Diff de índice / FK | Apenas comentário `-- INDEX +xx` / `-- FK -xx`, **não gera SQL** (rebuild de índice tem sintaxe complexa, manual) |

Fluxo de execução: `▶ Executar script` → confirmação de alto risco → divide por `;\s*\n`, pula linhas `--` → `executeBatch`.

> Decisão de design: deleções são comentadas, adições / mudanças de tipo são executáveis. "Restritivo no destrutivo, permissivo no corretivo" — mais seguro em ops.

## 8. Novo banco (NewDatabaseDialog)

`packages/ui/src/components/NewDatabaseDialog.vue`. Clique direito no nó de conexão → Novo banco.

Modal: **Nome (obrigatório)** + "Opções avançadas" recolhidas (charset / collation / comentário) + **Preview SQL (editável)**. O que é executado é o texto do preview, não o formulário — pode adicionar `IF NOT EXISTS` manualmente.

### Matriz de dialetos

| Dialeto | Suporte | Notas |
|---|---|---|
| MySQL / MariaDB / OceanBase / TiDB / Doris / StarRocks | ✓ | `CREATE DATABASE \`n\` [DEFAULT CHARACTER SET ...] [DEFAULT COLLATE ...]` (sem COMMENT) |
| PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift | ✓ | `CREATE DATABASE "n" [ENCODING '...']` + `COMMENT ON DATABASE` separado |
| SQL Server | ✓ | `CREATE DATABASE [n]` (sem charset) |
| ClickHouse | ✓ | `CREATE DATABASE \`n\` COMMENT '...'` |
| Snowflake | ✓ | `CREATE DATABASE "n" COMMENT = '...'` |
| TDengine | ✓ | `CREATE DATABASE n` (sem aspas) |
| **Oracle / DM** | ✗ | Banco = nível de instância, requer DBCA. Sugere "criar schema (usuário) no lugar" |
| SQLite / DuckDB | ✗ | Baseados em arquivo, banco = arquivo, criados via nova conexão |
| H2 | ✗ | Definido por parâmetros de inicialização, não cria via SQL |
| MongoDB / Redis / Elasticsearch | ✗ | Via collection / index / db0-15, sem CREATE DATABASE |

Dialetos não suportados exibem aviso vermelho e não permitem submeter.

### Opções de charset

Recomendações por dialeto:

- Família MySQL: `utf8mb4 / utf8 / latin1 / gbk`, collation `utf8mb4_general_ci / unicode_ci / 0900_ai_ci / bin`
- Família PG: `UTF8 / SQL_ASCII / LATIN1 / GBK`

Submit divide por `;\s*\n` e executa uma a uma.

## 9. Novo Schema (NewSchemaDialog, tratamento especial para Oracle)

`packages/ui/src/components/NewSchemaDialog.vue`. Clique direito no nó de banco → Novo Schema.

### Matriz

| supportInfo | Dialeto | Sintaxe |
|---|---|---|
| `pg` | PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift | `CREATE SCHEMA "n" [AUTHORIZATION "owner"]` + `COMMENT ON SCHEMA` opcional |
| `sqlserver` | SQL Server | `CREATE SCHEMA [n] [AUTHORIZATION owner]` |
| `snowflake` | Snowflake | `CREATE SCHEMA "n" [COMMENT = '...']` |
| `oracle` | Oracle / DM | **Schema = User**, via CREATE USER + GRANT (veja abaixo) |
| `null` | MySQL / SQLite / ClickHouse / TDengine / NoSQL | Sem conceito de Schema, exibe "este dialeto não tem schema" |

### Tratamento especial Oracle / DM

No Oracle, "schema" é sinônimo de "user". O dialog faz defaults razoáveis para o cenário dev:

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

(Os placeholders `:name` / `:password` representam o usuário / senha que você preencher.)

Justificativas explicadas em comentários do código:

- `QUOTA UNLIMITED ON USERS` — sem isso, ao inserir dados o usuário recebe `ORA-01950: insufficient quota on tablespace USERS`
- Oracle 12c+ `RESOURCE` não inclui mais `CREATE VIEW / SEQUENCE` etc., precisa adicionar explicitamente o que dev costuma usar
- Não dá `SELECT ANY TABLE / DBA / SYSDBA` — mantém o usuário restrito ao seu schema
- Usuário / senha por padrão **sem aspas**: identificador unquoted válido vira maiúsculo (evita "criou com aspas em minúsculas → ALTER USER não acha"). Para preservar minúsculas ou caracteres especiais, adicione aspas no preview

Senha vazia é preenchida com placeholder `CHANGE_ME_123` para lembrar de trocar.

### Submit

`execute` com contexto `database` (em PG, schema pertence ao banco; faz USE antes de CREATE). Em falha, o toast inclui link `askAi` que envia SQL + erro para a IA (comum: tablespace inexistente / falta de permissão).

## 10. IA: Schema Architect + Schema Reverse

Duas ferramentas conversacionais; o SQL gerado fica para o usuário revisar antes de executar.

### Schema Architect (descrição de negócio → DDL multi-tabelas)

`packages/ui/src/components/AiSchemaArchitectDialog.vue`. Conversacional, várias iterações.

System Prompt (resumido):

> You are a senior database architect. The user describes a business domain.
> 1. Design **multiple related tables** with PK, FK, indexes for the **`{dialect}`** dialect.
> 2. Output a single ```sql code block containing the COMPLETE CREATE TABLE statements.
> 3. Explain key design decisions in 2-4 bullets.
> 4. When user asks to revise, output the FULL updated SQL again (not a diff).

Fluxo:

1. Descreva o negócio ("sistema de pedidos e-commerce: usuários, produtos, pedidos, itens, com cupons")
2. A IA responde markdown: descrição do design + bloco SQL completo
3. Continue perguntando ("adicione campo status" / "transforme order_items em tabela particionada") e a IA reemite **a versão completa**
4. Botão `▶ Executar versão mais recente` no topo — pega `latestSql` (SQL da última resposta), divide por `;\s*(?:\n|$)` → executa um a um

`latestSql` sempre pega a última versão — se iterou cinco vezes, executa a quinta, sem contaminação das anteriores.

### Schema Reverse (dados de amostra → CREATE TABLE)

`packages/ui/src/components/AiSchemaReverseDialog.vue`. Não-conversacional, ideal para "tenho um CSV, monte a tabela".

Inputs: **formato** (CSV / TSV / JSON) + **nome da tabela** + **dados de amostra** (algumas linhas com header é o ideal) + opção "gerar INSERT também".

O prompt obriga 4 seções de saída: **inferência** (coluna → tipo → motivo), **CREATE TABLE** (bloco `sql`), **INSERT (dados)** (opcional, bloco `sql`), **sugestões de índice** (bullets).

A IA responde e `extractSql(text)` extrai o primeiro bloco SQL para a caixa de edição abaixo — você ajusta e clica em `▶ Executar`.

> Sobre recomendações de índice: o Schema Reverse só sugere (heurística), não cria automaticamente. Recomendação baseada em SQL real + índices existentes → ver [Avançado e engenharia → Recomendação de índices](./advanced.md).

## 11. Avaliação de migração (MigrationAssessWizard)

Transforma um banco de origem Oracle / DM num relatório de viabilidade para migrar para um banco nacional com núcleo openGauss (Vastbase / openGauss) ou DM. Feito para pré-vendas / DBAs de projetos de-Oracle ("去O"): ver quanto, quão grande e quão difícil é a origem *antes* de assumir o esforço.

**Acesso**: paleta de comandos `act:mig-assess` (busque «Avaliação de migração»), ou clique direito numa conexão Oracle / DM → `🧭 Avaliação de migração…` (preenche-a como origem). Código em `packages/ui/src/components/MigrationAssessWizard.vue`; toda a lógica está em `packages/ui/src/migrate/`.

### Assistente de 5 passos

| Passo | O que faz |
|---|---|
| 1 Conectar | Escolher origem (dialeto perfilável) + destino (dialeto com caminho de conversão) |
| 2 Perfilar | Listar bancos / schemas (filtrando os do sistema), marcar os que migrar, obter um inventário completo de objetos + métricas de risco |
| 3 Avaliar | Puxar os objetos dos schemas escolhidos, classificar cada um A/B/C/D + uma pontuação geral de «prontidão» |
| 4 Conversão IA | Entregar os objetos grau C (corpos PL/SQL / SQL complexo) à IA para traduzir ao dialeto destino (somente leitura) |
| 5 Relatório | Agregar e exportar para Excel / Word / PDF / Markdown |

### Arquitetura hub-and-spoke

Em vez de tradutores origem→destino aos pares (uma explosão N×M), um modelo lógico intermediário (Logical IR) fica no meio:

```
origem ──parse──▶ Logical IR ──emit──▶ destino
```

Cada dialeto só precisa de um parser ou um emitter, então adicionar um banco é N+M, não N×M. Código: `migrate/ir.ts` (modelo), `migrate/convert.ts` (orquestração), `migrate/dialects/{oracle,postgres,dameng}.ts`. **Limite**: objetos estruturais (tabelas / colunas / tipos / restrições) passam pelo IR determinístico; objetos procedurais (procedures / funções / packages / triggers / views) mantêm o DDL original e são traduzidos pela IA (`migrate/aiConvert.ts`), onde a tradução por regex não consegue reescritas semânticas.

### Perfilamento da origem

`migrate/profile.ts` + `migrate/profilers/{oracle,postgres}.ts`, um conjunto de consultas de catálogo por família de origem. Inventaria 17 categorias de objetos, e **objetos não suportados aparecem como `—` (null), não como um falso 0**:

> tabelas · views · views materializadas · tabelas particionadas · índices · chaves primárias · chaves estrangeiras · restrições unique · restrições check · sequences · funções · procedures · packages · triggers · tipos · sinônimos · db links

Mais métricas de risco: **tabelas sem PK** (a armadilha nº1 do CDC), **colunas LOB** (a maior parte do tempo de migração de dados), **tabelas com triggers**, **tabelas com comentários**; mais buckets de linhas (≥1M / ≥10M / ≥100M), tamanho de tablespace e as maiores tabelas. As contagens de linhas usam estimativas do catálogo (`reltuples` / `num_rows`), sem `COUNT(*)` exato, então mesmo tabelas com bilhões de linhas respondem em segundos. Quando `dba_segments` não é legível (sem privilégio DBA), degrada com elegância (tamanho 0 + aviso).

### Exportação de documentos

Quatro botões na página do relatório, todos reutilizando dependências existentes (`xlsx` / `marked`), sem novas bibliotecas:

| Formato | Como |
|---|---|
| Excel `.xlsx` | Multi-aba: visão geral / inventário / tabelas grandes / detalhe da avaliação / conversões IA |
| Word `.doc` | Markdown renderizado em HTML estilizado, abre nativamente no Word |
| PDF | O mesmo HTML numa janela que se imprime sozinha → «Salvar como PDF» do Chromium |
| Markdown `.md` | Relatório em texto puro |

> Classificação: **A Auto** (determinístico, usar como está) · **B Assistido** (diferenças de tipo / semântica, revisar) · **C Manual** (corpo PL/SQL ou sintaxe proprietária, requer IA + humano) · **D Bloqueado** (sem equivalente — espacial / pacotes externos — requer revisão arquitetural). Prontidão = média ponderada dos graus de objeto (A=100 / B=80 / C=40 / D=0).

## Matriz de compatibilidade

A tabela resume os dialetos suportados por ferramenta. `▣` = suporte completo, `◐` = parcial, `-` = não aplicável.

| Ferramenta | Família MySQL | Família PG | SQL Server | Oracle / DM | SQLite | ClickHouse | NoSQL |
|---|---|---|---|---|---|---|---|
| TableStructure | ▣ (`SHOW CREATE TABLE` fiel) | ◐ (montado por colunas) | ◐ | ◐ | ◐ | ◐ | - |
| TableDesigner — CREATE | ▣ | ▣ | ▣ | ▣ | ◐ (tipos/opções limitados) | ◐ | - |
| TableDesigner — ALTER diff | ▣ | ▣ | ◐ | ◐ | ◐ | ◐ | - |
| DdlEditor | ▣ (SHOW CREATE) | ▣ (`pg_get_viewdef` / `funcdef`) | ◐ | ▣ (DBMS_METADATA) | ◐ | ◐ | - |
| ErdView | ▣ | ▣ | ◐ | ◐ | ◐ | - | - |
| SchemaSnapshots | ▣ | ◐ (DDL simplificado) | - | - | - | - | - |
| SchemaDiff | ▣ | ▣ | - | - | - | - | - |
| SchemaDrift | ▣ | ▣ | - | - | - | - | - |
| NewDatabase | ▣ | ▣ | ▣ | - (use NewSchema) | - (file-based) | ▣ | - (comando próprio) |
| NewSchema | - (sem conceito) | ▣ | ▣ | ▣ (=User) | - | - | - |
| AI Architect / Reverse | ▣ | ▣ | ▣ | ▣ | ▣ | ▣ | ◐ |

"Família MySQL" inclui MySQL / MariaDB / OceanBase / TiDB / Doris / StarRocks. "Família PG" inclui PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift / H2 (compatível PG).

## Fluxos comuns na prática

**Construir um banco de negócio do zero**:
1. Clique direito na conexão → Novo banco → revisar preview SQL → executar
2. Paleta → Assistente de IA → descrever negócio → DDL completo → executar no novo banco
3. Clique direito no schema → Diagrama ER → revisar relações / ajustes
4. Alterar campos: clique direito na tabela → Designer (modo alter) → salvar (via ALTER diff)

**Alinhar dois bancos**:
1. Paleta `act:schema-diff` → escolher dev / prod → obter SQL de migração → "Abrir na consulta destino" → revisar → executar
2. Suspeita de alteração manual em prod: `act:drift` → escolher baseline / prod → revisar relatório de três colunas → "+ Alinhar" nas tabelas relevantes → revisar script → executar

**Revisão histórica**:
1. Antes de subir: `act:snapshots:{connId}` → snapshot → comentar "antes de v2.0"
2. Três meses depois: abrir o dialog de snapshots → selecionar "antes de v2.0" + um snapshot atual → comparar → ver quais tabelas foram alteradas

Pronto, todas as capacidades de estrutura cobertas. Para ver plano de execução em runtime, slow logs e recomendação de índices, vá em [Avançado e engenharia](./advanced.md); para ferramentas de migração entre dialetos, veja [Suporte a bancos de dados](./databases.md).
