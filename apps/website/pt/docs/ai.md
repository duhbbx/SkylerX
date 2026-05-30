# Assistente de IA

O SkylerX distribui a IA em **múltiplos canais independentes** injetados em diferentes pontos do produto — não é um chat único que faz tudo:

- **Painel de chat à direita** (`⌘⇧L`): conversa multi-turno + injeção de schema + inserção / execução de SQL em um clique
- **Autocompletar inline**: ghost text cinza no editor (estilo Copilot)
- **"Perguntar à IA" em erros**: botão em todo popup de erro / área de resultados
- **AI Toolbox**: entrada unificada para 7 prompts comuns
- **Diálogos especializados**: health check / insights / criação de tabelas / reverse / comentários / tradução / dados de teste

Tudo compartilha **abstração de provider + 3 camadas de memória + IPC multi-canal**. Este documento usa apenas fatos do código, sem subjetividade.

## 1. Visão geral — multi-provider + canais paralelos

| Módulo | Arquivo | Responsabilidade |
|---|---|---|
| `askAi()` / `askAiChat()` | `ai.ts` | Dispatch de provider (Anthropic vs OpenAI compat), HTTP (via IPC do main), cancelável |
| `pXxx()` prompts | `ai-prompts.ts` | 9 templates de prompt por domínio, montagem por string |
| Autocompletar inline | `aiInline.ts` | InlineCompletionsProvider do Monaco, throttle 600ms + AbortController |
| 3 camadas de memória | `memory.ts` | A perfil / B fatos / C memória vetorial, injetadas via `buildMemorySection()` no system prompt |
| Painel de chat | `AiChatPanel.vue` | Sidebar à direita, injeção de schema + chat-bus |
| Diálogos especializados | `Ai*Dialog.vue` | Health check / insights / criação / reverse / comentários / dados de teste |
| Tradução cross-dialeto | `SqlTranslateDialog.vue` | Modos SQL e stored procedure |

Todos os canais passam por `askAi*` → IPC fetch → mesma config de provider. Trocar provider **muda todos os canais simultaneamente**.

## 2. Configuração de Provider

`Settings → AI Provider` suporta 5 classes:

| Provider | Protocolo | Endpoint |
|---|---|---|
| **Anthropic** | Anthropic Messages | `${baseUrl}/v1/messages`, autenticação `x-api-key` |
| **OpenAI** | OpenAI Chat | `${baseUrl}/v1/chat/completions`, autenticação `Authorization: Bearer` |
| **DeepSeek** | OpenAI compatível | igual ao acima |
| **Codex** | OpenAI compatível | igual ao acima |
| **Grok / xAI** | OpenAI compatível | igual ao acima |

Código real (`ai.ts → askAi`):

```ts
const provider = settings.aiProvider
const cfg = settings.aiProviders[provider]
if (!cfg?.apiKey?.trim()) throw new Error('NO_API_KEY')
if (provider === 'anthropic') return callAnthropic(o, cfg.apiKey.trim(), base, model)
return callOpenAiCompat(o, cfg.apiKey.trim(), base, model)
```

### Endpoint customizado

Cada provider tem `baseUrl` independente; basta editar:

| Cenário | Como configurar |
|---|---|
| Proxy Anthropic interno | provider=Anthropic, `baseUrl=https://your-proxy.example.com` |
| OpenAI privado compatível (vLLM / Ollama / one-api) | provider=OpenAI, mude `baseUrl` e `model` |
| DeepSeek direto | `https://api.deepseek.com`, `model=deepseek-chat` |
| Grok direto | `https://api.x.ai`, `model=grok-3-mini` |

### Armazenamento criptografado de API Key

Igual a senhas de conexão, vai pelo chaveiro do SO (macOS Keychain / Windows Credential / GNOME libsecret); `settings.aiProviders[*].apiKey` é criptografado em disco.

### IPC ou fetch direto no browser?

