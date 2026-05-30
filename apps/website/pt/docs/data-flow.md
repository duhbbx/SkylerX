# Fluxo de dados: importação / exportação / backup / migração

O SkylerX agrupa todos os caminhos pelos quais dados "saem ou entram" do banco num conjunto de diálogos. Tudo passa pelo `SaveFileDialog` customizado (consistente entre plataformas, sem nativo do SO) e o parsing acontece no lado do renderer (CSV/JSON/Excel processados em memória). Este capítulo segue a ordem "saída → entrada → backup/restore → migração entre bancos → dicionário de dados → comparação de dados".

## 1. Visão geral: o que esta seção cobre

| Cenário | Entrada | Diálogo / função principal | Formatos |
|---|---|---|---|
| Copiar algumas linhas rapidamente | Grade de resultados, clique direito → "Copiar como" | `ResultGrid.vue::copyRows` | CSV / TSV / JSON / Markdown / SQL VALUES |
| Baixar uma tabela / schema inteiro | NavTree clique direito "Exportar SQL" → `ExportOptionsDialog` | `Workspace.vue::doTableExport` / `doSchemaExport` | SQL (CREATE + INSERT) |
| Mover workspace inteiro | Paleta `act:export-conns` / `WorkspaceExportDialog` | `WorkspaceExportDialog.vue` | JSON `.skylerxws` |
| Carregar CSV/JSON/Excel para tabela | NavTree clique direito "Importar dados" → `ImportDialog` | `ImportDialog.vue` + `io.ts` | CSV / TXT / JSON / NDJSON / XLSX |
| Colar do Excel/Lark direto | ⌘V na área principal (ou `PasteImportDialog`) | `PasteImportDialog.vue` | TSV / CSV |
| Ver arquivo .ndjson direto | Paleta `act:ndjson-viewer` | `NdjsonViewerDialog.vue` | `.ndjson` / `.jsonl` |
| Backup / restore do banco | Paleta `act:backup:<id>` (uma entrada por conexão) | `BackupRestoreDialog.vue` | `.sql` / `.ndjson` |
| Copiar tabela entre conexões | NavTree clique direito → "Transferência de dados" | `DataTransferDialog.vue` | SELECT linha-a-linha → INSERT em lote |
| Gerar dicionário de dados | NavTree clique direito schema/db → "Dicionário de dados" | `Workspace.vue::genDataDict` + `dump.ts` | Markdown / HTML |
| Comparar dados entre duas tabelas | Paleta `act:data-diff` | `DataDiffDialog.vue` + `data-diff.ts` | diff por linha → SQL de sincronização |

Operações de IO de arquivo vão sempre por `client.files` (implementado no main process: `openText / saveText / listDir / commonDirs / mkdir`). No Web, `listDir` não está disponível e fallback para download/upload do browser (só formatos texto).

## 2. Exportação

### 2.1 Cópia de resultados em vários formatos

`ResultGrid.vue`, clique direito em célula/área selecionada, abre o submenu "Copiar como":

| Item | Implementação | Uso |
|---|---|---|
| CSV | `io.ts::toCSV` | Cola em Excel / Numbers como tabela |
| TSV | `io.ts::toTSV` | Excel / Notion / Lark (separador `\t`) |
| JSON | `io.ts::toJSON` | `JSON.parse` em código, `Date` vira `toISOString()` |
| Markdown | `io.ts::toMarkdown` | Tabela em docs / descrição de PR (escapa `|` e quebras) |
| SQL VALUES | `io.ts::toSqlValuesList` | Formato `(1, 'a'), (2, 'b')`, cola em `INSERT...VALUES` / `VALUES (...) AS t` / `ON CONFLICT ... EXCLUDED` |
| SQL INSERT | `io.ts::toInsertSql` | `INSERT INTO tbl (...) VALUES (...)` por linha, executável |

**Detalhes da restauração de tipos** (em `io.ts`):

- `null/undefined` → vazio (CSV) / `NULL` (SQL);
- `Date` → `toISOString()`;
- `number` → direto; `Infinity/NaN` viram `NULL` em SQL;
- `boolean` → `TRUE/FALSE` em SQL (atenção: SQLite traduz para `1/0`);
- `object/array` → `JSON.stringify`, com aspas simples em SQL;
- aspa simples `'` é dobrada (`a'b` → `'a''b'`) para evitar injeção.

