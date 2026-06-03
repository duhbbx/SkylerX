# Ferramentas de produtividade

O SkylerX conecta ações de **30 segundos a 30 minutos do dia a dia de DBA / backend** a **teclado / paleta de comandos / notificações** — objetivo: menos cliques, menos janelas. Esta página segue a ordem do "mais usado", e cada item tem fato e arquivo correspondente.

## 1. Visão geral

| Ferramenta | Entrada | Resolve |
|---|---|---|
| Paleta de comandos ⌘K | Global / `Settings → Atalhos` | Acessa tudo sem navegar menus |
| Busca global de objetos ⌘⇧O | Global | Fuzzy de tabelas / views / colunas → localiza na árvore |
| Snippets SQL | Drawer à direita / botão `★` | Reusa queries com `{{var}}` |
| Histórico | Drawer à direita | Por tempo / duração, slow em vermelho |
| Favoritos | ⌘K → "Favoritos" / Toolbar | Tabelas / views / queries de acesso rápido |
| Atalhos custom | `Settings → Atalhos` | 12 comandos com remap + detecção de conflito |
| Dashboard | ⌘K → "Dashboard" | Múltiplos SQLs em cards "como o sistema está hoje" |
| Notificações webhook | `Settings → Notificações` | DingTalk / Lark / Slack / genérico para slow query + erros |
| Multi-janelas ⌘⇧N | File → Nova janela | Mesma app, duas sessões independentes |

---

## 2. Paleta de comandos ⌘K

Local: `packages/ui/src/components/CommandPalette.vue` + `packages/ui/src/Workspace.vue` (rota).

⌘K (mac) / Ctrl+K (Win/Linux) → caixa flutuante no topo → digite para filtrar → ↑↓ → Enter executa. Esc fecha.

### Busca

```ts
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q
    ? props.items.filter((it) => `${it.label} ${it.hint ?? ''}`.toLowerCase().includes(q))
    : props.items
})
```

- Casa label + hint (hint da conexão = nome do dialeto), pure substring `includes` (sem pinyin / fuzzy ordenado — velocidade > flexibilidade)
- Máx 50 entradas (evitar lentidão)

### Ações nativas

Tabela das `paletteItems` em `Workspace.vue` (ações + por-conexão + conexões):

| ID global | Label | Equivalente |
|---|---|---|
| `act:new-conn` | Nova conexão | Toolbar + |
| `act:object-search` | Busca global de objetos | ⌘⇧O |
| `act:schema-diff` | Schema diff | Tools → Schema diff |
| `act:data-diff` | Data diff | Tools → Data diff |
| `act:privileges` | Privilégios | Clique direito → Privilégios |
| `act:settings` | Settings | ⌘, |
| `act:export-conns` / `act:import-conns` | Importar / exportar config | Menu File |
| `act:refresh` | Atualizar árvore | F5 |
| `act:favorites` | Favoritos | Toolbar ⭐ |
| `act:oplog` | Log de operações | Toolbar |
| `act:monitor` | Monitor | Toolbar |
| `act:dashboard` | Dashboard | Tools → Dashboard |
| `act:ndjson-viewer` | Visualizador NDJSON | Toolbar |
| `act:contracts` | Data Contracts | Tools → Data Contracts |
| `act:o2dm` | Oracle → DM | Toolbar |
| `act:mig-assess` | Avaliação de migração (perfilamento da origem + notas + conversão IA + exportação) | Clique direito numa conexão Oracle/DM |
| `act:translate` | SQL translate | Toolbar |
| `act:notif` | Webhooks | `Settings → Notificações` |
| `act:keybind` | Atalhos | `Settings → Atalhos` |
| `act:drift` | Schema drift | Toolbar |
| `act:ai-chat` / `act:ai` / `act:ai-toolbox` | Chat IA / Assistente / Toolbox | ⌘⇧L |
| `act:about` / `act:shortcuts` | Sobre / Atalhos | Menu Help |
| `act:new-window` | Nova janela (apenas desktop) | ⌘⇧N |

### Ações por conexão

Expandidas por conexão; label sufixada com `· nome · dialeto`:

| Prefixo ID | Significado |
|---|---|
| `act:activity:` | Atividade (processlist / pg_stat_activity) |
| `act:obtopo:` | Topologia OB (só OB) |
| `act:snapshots:` / `act:backup:` | Snapshots / Backup |
| `act:health:` / `act:vqd:` | Health check / Visual query |
| `act:slowq:` / `act:idxrec:` / `act:repl:` | Slow query / Index recommender / Replication lag |
| `act:compliance:` / `act:search-value:` | Conformidade / Cross-table search |
| `act:aicmt:` | IA escrever comentários |
| `conn:` | Abrir conexão (grupo = "Conexões") |

> Um workspace com 5 conexões mostra 80+ entradas; o filter substring + grupo encontra em 3-4 chars.

### Extensão

A lógica concentra-se em `paletteItems`. Adicionar comando: array `{ id, label, group }` + roteamento em `onPaletteSelect()` (`else if`). Para "por conexão", siga `act:compliance:`: `.map(c => ({ id: \`act:xxx:${c.id}\`, ... }))`, e no router `item.id.startsWith()`.

---

## 3. Busca global de objetos ⌘⇧O

Local: `packages/ui/src/components/ObjectSearchDialog.vue`.

⌘⇧O / Ctrl+Shift+O → abre o diálogo, **busca fuzzy de tabelas/views/colunas entre bancos** da conexão.

### SQL de busca

`information_schema`, duas variantes:

| Família | Schemas excluídos | Escape |
|---|---|---|
| MySQL | `mysql / information_schema / performance_schema / sys` | `LIKE '%term%'`, `%_\\` 3-char |
| PG | `pg_catalog / information_schema` | `ILIKE '%term%'` |
| Outros | — | Não suportado, indica busca manual |

Top 100 por categoria (tabela / view / coluna); debounce 280ms.

### Comportamento

- **Click = reveal**: emite `reveal`; Workspace localiza e seleciona na árvore (expande os caminhos)
- **Hover mostra "Preview"**: emite `preview` → abre `SELECT * FROM schema.table LIMIT 200` (quote por dialeto)
- **Ícones**: `▦` tabela / `◫` view / `·` coluna

### Concorrência segura

`seq` incremental; só o último resultado é commitado, evita override por respostas antigas.

---

## 4. Snippets SQL

Local: `packages/ui/src/snippets.ts` + `packages/ui/src/components/SnippetsPanel.vue`.

### Estrutura

```ts
interface Snippet {
  id: string        // `${timestamp}-${rand5}`
  name: string      // nome do usuário; default = 40 chars do SQL
  sql: string
  tags?: string[]   // tags para filtro
  dialects?: DbDialect[]  // restrição de dialeto, vazio = universal
  createdAt: number
}
```

`localStorage.skylerx.snippets`, Vue `reactive` + `watch deep`.

### Adicionar / remover

- Qualquer editor SQL: clique direito → "Salvar como snippet" ou `★`
- Histórico: `★` por linha
- `Settings → Editor → Salvar snippet` default ⌘S (configurável)

### Templates com placeholders

`{{var}}` em snippets → prompt na inserção:

```sql
SELECT * FROM {{table}} WHERE id = {{id}}
```

`applySnippetVars()` extrai na ordem; qualquer cancel → não insere.

### Filtro por dialeto

`snippetsForDialect(dialect)` filtra:

- `dialects = []` ou ausente → universal
- `dialects = [MySQL, MariaDB]` → só em conexões MySQL / MariaDB

Evita ver SQLs MySQL em conexões PG.

### Painel

| Ação | Efeito |
|---|---|
| Busca | Substring sobre name + SQL + tags |
| Click em `#xxx` | Filtra por tag; clique de novo cancela |
| Duplo clique | Aplica placeholders e insere |
| `×` | Remove (sem confirmação) |

---

## 5. Histórico

Local: `packages/ui/src/components/HistoryPanel.vue`.

Cada execução (sucesso / falha) grava em SQLite local: `sql / executedAt / durationMs / success / pinned / tags / note`.

### Ordenação + filtros

| Controle | Descrição |
|---|---|
| Busca | Substring em sql + tags + note |
| Ordenação | `Tempo desc` (default) / `Duração desc` |
| `≥ N ms` | Threshold slow; **linha vermelha** (default 500ms) |
| `📌` | Apenas fixados |
| `Limpar` | Limpa tudo |