No desktop, preload expõe `window.api.ai.fetch` (proxy do main, contorna CORS, suporta cancelamento real). No web, fallback para `fetch` nativo. `ai.ts → aiBridge()` escolhe automaticamente:

```ts
function aiBridge() {
  return globalThis.api?.ai ?? null
}
```

Pelo IPC, o `AbortSignal` do renderer é encadeado ao `ai:cancel` do main — **cancelamento real de requisição em voo**:

```ts
const reqId = `r${Date.now()}-${random}`
init.signal?.addEventListener('abort', () => bridge.cancel?.(reqId))
```

## 3. Painel de chat à direita — AiChatPanel

`⌘⇧L` / `Ctrl+Shift+L` para alternar visibilidade. Largura ajustável arrastando a borda esquerda (`280-800px`), persistida em `skylerx.aiChat.width`.

### Barra de contexto (topo)

| Controle | Função |
|---|---|
| **Conexão** | A qual conexão a conversa se refere (decide dialeto + origem do schema) |
| **Banco / schema** | MySQL via `SCHEMATA`, PG via `pg_namespace`; bancos de sistema filtrados |
| **Incluir schema** (checkbox) | Quando marcado, busca `information_schema.COLUMNS` e monta `tbl(col1 type, col2 type, ...)` no system prompt (limitado a 6000 chars) |
| **Nova conversa** / **Limpar** | Limpa histórico, inicia nova conversa |

### Injeção de schema

MySQL via `information_schema.COLUMNS`, PG via `information_schema.columns`. Agrupa por tabela em `tbl(col1 type, col2 type, ...)`, uma linha por tabela; trunca a 6000 chars com `-- (truncated)`. **Apenas nomes de tabela + colunas + tipos; nada de dados.**

### Conversa multi-turno

Mensagens em `localStorage` `skylerx.aiChat.messages`, máximo 50. Cada `send()`:

```ts
const memorySection = await buildMemorySection(text)  // memória A/B/C
const reply = await askAiChat({
  messages: messages.value,           // histórico completo
  dialect: connOf(connId.value)?.dialect,
  schema: useSchema.value ? schemaText.value : undefined,
  memorySection,
  signal: controller.signal,
})
```

Após a resposta, em **segundo plano**:
- `autoExtractFacts({ user, assistant })` — LLM extrai 1-3 fatos memoráveis (camada B)
- `rememberVector(\`Q: ${user}\nA: ${assistant}\`)` — vetoriza e armazena (camada C)

### Timer "pensando" + aviso de travamento

`elapsedTimer` incrementa por segundo, exibido como `12s`. Acima de 20s anexa o aviso vermelho `maybeStuck`. Botão `[Parar]` chama `controller.abort()` (com IPC, cancelamento real).

### Renderização especial de blocos SQL