CSV só usa aspas em células com `"` / `,` / quebra; TSV só em `\t` / quebra / `"` — não usa aspas indiscriminadamente, células ficam mais limpas no Excel.

### 2.2 ExportOptionsDialog — exportar tabela / Schema inteiro

NavTree clique direito em tabela ou schema → "Exportar SQL"; primeiro abre o diálogo minimalista `ExportOptionsDialog`:

- **Apenas estrutura** → `withData = false`, só `CREATE TABLE`;
- **Estrutura + dados** → `withData = true`, faz `SELECT * FROM ref` para os dados e gera a lista de `INSERT`.

Após `pick`, `Workspace.vue` chama `doTableExport` / `doSchemaExport`:

1. `client.connections.metadata(... group: 'columns')` traz as colunas;
2. `dump.ts::buildCreateFromColumns` **reconstrói CREATE TABLE** a partir do metadata (v1 inclui PK; sem índices/FK — sintaxes incompatíveis entre dialetos, prioriza estabilidade);
3. Com `withData = true`, `SELECT * FROM ref` (sem paginação; tabelas grandes devem ir por backup/migração);
4. `buildTableDump` monta:

   ```sql
   -- Estrutura da tabela
   CREATE TABLE `users` (...);

   -- Dados (N linhas)
   INSERT INTO `users` (...) VALUES (...);
   ```

5. Nome do arquivo: `<nome>.sql`, extensão fixa `.sql`, via `client.files.saveText` para o `SaveFileDialog` customizado.

A exportação do schema inteiro itera as base tables e adiciona `-- ws.dumpHeader { label, n }` no topo.

### 2.3 Exportação completa do Workspace (`.skylerxws`)

`WorkspaceExportDialog.vue` combina os cenários "troca de máquina" / "compartilhar com colega". Estrutura do arquivo:

```ts
interface WorkspaceFile {
  version: 1
  exportedAt: number
  source: string                  // 'SkylerX'
  connections?: ConnectionConfig[]
  snippets?: typeof snippets
}
```

Opções de exportação (selecionáveis individualmente):

| Opção | Padrão | Descrição |
|---|---|---|
| Incluir config de conexões | ✓ | Via `client.connections.list()`, **mascarado por padrão** (sem senha) |
| ⚠ Incluir senhas | ✗ | Quando marcado, chama `client.connections.get(id)` para texto plano. O arquivo descriptografa em outra máquina, mas é texto plano — use com cuidado |
| Incluir snippets SQL | ✓ | JSON inteiro copiado, sem renomear ID |

Nome padrão: `skylerx-workspace-YYYY-MM-DD.skylerxws`, filter aceita `.skylerxws` e `.json`.

Importação: contagem de conexões + snippets → confirmação dupla → estratégia de conflito:

- **skip**: ignora se mesmo nome (padrão);
- **overwrite**: usa o id da dup e chama `update`, sobrescreve tudo (inclui senha se houver);
- **rename**: sufixo `(importado)` e cria nova.

### 2.4 Exportação criptografada `.sql.enc` (AES-256-GCM + PBKDF2)

`export-encrypt.ts` fornece uma API de funções puras; a UI chama conforme o caso (típico: exportar dump SQL com dados sensíveis para colaborador externo). Escolhas de algoritmo:

| Item | Valor | Compromisso |
|---|---|---|
| Magic do arquivo | `SKYLERX-ENC-v1` | Identificar versão ao atualizar algoritmo |
| KDF | PBKDF2-HMAC-SHA-256 | Suporte nativo em browser/Node, sem deps |
| Iterações | `DEFAULT_ITER = 200_000` | OWASP 2023 recomenda ≥ 600k, mas equilibra com hardware antigo |
| Cifra | AES-GCM | Tag de autenticação de 128 bits; senha errada / arquivo alterado → `WRONG_PASSWORD` |
| Tamanho da chave | 256 bits | `deriveKey` produz AES-GCM 256 |
| Salt | 16 bytes random | Regerado a cada vez |
| IV | 16 bytes random | Regerado a cada vez |
| Serialização | JSON em linha única | Streaming amigável; legível com editor de texto |

