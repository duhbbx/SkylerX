# Editor SQL

## Abrir uma página de consulta

- ⌘T / Ctrl+T: nova aba de consulta
- Duplo clique no nome da tabela → abre a grade de dados por padrão (equivalente a `SELECT * FROM table LIMIT 200`)
- Clique direito na tabela → "Nova consulta", o editor pré-preenche `SELECT * FROM ...`

## Capacidades do editor

Baseado em Monaco (mesmo do VS Code), tema SQL.

### Autocompletar

`Ctrl+Space` ou digitação dispara automaticamente, completando:

- Palavras-chave SQL / funções nativas
- Nomes de todos os bancos / schemas da conexão atual
- Nomes de colunas das tabelas referenciadas em FROM / JOIN
- Snippets SQL salvos (nome do snippet como gatilho)

### Formatação

⌘⇧F / Ctrl+Shift+F formata com um clique (via sql-formatter). Respeita o estilo de cada dialeto (MySQL / PG / Oracle têm preferências distintas).

### Parâmetros

Suporta parâmetros nomeados `:name`. Na execução, abre um popup pedindo os valores:

```sql
SELECT * FROM orders
 WHERE user_id = :uid
   AND created_at >= :start
```

Após executar, o popup pede `uid` e `start`, e o SkylerX converte para o formato suportado pelo driver (`?` ou `$1` etc.).

### Biblioteca de snippets SQL

`⌘K → Snippets` ou painel "Snippets" à esquerda:

- Salve SQL frequentes (nome + descrição + tags)
- Filtre por tag
- Duplo clique insere no editor atual, ou arraste para qualquer aba

## Execução

| Atalho | Comportamento |
|---|---|
| ⌘+Enter / Ctrl+Enter | Executa (apenas a seleção se houver, senão tudo) |
| Botão "Executar" da toolbar | O mesmo |
| Botão "Cancelar" da toolbar | Cancelamento no servidor (MySQL `KILL QUERY` / PG `pg_cancel_backend`) |

Múltiplas instruções são divididas automaticamente por `;` e executadas em ordem; qualquer falha interrompe e destaca em vermelho a instrução com erro.

## Interceptação de risco via SQL Linter

Antes de executar, o motor de regras roda automaticamente:

| Severidade | Regra | Comportamento |
|---|---|---|
| error | UPDATE / DELETE sem WHERE | Confirmação modal de "SQL perigoso" |
| error | DROP TABLE / DATABASE em conexão prod | Confirmação modal |
| warn | TRUNCATE em prod | Aviso toast |
| warn | FROM multi-tabelas sem ON | Toast |
| info | `SELECT *` | Registro no console |
| info | SELECT sem LIMIT | Registro no console |

**O Lint tem prioridade sobre a confirmação forte de prod**, evitando que um UPDATE sem WHERE dispare dois popups ao mesmo tempo.

## Visualização de EXPLAIN

Botão **Explicar** na toolbar (ou `EXPLAIN+` para alternar ANALYZE com execução real):

- Árvore de nós mostra o plano de execução
- Comparação de linhas estimadas / reais (modo ANALYZE)
- Operadores lentos coloridos por tempo: verde (< 100ms) / amarelo (< 1s) / vermelho (> 1s)
- Exportação opcional como PNG / Markdown para compartilhar

## Autocompletar inline de IA (estilo Copilot)

Ativado automaticamente após configurar em `Settings → AI Provider`:

- Disparado após 600ms parado com o cursor
- Requisições em voo são canceladas imediatamente se uma nova for disparada
- Tab aceita, Esc/Backspace cancela
- Compartilha o interruptor geral com o "autocompletar SQL" (`Settings → Autocomplete`)

## Pedir ajuda à IA em caso de erro

Quando a execução falha:

- A área de resultados mostra o erro completo + SQLSTATE / errno
- Botão "**✨ Perguntar à IA**" no topo → envia o SQL atual + erro + metadados da conexão ao painel de chat e inicia a conversa automaticamente
- Qualquer popup de alerta também tem o botão "Perguntar à IA"

## Histórico de consultas

`⌘K → Histórico` ou painel "Histórico" à esquerda:

- Em ordem cronológica reversa
- Mostra conexão / resumo SQL / duração / status de sucesso
- Duplo clique reabre
- Favoritos / busca

## Favoritos

O botão ⭐ adiciona o SQL atual aos favoritos:

- Nome customizado + tags
- Disponível entre conexões
- Acesso rápido via paleta de comandos ⌘K → "Favoritos"

## Gerenciamento de múltiplas abas

- Clique do meio na aba → fechar
- Clique direito → duplicar / mover para outra janela / fixar / fechar todas à direita
- Arrastar e soltar para reordenar
- Abas fixadas são preservadas após reiniciar a aplicação