A resposta é fatiada com `splitParts` por ` ``` `; trechos SQL vão por Monaco `editor.colorize` (com cache por hash do conteúdo em `sqlHtml`), os demais por `renderMarkdown` (GFM).

Cada SQL tem três botões abaixo:

| Botão | Ação |
|---|---|
| `Copiar` | `navigator.clipboard.writeText` |
| `Inserir como draft` | `emit('insertSql', sql, connId)` → Workspace injeta no QueryPane |
| `▶ Executar` | Confirmação dupla → `emit('runSql', ...)` → Workspace executa |

### Badge de execução

Após "Executar", o bloco SQL ganha um badge (persistido em `skylerx.aiChat.runMarks`, máx 200):

| Status | Exibição |
|---|---|
| `pending` | ⌛ cinza + "10:23 enviado" |
| `ok` | ✓ verde + "10:23 sucesso" |
| `error` | ✗ vermelho + "10:23 falhou", hover mostra o erro |

Ao executar, o QueryPane emite via event bus `onChatSqlExecuted`; o chat assina e atualiza o badge.

### Seletor de provider

Dropdown no rodapé lista apenas providers **com apiKey configurada** (evita selecionar e dar `NO_API_KEY`); botão `⚙` emite `openSettings` para a seção AI.

## 4. Autocompletar inline — aiInline.ts

InlineCompletionsProvider do Monaco, ghost text estilo Copilot, registrado no editor SQL:

```ts
monaco.languages.registerInlineCompletionsProvider('sql', provider)
```

### Estratégia de throttle

| Parâmetro | Valor | Função |
|---|---|---|
| `DEBOUNCE_MS` | 600ms | Só chama LLM após 600ms parado |
| `MAX_PREFIX` | 2000 chars | Texto antes do cursor, truncado |
| Trigger mínimo | 3 chars | `prefix.trim().length < 3` retorna vazio |

Cada novo trigger **aborta o anterior**:

```ts
function clearPending() {
  if (!pending) return
  clearTimeout(pending.timer)
  pending.abort.abort()  // cancela request anterior
  pending = null
}
```

Sem desperdiçar quota e sem completions antigos aparecendo de repente.

### Prompt + system prompt

```ts
const text = await askAiChat({
  messages: [{ role: 'user', content: buildPrompt(prefix, ctx) }],
  dialect: ctx.dialect,
  extraSystem: 'Você é um motor de autocompletar inline para SQL. '
             + 'Produza apenas o fragmento SQL após o cursor, no máximo 1 linha, '
             + 'sem code block, sem explicações, sem repetir o texto. '
             + 'Se o contexto for insuficiente, retorne string vazia.',
  signal: abort.signal,
})
```

Conteúdo de `buildPrompt`: `Dialeto: <d>\n\nSchema:\n<hint>\n\nContexto SQL (cursor no fim):\n<prefix>`.

### Saneamento (`sanitizeCompletion`)

- Remove cercas ` ```sql ... ``` ` (LLM às vezes encapsula)
- Modelo às vezes repete o prefix; se começa com os 80 últimos chars do prefix → corta
- Multi-linha → pega só a primeira

### Aceitar / cancelar

| Tecla | Ação |
|---|---|
| `Tab` | Aceita |
| `Esc` / `Backspace` / digitação | Cancela (nativo Monaco) |

### Interruptor geral

Reusa `settings.enableCompletion` (mesmo do autocomplete SQL); quando desligado, não chama LLM. Falhas são silenciosas (autocompletar inline não é mission-critical).

## 5. Botão "Perguntar à IA" em erros

Toda alerta / barra de erro de resultado tem o botão `✨ Perguntar à IA`. Aciona `AiChatPanel.askAboutError()`:

```ts
async function askAboutError(p: { connId, connName?, sql, error }) {
  controller?.abort()             // 1) aborta atual
  for (let i=0; i<30 && running.value; i++) await sleep(50)  // espera finally
  connId.value = p.connId         // 2) muda para a conexão com erro
  useSchema.value = true          // 3) força schema
  saveToStorage()
  const msg = `${t('aichat.askAiPrompt')}\n\n**Conexão**: ${p.connName}\n\n**SQL**\n\`\`\`sql\n${p.sql}\n\`\`\`\n\n**Erro**\n\`\`\`\n${p.error}\n\`\`\``
  input.value = msg
  if (switching) await sleep(200) // 4) aguarda schema async
  if (!schemaText.value) await loadSchema()
  await send()
}
```

### Formato da mensagem

```markdown
Por favor analise este erro SQL, apontando causas prováveis e correções.

**Conexão**: prod-mysql

**SQL**
```sql
INSERT INTO orders(user_id, amount) VALUES (42, 99.9)
```

**Erro**
```
ERROR 1452 (23000): Cannot add or update a child row:
a foreign key constraint fails (`shop`.`orders`, CONSTRAINT `fk_user` ...)
```