Formato em disco (JSON em linha única):

```json
{ "magic": "SKYLERX-ENC-v1", "salt": "<b64>", "iv": "<b64>", "iter": 200000, "data": "<b64-cipher+tag>" }
```

Detalhes:

- Usa `globalThis.crypto.subtle`, **sem dependências de terceiros**; Node antigo sem subtle falha pedindo upgrade;
- `Uint8Array` sempre via `new ArrayBuffer(n)` para contornar a restrição de tipo do TS 5.7 + lib.dom em `BufferSource`;
- Encoding base64 em blocos de 32 KB, evitando stack overflow do `String.fromCharCode(...bytes)` em arquivos grandes;
- Falha de autenticação GCM é unificada em `WRONG_PASSWORD`, **sem revelar** o `OperationError` original (evita side-channel).

## 3. Importação

### 3.1 ImportDialog — assistente de 3 passos para CSV / JSON / NDJSON / Excel

NavTree clique direito em tabela → "Importar dados". `ImportDialog.vue` é um assistente fixo de 3 etapas (`step: 'pick' | 'map' | 'run'`):

#### Passo 1 — escolher arquivo

- Botão principal "Escolher arquivo" → `client.files.openText`, filter `csv / txt / json` (JSON detectado por `\.json$/i` ou primeiro char `[`/`{`, vai para `parseJSON`).
- Botão secundário "Excel…" → `<input type=file>` no renderer, lê `ArrayBuffer` e **carrega dinamicamente** `xlsx` (SheetJS). Apenas o primeiro sheet, `raw: false` (valor exibido do Excel, datas não viram número) e `defval: ''`. Excel não passa pelo canal texto, mas binário — não trava o IPC.
- Após o parse, preview das primeiras 5 linhas; checkbox "primeira linha é cabeçalho".

`io.ts::parseCSV` é uma máquina de estados feita à mão: BOM stripping, escape `""`, CRLF / LF, vírgula e quebra dentro de aspas. Filtra "linhas vazias" (apenas um campo vazio).

`io.ts::parseJSON` aceita três formatos:

- **Array de objetos**: união das chaves vira cabeçalho (na ordem em que aparecem);
- **Array de arrays**: primeira linha = cabeçalho;
- **Objeto único**: tratado como 1 linha.

#### Passo 2 — mapeamento + inferência de tipos

`autoMap()` pareia origem/destino com "match exato após lowercase". Cada coluna tem dropdown manual; "Pular" = `-1`.

Inferência `inferType(srcIdx)` amostra **primeiros 50 valores não nulos** da coluna, na ordem:

| Inferência | Regex |
|---|---|
| `number` | `/^-?\d+(\.\d+)?$/` |
| `date` | `/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?Z?$/i` |
| `boolean` | `/^(true|false|t|f|y|n)$/i` |
| `string` | fallback |

Com strings vazias, marca `nullable`, exibido como `·∅`. **Atenção**: a inferência é só hint; a inserção real é como string, e o cast é feito pelo engine do DB conforme a definição da coluna — tolera diferenças de dialeto (MySQL `'2024-01-01'` vira DATE, SQLite vira TEXT).

#### Passo 3 — opções + execução

| Opção | Padrão | Comportamento |
|---|---|---|
| TRUNCATE antes de importar | ✗ | Insere `TRUNCATE TABLE <ref>` antes dos `INSERT`; cuidado, **não tem rollback** (TRUNCATE é DDL em MySQL/PG) |
| Linhas por batch | 200 (min 1, max 2000) | Controla quantas linhas por `INSERT INTO t (...) VALUES (...), (...), ...` para evitar statements muito longas |

Execução via `client.connections.executeBatch`. Strings vazias (`''`) viram `NULL` (`io.ts::buildInsertStatements` faz `s == null || s === '' ? 'NULL' : ...`), portanto **a importação não distingue "string vazia real" e "sem valor"**. Para distinguir, use o editor SQL manualmente.

### 3.2 PasteImportDialog — colagem direta do clipboard

`PasteImportDialog.vue` é a versão leve do ImportDialog: ao abrir, faz `navigator.clipboard.readText()`, sem precisar escolher arquivo.