Fixados sempre no topo (`pinned: 1`); resto pela ordenação escolhida.

### Ações por linha

| Botão | Efeito |
|---|---|
| `📌` | Fixar/desfixar |
| `🏷` | Editar tags (csv: `daily,prod,join`) |
| `📝` | Editar nota |
| `★` | Salvar como snippet (emite `saveSnippet`) |
| Duplo clique | Carrega SQL no editor atual |

Metadados via `client.connections.historyMeta(id, patch)` → SQLite (não localStorage).

### Slow → notificação

`Settings → Notificações → Trigger global → Slow query (ms)` (`settings.slowQueryNotifyMs`). > 0 dispara `notify('slow-query', ...)` para os webhooks correspondentes.

---

## 6. Favoritos

Local: `packages/ui/src/favorites.ts`.

3 `kind`:

| kind | Significado | Click |
|---|---|---|
| `table` | Tabela | Reveal + preview 200 linhas |
| `view` | View | Idem |
| `query` | SQL custom | Abre em aba (atual / nova) |

### Chave primária

- Objeto: `${connId}|${sqlName}` — único por (conn, objeto); toggle remove
- Query: `q|${connId}|${createdAt}|${rand4}` — múltiplas instâncias do mesmo SQL ("snapshots por momento")

### Tags

`setFavoriteTag(id, tag)` atribui tag; painel agrupa.

### Persistência

`localStorage.skylerx.favorites`, reactive + watch deep.

### Do histórico para favoritos

`addQueryFavorite({ connId, connName, dialect, name, sql, tags })` é o atalho "esta query vale guardar". `★` do HistoryPanel → snippet; "Favoritar query atual" da toolbar → essa função.

---

## 7. Atalhos custom (K1)

Local: `packages/ui/src/keybindings.ts` + `packages/ui/src/components/KeyBindingsDialog.vue`.

Entrada: `Settings → Atalhos` / paleta → "Atalhos".

### 12 comandos

| ID | Chord padrão | Uso |
|---|---|---|
| `run-sql` | `CmdOrCtrl+Enter` | Executar SQL |
| `palette` | `CmdOrCtrl+K` | Paleta |
| `object-search` | `CmdOrCtrl+Shift+O` | Busca global |
| `ai-chat` | `CmdOrCtrl+Shift+L` | Chat IA |
| `new-conn` | `CmdOrCtrl+N` | Nova conexão |
| `new-query` | `CmdOrCtrl+T` | Nova consulta |
| `close-tab` | `CmdOrCtrl+W` | Fechar aba |
| `find` | `CmdOrCtrl+F` | Buscar no editor |
| `replace` | `CmdOrCtrl+H` | Substituir |
| `format-sql` | `CmdOrCtrl+Shift+F` | Formatar SQL |
| `save-snippet` | `CmdOrCtrl+S` | Salvar snippet |
| `settings` | `CmdOrCtrl+,` | Settings |

### Renderização

| Plataforma | `CmdOrCtrl+Shift+K` aparece como |
|---|---|
| macOS | `⌘⇧K` (estilo nativo, sem `+`) |
| Windows / Linux | `Ctrl+Shift+K` |

Armazenado como `CmdOrCtrl+...` (independente de SO); render por `formatChord()`.

### Gravação

1. Clique em "Gravar" → linha entra em modo gravação com `input` invisível (`position: absolute; left: -9999px`) para foco
2. `keydown` → `chordFromEvent(e)`:
   - Modificadores em ordem fixa `CmdOrCtrl → Shift → Alt`
   - Letras únicas maiúsculas, space → `Space`, `Enter` / `,` / `ArrowUp` originais
   - Modificador puro → string vazia
3. Enter salva / Esc cancela / Backspace em draft vazio = "desabilitar este comando" (string vazia)

### Conflitos

`conflicts` computa colisões e mostra "conflito com XX" em vermelho.

### Armazenamento + "restaurar default"

Só os diferentes do default em `settings.keyBindings`:

- Voltar ao default → entrada removida
- "Restaurar tudo" → limpa `settings.keyBindings` com confirmação
- "Desabilitar" = string vazia (chave mantida)