Com schema (`users(id int, ...)` e `orders(...)`), a IA tipicamente identifica em segundos: "`user_id=42` não existe em `users.id`".

### Event bus chat-bus

Não é só o chat panel — `MockDataDialog` em falha de execução usa o mesmo bus:

```ts
toast.error(`Falha na execução: ${errMsg}`, {
  askAi: { sql: stmt, error: errMsg, connId, connName, dialect },
})
```

`ChatErrorAskEvent` é o formato unificado; qualquer ponto que dispare erro pode mostrar "Perguntar à IA".

## 6. AI Toolbox (7 prompts profissionais)

`🛠 AI Toolbox` ou `⌘K → AI Toolbox`. Um diálogo cobre 7 tipos; selecione, clique em "Deixar a IA fazer" → fecha modal + envia prompt ao chat à direita.

| Toolbox | Template | Inputs | Saída |
|---|---|---|---|
| **Escrever migração** | `pMigration` | tabela alvo + descrição | três `\`\`\`sql` separados: ALTER + rollback + migração de dados |
| **Otimizar SQL** | `pOptimizeSql` | SQL original + EXPLAIN opcional | Diagnóstico → reescrita (SQL) → índices (SQL) → ganho esperado |
| **Interpretar EXPLAIN** | `pExplainAnalysis` | SQL + texto EXPLAIN | Tradução em linguagem comum + "conclusão + 1 melhoria principal" |
| **Gerar dados de teste** | `pTestData` | tabela + linhas + contexto | Um `\`\`\`sql` com INSERTs linha a linha, FK-aware |
| **NL → SQL** | `pNl2Sql` | descrição em linguagem natural | Um `\`\`\`sql`; em caso de ambiguidade, escolhe a leitura mais comum + aponta as ambiguidades |
| **Escrever doc (significado de campos)** | `pDataDictDoc` | tabela + CSV de colunas | Tabela Markdown 3 col: campo / tipo / significado de negócio |
| **Explicar uso da tabela** | `pExplainTable` | tabela + colunas + dicas de FK | Parágrafo ≤ 200 chars + 3 bullets (quem insere / quem lê / política de delete) |

### Campos do toolbox

| Tarefa | tabela | SQL | EXPLAIN | Extra |
|---|---|---|---|---|
| migration | ✓ | | | descrição |
| optimize | | ✓ | (opcional) | |
| explain-analysis | | ✓ | ✓ | |
| test-data | ✓ | | | linhas + contexto |
| nl2sql | | | | descrição |
| doc | ✓ | | | CSV de colunas (auto) |
| explain-table | ✓ | | | CSV de colunas (auto) |

Ao submeter, `pXxx(...)` monta o prompt → `emit('submit', { prompt, connId, connName, withSchema: true })` → Workspace despacha para `AiChatPanel.askPredefined(...)`, mesma estrutura de `askAboutError`.

### Diretrizes de design

- Mantém a descrição original do usuário, sem traduzir
- Contexto (SQL / tabela / EXPLAIN) em blocos de código Markdown
- Formato esperado é explícito ("dê-me ALTER + rollback + migração"), reduz idas e vindas
- Saída fortemente restrita (três `\`\`\`sql` independentes + headers H3) = front parsing estável

## 7. AI Health Check — diagnóstico do banco

Toolbar `❤️ Health Check`. Quatro passos automáticos:

1. **Coleta de metadados** — 3 SQLs em paralelo:
   - MySQL: `COLUMNS / STATISTICS / KEY_COLUMN_USAGE` (filtrando `REFERENCED_TABLE_NAME IS NOT NULL`)
   - PG: `information_schema.columns + pg_index + pg_class` + subquery FK
2. **Serialização** — texto compacto por tabela (columns / indexes / FKs)
3. **Envia para IA** — `pHealthCheck` monta prompt; chama `askAiChat`
4. **Renderiza** — Markdown por H2, 6 cartões de categoria