| Input | Caminho de parse |
|---|---|
| Contém `\t` | TSV (formato padrão do Excel / Lark) por `\t` |
| Sem `\t` | CSV simples (`""` escape, **sem suporte a aspas aninhadas complexas** — use ImportDialog) |

As colunas da tabela alvo vêm de `information_schema.columns` em tempo real (MySQL / MariaDB / OB / TiDB / Doris / StarRocks via `table_schema + table_name`; PG / outros via `table_name + table_catalog`). Auto-match por nome normalizado (`toLowerCase + remover _-espaços`), restante manual; vazio = pular.

Batch fixo `BATCH = 500`; cada batch um `INSERT INTO ... VALUES (...), (...)`; `sqlLiteral` simplificado: vazio → `NULL`, número direto, resto com aspas (`'` duplicado). **Redis / docs etc. são filtrados** (só lista conexões `dialectKind === DbKind.Sql`).

Caso de uso: copiar dezenas a milhares de linhas do Lark/Excel e colar. Para maior volume, use ImportDialog (`executeBatch`) ou DataTransferDialog (paginado).

## 4. Visualizador NDJSON (`NdjsonViewerDialog`)

Paleta `act:ndjson-viewer` → escolha `.ndjson` / `.jsonl` → veja como tabela, **sem conexão de banco**.

Regras (`parse()`):

- Quebra por linha; linhas vazias / com erro → contam `skipped` (sem bloquear);
- Reconhece envelope estilo dbgate Archives `{ __table, data }` → linha pertence a `__table`, dado é `data`;
- `{ __error: "..." }` → conta `skipped++`;
- Demais: JSON normal, `table = ''`.

Características da UI:

- **Tabs por tabela**: no topo, tabs por `__table`; clique para filtrar;
- **União de colunas**: header = união das chaves de todas as linhas visíveis (campos faltantes exibem `null`);
- **Detalhe da linha**: duplo clique mostra JSON completo no lado/rodapé;
- **Copiar tudo / salvar como**: clipboard ou `saveText` (mantém nome original);
- **v1 somente leitura**: sem edição, sem export-back; em roadmap.

## 5. Backup / restore (`BackupRestoreDialog`)

Paleta `act:backup:<connId>` → `BackupRestoreDialog`. **MVP via SQL puro**: não chama `mysqldump` / `pg_dump` externos (detecção de path entre plataformas é trabalhosa); para DDL completo (trigger / view / ordem de FK) usaremos `child_process.spawn` por IPC depois.

#### Formatos de backup

| Formato | Implementação | Característica |
|---|---|---|
| **SQL** | Encaminha ao NavTree clique direito "Exportar SQL" (reusa `doSchemaExport`) | Caminho tradicional, aceito por `mysql/psql` |
| **NDJSON** | `doBackupNdjson()` interno | Estilo dbgate Archives, ótimo para cross-conexão |

Fluxo NDJSON:

1. `metadata({ group: 'tables', path: [database] })` para todas as base tables;
2. Para cada tabela, `SELECT * FROM <sqlName>`; escreve `{"__table":"t","data":{...}}\n`;
3. Falha numa tabela **não interrompe**; escreve `{"__table":"t","__error":"..."}` (visível no restore);
4. `saveText` em `skylerx-<conn>-<timestamp>.ndjson`, filter `.ndjson / .jsonl`;
5. Barra de progresso (`done / total · phase`) + botão "⏹ Parar" (`stopRequested` checado por tabela).

Limitação: `BLOB / Buffer` via `JSON.stringify` viram `{ type: 'Buffer', data: [...] }`, **não voltam binários no restore**; para cenários estritos, use o caminho SQL.

#### Fluxo de restore

| Caminho | Fluxo |
|---|---|
| SQL | `client.files.openText` → `splitStatements(content)` por `;` → confirmação dupla → `execute` em ordem; **falha não interrompe**, erros entram em `restoreProgress.errors[]` (truncado em 200 chars) |
| NDJSON | Bucket por `__table` → **um grande INSERT por bucket** com chunk de 100 (`max_allowed_packet`) → mesmos erros coletados |