---

## 8. Dashboard — multi-SQL multi-cards

Local: `packages/ui/src/components/DashboardDialog.vue`.

Entrada: Tools → Dashboard / ⌘K → "Dashboard".

### Estrutura do card

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

- Persiste em `localStorage.skylerx.dashboard.cards`, **sem `lastResult`** (pode ser grande)
- Exibe: título + conn + SQL (200 chars) + 5 linhas top de resultado (60 chars)

### Ações

| Botão | Efeito |
|---|---|
| `+ Adicionar card` | Form: título + conn + SQL (textarea 4 linhas) |
| `↻ Atualizar tudo` | `Promise.all(cards.map(runCard))` |
| `↻` no card | Atualizar individual |
| `✎` | Editar |
| `×` | Remover (confirmação) |

### Não-funcionalidades

- **Sem auto-refresh**: pode rodar em background esquecido; clique manual
- **Sem gráficos**: "→ ChartDialog" é mais claro
- **Sem compartilhamento**: pré-v0.5, sem dependência de cloud

---

## 9. Webhooks de notificação

Local: `packages/ui/src/notifications.ts` + `packages/ui/src/components/NotificationSettingsDialog.vue`.

Entrada: `Settings → Notificações` / ⌘K → "Webhooks".

### 4 canais

| Channel | URL | Assinatura |
|---|---|---|
| `dingtalk` | DingTalk webhook | HMAC-SHA256(`ts\n${secret}`, key=`secret`), query `?timestamp=&sign=urlencoded(...)` |
| `feishu` | Lark webhook | HMAC-SHA256(empty data, key=`ts\n${secret}`), sign no body |
| `slack` | Slack incoming webhook | Sem assinatura (URL é credencial) |
| `webhook` | POST JSON genérico | Sem assinatura, receptor decide |

Assinatura via `globalThis.crypto.subtle` HMAC-SHA256, **sem terceiros**.

### 3 eventos

| Event | Quando |
|---|---|
| `query-error` | Falha SQL |
| `slow-query` | Duração ≥ `settings.slowQueryNotifyMs` (0 = off) |
| `manual` | Teste / botão "Notificar" |

Cada config pode subscrever independente (`subscribe: NotifEvent[]`).

### Config

```ts
interface NotifConfig {
  id: string
  name: string
  channel: 'dingtalk' | 'feishu' | 'slack' | 'webhook'
  webhookUrl: string
  secret?: string           // segredo DingTalk/Lark (opcional)
  enabled: boolean
  subscribe: NotifEvent[]
}
```

`localStorage.skylerx.notifications`, independente de `settings` (notificações têm volume e mudam muito).

### Teste

`Settings → Notificações` → escolher config → "Testar". Condições:

- `enabled === true`
- `webhookUrl` não vazio
- `subscribe.includes('manual')`

Falha → toast, não envia de verdade.

### Não-bloqueante

`notify(event, payload)` é fire-and-forget:

```ts
await Promise.all(targets.map(async (c) => {
  try { await dispatchOne(c, payload) }
  catch (e) { console.warn(`[notify] ${c.channel}/${c.name} failed:`, e) }
}))
```

Falha de webhook = warning no console. **Notificação é canal auxiliar, não bloqueia fluxo principal.**

### Proxy fetch no desktop

Electron usa `globalThis.api.ai.fetch` (proxy do main, ignora CORS); web → `fetch` nativo.

---

## 10. Menu da aplicação

Local: `apps/desktop/src/main/menu.ts`.

7 menus (estilo DataGrip / Navicat):

| Menu | Itens |
|---|---|
| **SkylerX** (mac) | Sobre / Settings ⌘, / Verificar atualizações / Services / Esconder / Sair |
| **File** | Nova conexão ⌘N / Nova query ⌘T / Abrir SQL ⌘O / Importar · exportar config / Backup · restore / Fechar aba ⌘W |
| **Edit** | role do sistema (undo / redo / cut / copy / paste / select all) + Find ⌘F / Replace ⌘H / Format SQL ⌘⇧F |
| **View** | Paleta ⌘K / Object search ⌘⇧O / Chat IA ⌘⇧L / Favoritos / Log / Zoom / Fullscreen / DevTools |
| **Tools** | Server activity / Backup / Data transfer / Schema diff / Data diff / Snapshots / Dashboard / Cross-table search / Data contracts / AI Toolbox / AI Assistant |
| **Window** | Nova janela ⌘⇧N / Minimizar / Reload / (mac) trazer todas à frente |
| **Help** | Sobre / Atalhos / GitHub / Reportar problema / Verificar atualizações |