### 6 anti-patterns + instruções (`pHealthCheck`)

| Seção | Título | O que a IA faz |
|---|---|---|
| 1 | Colunas de filtragem frequente sem índice | Heurística para `status / created_at / user_id / type / is_* / *_at`, sem índice → aponta |
| 2 | Nomes parecidos com FK mas sem constraint | `xxx_id` / `xxxId` sem FK → lista + chuta tabela pai |
| 3 | Estilo de nomenclatura misto | Mesma tabela / banco com snake_case + camelCase → sugere unificar |
| 4 | Tipos grandes demais | `VARCHAR(255)` com strings curtas / `BIGINT` para inteiros pequenos / tempo em `VARCHAR` |
| 5 | Tabelas de negócio sem comment | `user / order / payment / account` sem COMMENT, sugere para campos-chave |
| 6 | Soft-delete sem índice | `deleted_at / is_deleted` fora de qualquer índice → sugere `CREATE INDEX` |
| Resumo | — | 3-5 ações priorizadas por custo-benefício |

**Saída fortemente restrita**: 6 H2 `## 1.` ~ `## 6.` (front parsing); seções sem problemas escrevem "nada relevante detectado".

### Coleta

3 SQLs concorrentes (cada uma limitada a ~5000 linhas). Metadata total truncado a ~12K chars; suporte: famílias MySQL / PG.

## 8. AI Insights — slow SQL + análise de raiz

Diálogo de dois tabs; cola SQL / erro e roda (não precisa estar conectado):

### Tab 1: Otimização de slow SQL

Inputs: SQL (obrigatório) + EXPLAIN (opcional) + estatísticas/rows (opcional). Saída em 4 seções: pontos suspeitos (full scan / sem índice / cartesiano / cast implícito / stats stale) → índices recomendados (`CREATE INDEX`) → reescrita (covering index / subquery → JOIN) → ganho estimado.

`extraSystem`: `You are a database performance expert. Be specific and reference actual cost trade-offs.`

### Tab 2: Análise de raiz de erro

Inputs: erro (obrigatório) + contexto opcional (SQL / tempo / usuário). Saída: significado → 3 causas mais prováveis (por probabilidade) → passos de investigação → correção.

`extraSystem`: `You are an SRE/DBA. Be practical, prioritize quick mitigation.`

Diferença do botão "Perguntar à IA": Insights é **deep-dive manual** (analisa devagar um erro); botão é **um clique + SQL atual + erro + schema** no chat panel para conversa multi-turno.

## 9. AI Schema Architect — desenho de tabelas

Conversacional. Dada uma descrição de negócio → multi-tabelas + FK + índices em DDL completo, com iteração.

### System prompt (hard-coded)

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

### Fluxo

1. Usuário descreve negócio (`"sistema de pedidos e-commerce: usuários, produtos, pedidos, itens, com cupons"`)
2. `askAiChat({ messages, dialect, extraSystem })` retorna Markdown
3. `extractAllSql(reply)` extrai blocos `\`\`\`sql` como `sqlBlocks`
4. Iteração → histórico inteiro vai junto → IA retorna **versão completa** (regra no system: sem diff, full)

### Execução em um clique

Rodapé `▶ Executar versão mais recente`: junta os `sqlBlocks` da última resposta, `splitStatements` → executa um a um via `client.connections.execute`. Confirmação dupla com contagem de `CREATE` + banco alvo.

## 10. AI Schema Reverse — inferência reversa

Dado CSV / TSV / JSON de exemplo → IA infere schema → gera `CREATE TABLE` + `INSERT` opcional.

### Inputs

| Campo | Descrição |
|---|---|
| Formato | CSV / TSV / JSON |
| Nome da tabela | padrão `inferred_table` |
| Dados de exemplo | poucas linhas, com header é o ideal |
| Gerar INSERT também | checkbox; prompt ganha "5. gere INSERTs com todos os dados" |