UI com barra de progresso em tempo real + lista de erros (truncados + quebra de linha) + toasts `restoreOk / restoreWithErrors / restoreStopped`.

## 6. Migração entre conexões (`DataTransferDialog`)

NavTree clique direito em tabela → "Transferência de dados". Mais estreito que backup/restore: **tabela única para tabela única**, escolhe a fonte e começa, ideal para mover dados dev→staging.

| Campo | Padrão | Descrição |
|---|---|---|
| Conexão alvo | atual | Dropdown com todas, com sufixo `(atual)` |
| Database alvo | ctx fonte | Significado varia: PG = catalog, MySQL = banco |
| Schema alvo | ctx fonte | PG/KB obrigatório (padrão `public`); MySQL pode ser vazio |
| Nome da tabela alvo | nome fonte | Se não existe, falha; não cria tabela |
| Linhas por batch | 500 | `SELECT ... LIMIT ? OFFSET ?` paginação |
| TRUNCATE alvo antes | ✗ | Na verdade executa `DELETE FROM <ref>` (não `TRUNCATE`, transação reverte) |

Loop:

```ts
for (let page = 0; page < 100000; page++) {
  const res = await execute(srcId, `SELECT * FROM ${srcRef}`, [],
    { ..., limit: size, offset: page * size })
  if (!res.rows.length) break
  await executeBatch(tgtId, rowInserts(tgt.dialect, dstRef, cols, res.rows), dstOpts)
  if (res.rows.length < size) break    // antecipa o fim
}
```

- Limite 10w páginas é proteção contra loop infinito;
- Nomes de colunas vêm do `metadata` da fonte, ou seja **a tabela alvo deve ter os mesmos nomes** (ordem não importa, `rowInserts` lista explicitamente);
- Conversão de tipos: JS → SQL literal (`io.ts::sqlLiteral`) + cast implícito do engine. Tipos complexos (Postgres `jsonb`, MySQL `BIT(1)`) podem distorcer; faça um spot-check.

## 7. Dicionário de dados (Markdown / HTML)

NavTree clique direito schema (ou banco) → "Dicionário de dados → Markdown / HTML". `Workspace.vue::genDataDict` chama `dump.ts::buildDataDictMarkdown / buildDataDictHtml`.

Uma seção por tabela; tabela de campos com colunas fixas:

| Campo | Tipo | Nullable | PK | Padrão | Comentário |
|---|---|---|---|---|---|
| `id` | `bigint unsigned` | N | 🔑 | | PK do usuário |
| `email` | `varchar(255)` | Y | | `NULL` | e-mail |

Fonte: `metadata({ group: 'columns' })` retorna `MetadataNode.detail.{dataType, nullable, primaryKey, defaultValue, comment}`.

#### Diferenças Markdown vs HTML

| Dimensão | Markdown | HTML |
|---|---|---|
| Escape | `|` → `\|`, quebra → espaço | entidades `&<>` |
| Sumário | Sem (use o outline da IDE) | TOC de 3 colunas, âncoras `#t-<urlencoded>` |
| Layout | Markdown puro | `<style>` inline, sans-serif, bordas, zebra ímpar/par, `@media print` para não quebrar seções |
| Uso | Wiki / GitLab | Abre no browser e imprime PDF |

Nome: `<schema-or-db>-data-dict.md|html`. **Geração 100% offline** — auditoria de compliance precisa funcionar em rede isolada.

## 8. Comparação de dados (`DataDiffDialog`)

Paleta `act:data-diff`. **Duas conexões × duas tabelas → diff por linha → SQL de sincronização**.

Algoritmo central em `data-diff.ts::diffRows` (função pura, testável):

```ts
diff = {
  inserts: Row[],            // só na fonte
  updates: RowUpdate[],      // mesma PK, colunas não-chave diferentes
  deletes: Row[]             // só no alvo
}
```

Chave (`keyCols`):

- Por padrão extrai a **PK** da fonte via `information_schema.table_constraints + key_column_usage` (SQL universal MySQL/PG);
- Usuário pode editar `keyColsInput` (separado por vírgula).

Comparação `same(a, b)` via **normalização string**: `null/undefined` equivalem a vazio; senão `String(a) === String(b)` — tolera diferenças de driver (`MySQL2` retorna `BigInt`, `pg` retorna `Number`, SQLite retorna `string`).