### Implementação

Itens custom **não executam lógica no main process** (sem acesso ao estado Vue); enviam `webContents.send('menu:command', '<key>')`. Renderer assina via `window.api.menu.onCommand(key => ...)` no `Workspace.vue` e roteia para `onPaletteSelect` correspondente.

---

## 11. Visão geral de Settings

Local: `packages/ui/src/components/SettingsDialog.vue`.

5 categorias à esquerda; formulário à direita.

| Categoria | Principais itens |
|---|---|
| **Geral** ⚙ | Idioma (zh / en) / Tema (escuro / claro) / Zoom (70-200%) / Commit mode default / NavTree por uso / **Mascaramento on/off + regras** |
| **Editor** ⌨ | Fonte / indent / wrap / autocomplete / case (upper / lower / preserve) |
| **Grade** ▦ | Page size (50 / 100 / 200 / 500 / 1000) / texto NULL |
| **Marca d'água prod** ⚠ | Texto / opacidade (0.04-0.5) / ângulo (-90° a 90°) / fonte / cor; preview ao vivo |
| **AI** ✨ | Provider (Anthropic / OpenAI / DeepSeek / Codex / Grok) / API Key / Model / Base URL / Memória A / B / C |

> **Tema**: `Settings → Geral → Tema` afeta todos os painéis. Escuro default (`appearance: 'dark'`).

### "Memória AI" três camadas

| Camada | Campo | Significado |
|---|---|---|
| A | `aiCustomInstructions` | Perfil em texto livre, injetado no system prompt toda hora |
| B | `aiFacts[]` + `aiAutoExtractFacts` | Fatos estruturados, manuais / automáticos |
| C | `aiVectorMemory` + embedding + `aiVectorTopK` | Memória vetorial cross-session |

Rodapé `Restaurar default` reseta tudo com confirmação.

---

## 12. Multi-janelas ⌘⇧N

Local: `apps/desktop/src/main/index.ts` `spawnExtraWindow()` + IPC `window:newSession`.

⌘⇧N / Ctrl+Shift+N → nova BrowserWindow (1100 × 750), mesma renderer URL, **sessão totalmente independente**.

### Uso típico

| Cenário | Como |
|---|---|
| Local vs remoto | Principal = dev local; nova = prod replica; lado a lado |
| Multi-tenants | Janela A para tenant A, B para tenant B |
| Query lenta + escrita | Principal roda SQL longo; nova escreve a próxima |

Cada janela: abas / conexão / banco / schema / cursor independentes. Histórico / favoritos / snippets são **compartilhados** (localStorage + SQLite único).

Sem "sincronização" (execuções de uma janela não aparecem na outra); sem gerenciador, use Mission Control / Exposé.

---

## 13. Atalhos completos

Defaults; tudo customizável em `Settings → Atalhos` (`new-window` é menu, não está em `COMMANDS`).

| Ação | macOS | Windows / Linux | ID |
|---|---|---|---|
| Paleta | ⌘K | Ctrl+K | `palette` |
| Busca de objetos | ⌘⇧O | Ctrl+Shift+O | `object-search` |
| Executar SQL | ⌘+Enter | Ctrl+Enter | `run-sql` |
| Chat IA | ⌘⇧L | Ctrl+Shift+L | `ai-chat` |
| Nova conexão / query / fechar aba | ⌘N / ⌘T / ⌘W | Ctrl+N / T / W | `new-conn` / `new-query` / `close-tab` |
| Find / Replace / Format | ⌘F / ⌘H / ⌘⇧F | Ctrl+F / H / Shift+F | `find` / `replace` / `format-sql` |
| Save snippet / Settings | ⌘S / ⌘, | Ctrl+S / Ctrl+, | `save-snippet` / `settings` |
| Nova janela | ⌘⇧N | Ctrl+Shift+N | (menu) |