### Estrutura do prompt

```text
Com base no CSV abaixo, inferir o schema e gerar CREATE TABLE no dialeto mysql...

Requisitos:
1. Inferir o tipo **mais apropriado** (comprimento, numérico, data, enum etc.)
2. Inferir quais colunas são **PK** (autoinc vs natural), quais são **NOT NULL**
3. Recomendar 1-2 **índices** (com base em experiência: colunas que parecem FK, filtros comuns)
4. Nome da tabela: `inferred_table`

Dados de exemplo:
```
id,name,email,created_at
1,alice,a@x.com,2026-01-01
...
```

Por favor siga estritamente este formato:

### Inferência
(coluna → tipo → motivo, 2-3 frases)

### CREATE TABLE
```sql
CREATE TABLE ...
```

### Sugestões de índice
- ...
```

### Edição e execução

SQL retornado vai para `sqlEdit`; após editar, `▶ Executar` → confirmação → `splitStatements` → executa um a um.

## 11. AI Comment Writer — escreve comentários de tabela / coluna

Clique direito na tabela `💬 IA escrever comentários` ou pela toolbar.

1. **Carregar colunas** — MySQL via `information_schema.COLUMNS` (name / type / nullable / default / comment); PG adiciona `pg_catalog.col_description`
2. **Serializar** em `columnsCsv`: `- col type [NOT NULL] [DEFAULT ...]`
3. **Enviar à IA** — `pComment(ctx, columnsCsv)`, com saída obrigatória de **um bloco `\`\`\`json`**
4. **Parse** — extrai JSON, lista `[{ col, comment }]`
5. **Tabela comparativa** — comment atual vs sugestão; checkbox por linha
6. **Aplicar** — gera ALTER:
   - MySQL: `ALTER TABLE ... MODIFY <col> <type> [NOT NULL] [DEFAULT ...] COMMENT '...'` (precisa do type / nullable / default original, senão perde)
   - PG: `COMMENT ON COLUMN <table>.<col> IS '...'`

### Restrições do prompt (`pComment`)

Forçar: **apenas um bloco `\`\`\`json`, sem texto antes / depois**; array com `{ "col": "nome", "comment": "uma frase em chinês" }`; `col` **igual ao original** (case-sensitive, sem tradução); `comment` ≤ 30 chars, "?(sugiro complemento manual)" se incerto; **listar todos os campos** (`id / created_at` também).

Restrição forte = `parseSuggestion()` extrai ` ```json ... ``` ` com regex estável, com fallback para JSON cru. `col` exato = sem misalignment no diff e ALTER.

### Comentário de tabela

Além de colunas, faz para tabela: MySQL `ALTER TABLE ... COMMENT='...'`, PG `COMMENT ON TABLE ... IS '...'`.

## 12. AI tradução de SQL — SqlTranslateDialog

Entrada `🌐 Translate`. 4 dialetos fixos: `mysql / postgresql / sqlserver / oracle`.

### Dois modos

| Modo | Prompt |
|---|---|
| **SQL** (queries / DDL) | `pTranslate(from, to, sql)` |
| **Procedure / Função** | `pTranslateProcedure(from, to, code)` — cobre parâmetros / BEGIN-END / DECLARE / handlers de erro / cursores / DELIMITER |

`extraSystem` muda:

- SQL: `You are a senior SQL polyglot. Translate SQL across dialects precisely; flag every non-portable construct honestly.`
- Procedure: `You are a senior SP/PL/SQL polyglot. Translate stored procedures faithfully; preserve control flow and explicit error handling.`

### Saída restrita (`pTranslate`)

3 seções rígidas:

1. **SQL traduzido** — um `\`\`\`sql`, uma statement, sem explicações
2. **`### Avisos`** — bullets de **construções não-portáveis** (`MySQL ON DUPLICATE KEY UPDATE` → `PG ON CONFLICT DO UPDATE`, semanticamente similar mas com diferenças; `DATETIME vs TIMESTAMP`; `NVARCHAR vs NVARCHAR2`; paginação / autoinc / concatenação / aspas; conversão implícita, NULL ordering); senão "nada não-portável aparente"
3. **`### Sugestões`** — bullets para forma **mais idiomática** do alvo (CTE / `LIMIT OFFSET` / `COALESCE` em vez de `IFNULL`); senão "tradução direta já é idiomática"

Headers H3 = parsing por seção no front.

### Renderização em dois painéis

| Esquerda | Direita |
|---|---|
| `extractSql(answer)` → SQL traduzido com Monaco `colorize` + `Copiar com um clique` | Restante do Markdown (avisos + sugestões) após remover o primeiro `\`\`\`sql` → `renderMarkdown` |

### Pequenos detalhes

- `swapDialects()`: troca from/to
- **Same-dialect short-circuit**: `from === to` retorna "sem tradução necessária" sem chamar API
- Tradução cancelável via `controller?.abort()`

## 13. AI Mock Data — dados de teste FK-aware

Clique direito na tabela `🧪 Gerar dados de teste`. O motor é o motor de regras (`mockgen.ts` infere `SemanticKind` por nome de coluna + tipo SQL); a IA entra em dois pontos:

### 13.1 `aiInfer()` — IA infere semântica de todas as colunas

Botão `✨ Inferir com IA`. Prompt em inglês (modelos respondem JSON mais estável):

- Escolher do whitelist `SEMANTIC_KINDS` (`auto / integer / decimal / money / name_cn / phone_cn / id_card_cn / address_cn / email / enum / lorem_cn / ...`); fora disso, inválido
- Em contextos chineses (`name/姓名 / phone / id_card / address`) preferir variantes `_cn`
- **Proibir** `auto` (random sem semântica); escolha algo concreto
- `money/price/amount/cost` → `money`; `decimal/float` → `decimal`
- PK inteiro `[PK]` → `integer` (autoinc); `status/state/role` → `enum`; `description/content/remark/note` → `lorem_cn`
- **Apenas** JSON object, tipo `{"user_id":"integer","name":"name_cn","mobile":"phone_cn"}`

`/\{[\s\S]*\}/` extrai o primeiro JSON (tolerante a lixo), valida kind e nome no `baseColumns`.

### 13.2 Erro no INSERT → botão "Perguntar à IA"

INSERT falha (NOT NULL / FK / tipo) → toast com `askAi` → chat-bus envia stmt + erro + conexão ao chat.

INSERT real gerado por `buildMockInserts(dialect, tableRef, columns, count)` (chunks de 100). IA só **infere semântica** + **diagnóstica erros**.

## 14. Três camadas de memória — memory.ts

`Settings → AI → Memória`. Cada conversa injeta automaticamente no system prompt (frente, modelos mais sensíveis aí).

| Camada | Nome | Forma | Uso | Trigger |
|---|---|---|---|---|
| **A** | `aiCustomInstructions` | Texto livre | Identidade / preferências longas | Toda conversa, full |
| **B** | `aiFacts` | `{id, text, createdAt}[]` | Fatos estruturados | Toda conversa, full; com `aiAutoExtractFacts` ligado, extrai 1-3 fatos por turno |
| **C** | `aiVectorMemories` | `{id, text, vec, createdAt}[]` | Muitas anotações | Top-K por cosine (default `aiVectorTopK`), score > 0.3 |

### `buildMemorySection(query)`

Monta Markdown em ordem A → B → C:

- A: `## User profile & preferences` + texto livre
- B: `## Known facts` + bullets
- C: `## Relevant past notes` + bullets (precisa de query + embedding key; `recallRelevant(query)` top-K + score > 0.3)

### Embedding

C precisa de endpoint de embedding. `Settings → AI → Memória`:

| Campo | Padrão |
|---|---|
| `aiEmbeddingBaseUrl` | (vazio) |
| `aiEmbeddingApiKey` | (vazio) |
| `aiEmbeddingModel` | `text-embedding-3-small` |

Request via OpenAI-compatível `${base}/v1/embeddings`; DeepSeek / Grok também aceitam. Timeout curto (15s) para não bloquear o chat.

### Truncamento LRU

C tem limite de 1000; descarta os mais antigos:

```ts
if (settings.aiVectorMemories.length > 1000) {
  settings.aiVectorMemories.splice(1000, settings.aiVectorMemories.length - 1000)
}
```

### Extração automática de fatos (B)

Com `aiAutoExtractFacts` ligado, ao final de cada turno `autoExtractFacts({ user, assistant })` pede ao LLM para extrair ≤ 3 fatos memoráveis (`"uses MySQL 8"` / `"works on 'orders' schema"` / `"prefers snake_case"`), pulando efêmeros; resposta `none` é ignorada, senão bullets são parseados e armazenados. Falhas silenciosas (memória não bloqueia o chat). `extraSystem`: `You are a memory curator. Output bullet list of durable facts only.`

## 15. Privacidade & Segurança

| Padrão | Descrição |
|---|---|
| API Key criptografada | Chaveiro do SO (macOS / Windows / Linux libsecret) |
| API Key nunca sai da máquina | Desktop IPC conecta direto no provider; web fetch direto (pode trocar baseUrl para proxy próprio) |
| **Sem envio de dados** por padrão | Schema do chat panel é opt-in; quando ligado, **só envia** `tbl(col1 type, col2 type, ...)` summary |
| Limite de 6KB no schema | Truncado com `-- (truncated)` |
| `request log` auditável | `Settings → AI → Log de requests` (no IPC, registro completo) |
| Botão "Perguntar à IA" informa o conteúdo | SQL completo + erro + metadados da conexão + schema |

## 16. Controle de custo

| Dimensão | Como |
|---|---|
| Trocar provider | Dropdown do chat / `⌘K → Trocar provider de IA` |
| Trocar model | `Settings → AI Provider → <provider> → model` (modelo barato para inline / health check; caro para tabelas / tradução) |
| Desligar autocompletar inline | `Settings → Autocomplete` — reusa `enableCompletion` (consumo de token alto) |
| Desligar memória vetorial | `Settings → AI → Memória → Memória vetorial` — cada turno chama embedding; desligar economiza |
| Desligar extração automática | `aiAutoExtractFacts` off |
| Long context vs short | Schema opt-in; perguntas não relacionadas ao banco (`explique este SQL`) podem ficar sem schema |

---

## 17. Decisão rápida de canal

| Quero… | Use… |
|---|---|
| Conversar multi-turno e iterar | **AiChatPanel** |
| Auto-complete no editor | **Inline** (`aiInline.ts`) |
| Erro? Diagnóstico rápido | **Botão "Perguntar à IA"** (chat-bus) |
| Migração / otimização / EXPLAIN para uma tabela | **AiToolboxDialog** |
| Scan de anti-patterns do banco | **AiHealthCheckDialog** |
| Deep dive de slow SQL / erro | **AiInsightsDialog** |
| Tabelas a partir de descrição | **AiSchemaArchitectDialog** |
| Schema a partir de amostra de dados | **AiSchemaReverseDialog** |
| Comentários em todas as colunas e salvar | **AiCommentDialog** |
| Tradução cross-dialeto de SQL / procedure | **SqlTranslateDialog** |
| Dados de teste (semântica + FK) | **MockDataDialog** |
| Memória de longo prazo | **memory.ts → A/B/C** |

Combine com [Avançado](./advanced) para multiplicar o poder — EXPLAIN ininteligível? Pergunte à IA. Recomendação de índices em dúvida? Pergunte. Aviso de tradução Oracle → DM? Pergunte.