Matriz: **apenas família MySQL (MySQL / MariaDB / OB) + família PostgreSQL (PG / KingbaseES)**; outros dialetos (SQLite / Oracle / SQL Server / Redis etc.) ficam em "apenas MyPg suportado", botão desabilitado.

Resultado:

| Métrica | Significado |
|---|---|
| `inserts` | Completar alvo com fonte |
| `updates` | Atualizar alvo (só `SET` colunas diferentes) |
| `deletes` | Linhas extras no alvo, **emitidas no final com comentário** "só no alvo; revise antes" |

`generateDataSync` produz um SQL legível, "Copiar" ou "Abrir na aba de query" para revisar e executar — dry-run + revisão humana.

`LIMIT` (padrão 2000) protege a memória; para grandes diffs, restrinja o escopo.

## 9. Segurança (resumo)

Detalhes em [Modelo de segurança](./troubleshooting.md). Pontos relevantes desta seção:

- **Exportação de workspace não inclui senhas por padrão**; quando marcado, é JSON em texto plano com aviso "⚠" vermelho;
- **`.sql.enc` criptografado** usa AES-256-GCM; senha errada e arquivo alterado dão o mesmo erro, sem side-channel;
- Backup NDJSON **não faz mascaramento**; para mascarar de verdade, rode PII Scanner antes ou escreva `SELECT replace(...)` no editor;
- Dados temporários ficam **apenas em memória**; fechar o diálogo libera tudo.

## 10. Matriz de compatibilidade

| Capacidade | Família MySQL | Família PG | SQLite | Oracle | SQL Server | DM / KingbaseES | Redis | MongoDB |
|---|---|---|---|---|---|---|---|---|
| Copiar como CSV/TSV/JSON/MD | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Copiar como SQL VALUES/INSERT | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Exportar tabela/Schema SQL | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Export full `.skylerxws` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Export criptografado `.sql.enc` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| ImportDialog (CSV/JSON/Excel) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | use RedisImportExport | use NDJSON |
| Import via clipboard | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Visualizador NDJSON | independente | independente | — | — | — | — | — | — |
| Backup/restore via SQL | ✓ | ✓ | ✓ | parcial | ✓ | ✓ | — | — |
| Backup/restore via NDJSON | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Migração entre conexões | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Dicionário de dados (MD/HTML) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Diff de dados + SQL de sync | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ (KB) | — | — |

"✗" = atualmente desabilitado; "—" = não faz sentido (KV / docs vão por `RedisImportExportDialog`).

## Atalhos por ação

| Ação | Toolbar | Menu contexto | ⌘K paleta | Atalho |
|---|---|---|---|---|
| Copiar resultado CSV / TSV / ... | — | Grade → Copiar como → ... | — | — |
| Exportar tabela SQL | — | NavTree tabela → Exportar SQL | — | — |
| Exportar schema SQL | — | NavTree schema → Exportar SQL | — | — |
| Exportar Workspace | Engrenagem → Exportar | — | `Exportar Workspace` (`act:export-conns`) | — |
| Importar Workspace | Engrenagem → Importar | — | `Importar Workspace` (`act:import-conns`) | — |
| Importar dados (CSV/JSON/Excel) | — | NavTree tabela → Importar dados | — | — |
| Import via clipboard | — | — | `PasteImport` (menu) | — |
| Ver arquivo NDJSON | — | — | `Visualizador NDJSON` (`act:ndjson-viewer`) | — |
| Backup / restore | — | — | `Backup/restore · <conn>` (`act:backup:<id>`) | — |
| Transferência de dados | — | NavTree tabela → Transferência de dados | — | — |
| Dicionário de dados | — | NavTree schema/db → Dicionário de dados → MD / HTML | — | — |
| Comparar dados | — | — | `Comparar dados` (`act:data-diff`) | — |

Dica: qualquer "Salvar como" usa o `SaveFileDialog` (`packages/ui/src/components/SaveFileDialog.vue`) — consistente entre macOS / Windows / Linux, **sem nativo do SO**; com favoritos, recentes, ↑↓, Enter para salvar, ⌘L para focar na barra de endereço.
