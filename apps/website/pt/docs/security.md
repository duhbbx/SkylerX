# Segurança e conformidade

O SkylerX atende ambientes dev / test / prod e traz um modelo de segurança ponta a ponta — **das credenciais de conexão à renderização do resultado, do envio do SQL à exportação em lote**. Esta página descreve cada barreira realmente implementada no código: o que faz, o que não faz e que evidências entrega para ops e auditoria.

## 1. Visão geral

A segurança é segmentada em cinco etapas do fluxo de dados, cada uma com módulo próprio:

| Etapa | Módulo / arquivo | Responsabilidade |
|---|---|---|
| Credenciais em disco | `apps/desktop/src/main/db/connectionStore.ts` | Senhas / chave privada SSH criptografadas no chaveiro do SO (`safeStorage`) |
| Identificação de ambiente | `packages/ui/src/connEnv.ts` | Marcação tri-cor dev/test/prod + conexão somente leitura + whitelist de statements de leitura |
| Interceptação de statements | `packages/ui/src/sqlLint.ts` | 7 regras heurísticas (UPDATE/DELETE sem WHERE, DROP/TRUNCATE em prod etc.) |
| Apresentação | `packages/ui/src/masking.ts` + `DataMaskingViewDialog` | Mascaramento na renderização + view de mascaramento persistido |
| Governança / auditoria | `compliance.ts` / `PiiScannerDialog` / `DataContractDialog` / `export-encrypt.ts` | Conformidade GB17859 (segurança nível 2.0 da China), PII scan, data contracts, exportação criptografada |

A seguir, em detalhes.

## 2. Criptografia de senhas (chaveiro do SO)

Local: `apps/desktop/src/main/db/connectionStore.ts`.

Ao criar / editar conexão, a senha não vai como texto plano no SQLite. Vai por `safeStorage` do Electron (macOS = Keychain, Windows = DPAPI, Linux = libsecret / kwallet):

```ts
function encryptPassword(plain?: string): string | null {
  if (!plain) return null
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(plain).toString('base64')}`
  }
  return `plain:${Buffer.from(plain, 'utf8').toString('base64')}`
}
```

O campo tem prefixo, facilitando identificar a versão:

| Prefixo | Significado | Quando |
|---|---|---|
| `enc:` | Ciphertext do chaveiro | Caminho normal, macOS / Windows / maioria do Linux |
| `plain:` | Fallback base64 (**apenas dev**) | `safeStorage.isEncryptionAvailable()` retorna `false` (container Linux sem libsecret / kwallet) |
| Outro | Campo antigo sem prefixo | Dados históricos |

> **Importante**: `plain:` ainda funciona, mas **equivale a texto plano**. No Linux, instale `gnome-keyring` ou `kwallet` e force re-edição da conexão (qualquer alteração salva re-criptografa).

### Chave do SSH tunnel

A config SSH contém `password` / `privateKey` / `passphrase`; toda a cadeia é criptografada. **No `listConnections`**, os campos secretos são removidos para evitar carga em memória:

```ts
function decryptSsh(stored, withSecrets) {
  const ssh = JSON.parse(decryptPassword(stored)) as SshConfig
  return withSecrets
    ? ssh
    : { ...ssh, password: undefined, privateKey: undefined, passphrase: undefined }
}
```

Apenas no `getConnection` (conectar / editar) eles voltam completos.

## 3. Marcadores dev/test/prod + proteção de produção

Local: `packages/ui/src/connEnv.ts`.

Config tem `extra.env`, enum tri-estado:

| Valor | Label | Cor (`ENV_META.color`) | Severidade |
|---|---|---|---|
| `dev` | Desenvolvimento | `#4caf50` verde | Padrão |
| `test` | Teste | `#e0a020` laranja | Padrão |
| `prod` | Produção | `#e04050` vermelho | **Regras extras de SQL + confirmação dupla na execução** |

### Conexão inteira somente leitura (`extra.readOnly`)

Sinalizada por `connReadOnly()`. Duas portas em paralelo:

1. **Nível conexão**: `isReadOnlyStatement(sql)` aceita apenas palavras-chave iniciais `select / with / show / explain / desc(ribe) / pragma`; statements de escrita são bloqueados.
2. **Commit mode**: somente leitura força `auto` (transação manual é inútil); `initialCommitMode()`.

### Marca d'água de produção

`Settings → Marca d'água de produção` permite customizar texto / ângulo / opacidade / cor. Em conexões prod, todas as views (editor SQL, resultados, preview de exportação) ganham marca d'água SVG, dificultando screenshots.

## 4. SQL Linter — 7 regras

Local: `packages/ui/src/sqlLint.ts`.

Scan heurístico de strings (sem parser completo), pega apenas padrões "óbvios". Três níveis:

| Severidade | Feedback UI | Executa? |
|---|---|---|
| `error` | Confirmação modal | Apenas após confirmar |
| `warn` | Toast | **Executa** (apenas avisa) |
| `info` | Decisão do chamador (pode marcar na margem do editor) | Executa |

Regras completas:

| ID | Severidade | Condição | Mensagem |
|---|---|---|---|
| `no-where-update` | error | `UPDATE` sem `WHERE` | UPDATE sem WHERE, atualizará toda a tabela |
| `no-where-delete` | error | `DELETE FROM` sem `WHERE` | DELETE sem WHERE, esvaziará a tabela |
| `prod-drop` | error | env=prod + `DROP TABLE/DATABASE/SCHEMA/INDEX/VIEW` | DROP em produção |
| `prod-truncate` | warn | env=prod + `TRUNCATE` | TRUNCATE em produção |
| `cross-join` | warn | `SELECT` + `FROM a, b` (JOIN com vírgula) ou `JOIN` sem `ON/USING` | Multi-tabelas sem condição de join (provável cartesiano) |
| `select-star` | info | `SELECT *` | Sugira listar colunas explicitamente |
| `forgotten-limit` | info | `SELECT` sem `LIMIT` / `FETCH FIRST` / `TOP n` / `COUNT()` | SELECT sem LIMIT, pode trazer muitos dados |

### Restrição "barata"

Comentários são removidos com 2 regex simples (`/\/\*[\s\S]*?\*\//g` e `/--[^\n]*/g`) para que `-- WHERE 1=1` não engane o linter. Tudo O(n), sem impacto perceptível.

### Agregação em multi-statements

`lintStatements(stmts, ctx)` deduplica findings do mesmo `id` mantendo a severidade mais alta, ideal para "selecione um arquivo SQL inteiro e execute".

## 5. Data contracts (notNull / range / regex)

Local: `packages/ui/src/components/DataContractDialog.vue`.

Contratos antecipam "valores que NUNCA deveriam estar no campo de negócio". Quatro partes:

| Campo | Tipo | Descrição |
|---|---|---|
| `name` | string | Nome dado pelo usuário |
| `table` | string | `schema.table` aplicável |
| `notNull` | `string[]` | Colunas não-nulas |
| `range` | `Record<string, [min, max]>` | Range numérico, `null` = sem limite |
| `regex` | `Record<string, string>` | Regex obrigatória |
| `enabled` | boolean | On/off |

Armazenamento: `localStorage.skylerx.dataContracts`, JSON array.

### Uso típico

```json
{
  "name": "Integridade da tabela de usuários",
  "table": "public.users",
  "notNull": ["phone", "email"],
  "range": { "age": [0, 150] },
  "regex": { "email": "^[^@]+@[^@]+$", "phone": "^1\\d{10}$" },
  "enabled": true
}
```

### Importação / exportação

- **📋 Exportar** → JSON no clipboard, fácil de compartilhar via doc / git
- **📥 Importar** → cole JSON, sobrescreve

DBA escreve contratos e distribui aos devs; ao colar no SkylerX local, os contratos passam a valer.

## 6. PII Scanner

Local: `packages/ui/src/components/PiiScannerDialog.vue`.

Heurística em duas fases: **match por nome → validação por amostra**.

### Fase 1 — match por nome

Regex `columnPattern` de `DEFAULT_MASK_RULES` (ver próxima seção). `user_phone` casa `(phone|mobile|tel|手机|电话)` → kind `phone`.

### Fase 2 — amostra (opcional)

Puxa as primeiras N linhas (default 50, ajustável 10-1000) e revalida com regex:

| kind | Regex de validação |
|---|---|
| `phone` | `/^\+?[\d\s\-()]{7,20}$/` |
| `email` | `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` |
| `idCard` | `/^\d{15}$\|^\d{17}[\dxX]$/` |
| `bankCard` | `/^\d{12,19}$/` |
| `name` / `address` / `default` | sem; apenas nome |

Hit rate < 30% → assume "coincidência de nome, não é PII" e remove.

### Relatório e próximos passos

Agrupado por "hit count desc" por tabela; **📋 Exportar CSV** (colunas: schema/table/column/data_type/rule/kind/sample). O CSV vai direto para auditoria; também serve para gerar a view de mascaramento (clique direito no banco → "Gerar view de mascaramento").

## 7. View de mascaramento (DataMaskingViewDialog)

Local: `packages/ui/src/masking.ts` + `packages/ui/src/components/DataMaskingViewDialog.vue`.

### 7.1 Regras embutidas

`DEFAULT_MASK_RULES` é a baseline; editável em `Settings → Mascaramento`.

| Regra | columnPattern | kind | Default | Algoritmo |
|---|---|---|---|---|
| Telefone | `(phone\|mobile\|tel\|手机\|电话)` | phone | ✅ | 3 primeiros + `****` + 4 últimos |
| Email | `(email\|mail\|邮箱)` | email | ✅ | 1ª letra + `***@domain` |
| ID | `(id_?card\|身份证\|idno)` | idCard | ✅ | 6 primeiros + `*…` + 4 últimos |
| Cartão | `(bank_?card\|card_?no\|账号\|账户)` | bankCard | ✅ | 4 primeiros ` **** **** ` 4 últimos |
| Nome | `(real_?name\|user_?name\|full_?name\|姓名)` | name | ❌ | 1ª letra + `*` |
| Endereço | `(address\|addr\|地址)` | address | ❌ | 6 primeiros + `***` |
| Senha / Token | `(password\|passwd\|secret\|pwd\|token\|api_?key\|密码)` | default | ✅ | 2 primeiros + `****` + 2 últimos |

### 7.2 Mascaramento na renderização vs view persistido

Dois caminhos independentes:

- **Render-time**: `Settings → Mascaramento → ativar`. Front aplica regra por coluna → algoritmo, sem alterar o DB; no diálogo de exportação você escolhe "original / mascarado".
- **View persistido** (`DataMaskingViewDialog`): gera `CREATE OR REPLACE VIEW ... AS SELECT mask_expr(c) ...` no DB; **aplicações leem a view, não a tabela original**. Seis estratégias:

| Estratégia | Expressão (MySQL) |
|---|---|
| `raw` original | `` `c` AS `c` `` |
| `md5` | `` md5(CAST(`c` AS char(4000))) AS `c` `` |
| `partial` N e M | `` CONCAT(LEFT(`c`,N), '***', RIGHT(`c`,M)) AS `c` `` |
| `fixed` substituir | `'***' AS \`c\`` |
| `truncate` truncar | `` LEFT(`c`, max) AS `c` `` |
| `null` | `` NULL AS `c` `` |

Ao abrir, `recommendStrategy(colName)` sugere; usuário pode sobrescrever. SQL editável antes de `▶ Criar view`.

## 8. Conformidade GB17859 (segurança nível 2.0 da China)

Local: `packages/ui/src/compliance.ts` + `packages/ui/src/components/ComplianceDialog.vue`.

Cobre o que pode ser verificado direto pela conexão (não firewall / disco). Quatro estados:

| Severidade | Significado |
|---|---|
| `pass` ✅ | Conforme |
| `warn` ⚠️ | Não conforme mas risco controlado (auditoria off, SSL off) |
| `fail` ❌ | Violação séria (root remoto, usuário sem senha) |
| `unknown` — | Não pôde julgar (sem permissão, recurso enterprise) |

### Família MySQL (MySQL / MariaDB / OceanBase / TiDB) — 7 itens

| ID | Categoria | Título | Como verifica |
|---|---|---|---|
| `mysql.auth.password-policy` | Autenticação | Política de senha forte | `SHOW VARIABLES LIKE 'validate_password%'`, policy ≥ MEDIUM e length ≥ 8 |
| `mysql.audit.enabled` | Auditoria | Audit log ativo | `audit_log_*` (enterprise) ou `server_audit_*` (MariaDB) |
| `mysql.auth.root-remote` | Acesso | root sem login remoto | `SELECT user, host FROM mysql.user WHERE user='root'` |
| `mysql.auth.anonymous` | Acesso | Sem usuários anônimos | `mysql.user WHERE user=''` |
| `mysql.transport.ssl` | Integridade | SSL obrigatório | `require_secure_transport=ON` |
| `mysql.audit.slowlog` | Auditoria | Slow log ativo | `slow_query_log=ON` |
| `mysql.integrity.binlog` | Integridade | Binlog ativo | `log_bin=ON` (PITR / replicação) |

### Família PostgreSQL (PG / KingbaseES / openGauss / Greenplum / CockroachDB) — 6 itens

| ID | Categoria | Título | Como verifica |
|---|---|---|---|
| `pg.auth.password-encryption` | Autenticação | SCRAM-SHA-256 | `SHOW password_encryption` |
| `pg.audit.pgaudit` | Auditoria | Extensão pgaudit | `pg_extension WHERE extname='pgaudit'` |
| `pg.transport.ssl` | Integridade | SSL ativo | `SHOW ssl` |
| `pg.access.superuser-count` | Acesso | Superusuários ≤ 2 | `SELECT rolname FROM pg_roles WHERE rolsuper` |
| `pg.audit.log-statement` | Auditoria | log_statement configurado | `SHOW log_statement` ≠ none |
| `pg.auth.empty-password` | Autenticação | Sem usuário com senha vazia | `pg_authid WHERE rolpassword IS NULL AND rolcanlogin` |

### Exportação Markdown

`Exportar Markdown` chama `renderReport()`, agrupa por categoria, adiciona "resumo: ✅ N · ⚠️ N · ❌ N · — N" + por regra: descrição / conclusão / `evidence`. Nome: `compliance-<safeName>-<YYYY-MM-DDTHH-MM-SS>.md`.

### Execução paralela

"Iniciar verificação" usa `Promise.all`; falha de uma não afeta as outras (try/catch → `unknown`); driver faz queueing.

### Outros dialetos

Não-MySQL / PG: item placeholder

```
Verificação de conformidade não disponível para este dialeto — verifique manualmente
```

Oracle / SQL Server / SQLite / DM virão sob demanda.

## 9. Criptografia nacional chinesa SM2/SM3/SM4 (planejado)

As regras de conformidade já tratam `password_encryption=md5` como algoritmo fraco (ver descrição em `pg.auth.password-encryption`). As APIs auxiliares de SM2 / SM3 / SM4 (para assinar / criptografar em camada de aplicação antes de gravar) **ainda não foram lançadas**; previstas para v0.6 em `cryptoCn.ts`:

- SM2 ECC sign / encrypt / decrypt (sm-crypto)
- SM3 message digest
- SM4 cifra de bloco simétrica (CBC / ECB)

Assinaturas serão documentadas aqui em "Criptografia nacional chinesa SM2/SM3/SM4 API auxiliar".

## 10. Exportação criptografada .skbk

Local: `packages/ui/src/export-encrypt.ts`.

Texto qualquer (geralmente SQL dump ou config de conexão) criptografado com senha em JSON em linha única, extensão `.sql.enc` / `.skbk`.

### Stack

| Etapa | Algoritmo | Parâmetros |
|---|---|---|
| KDF | PBKDF2-HMAC-SHA-256 | iter = `DEFAULT_ITER` = **200 000** (anotado no cabeçalho) |
| Cifra | AES-GCM 256 | salt 16B + iv 16B, regerados |
| Integridade | AES-GCM tag 128 bits | senha errada / arquivo alterado → `WRONG_PASSWORD` |
| Magic | `magic: 'SKYLERX-ENC-v1'` | Identifica versão do algoritmo |

> **Sobre 200 000 iterações**: OWASP 2023 recomenda ≥ 600 000 (SHA-256), mas no desktop é preciso considerar máquinas antigas (Atom CPU travaria por +1s em 600k). Para conteúdos extremamente sensíveis, é possível elevar o `iter` ao chamar `encryptText`.

### Formato

```json
{
  "magic": "SKYLERX-ENC-v1",
  "salt": "<base64 16B>",
  "iv":   "<base64 16B>",
  "iter": 200000,
  "data": "<base64 ciphertext + tag>"
}
```

Ordem fixa (bom para git diff); JSON em linha única (streaming).

### Códigos de erro

| Erro | Quando | Feedback UI |
|---|---|---|
| `INVALID_BLOB` | Campos faltando / tipo errado / `magic` errado | "Arquivo corrompido" |
| `WRONG_PASSWORD` | Tag GCM falha (senha errada / arquivo alterado) | "Senha incorreta" (sem distinguir, sem side-channel) |

### Dependência Web Crypto

Tudo via `globalThis.crypto.subtle`, sem terceiros. Desktop Electron renderer + browsers modernos suportam; Node 18+ também (testes). Ambientes muito antigos: `Web Crypto API unavailable: upgrade to Node 18+ or a modern browser`.

## 11. Fronteira de privacidade da IA

A IA (Anthropic / OpenAI / DeepSeek / Codex / Grok) é core do SkylerX, mas só envia **o estritamente necessário**:

| Tipo | Envia? | Notas |
|---|---|---|
| Texto SQL atual | ✅ | Pré-condição do chat / autocomplete |
| Schema hint (banco / tabela / coluna) | ✅ | Apenas metadados; **sem dados de linha** |
| Texto e código de erro | ✅ | Para "Perguntar à IA", veja seção 4 |
| Metadados de conexão (dialeto / nome / banco) | ✅ | Para a IA escolher o dialeto |
| **Dados do result set** | ❌ | Mesmo com inline ligado, só vai schema hint |
| **Senhas / chave SSH** | ❌ | Cipher no chaveiro nunca é lido para prompts |
| **Config de conexão completa** | ❌ | Só dialect / database da conexão selecionada |

Para isolar a IA totalmente:

1. `Settings → AI Provider → Limpar API Key` → desabilita autocomplete / chat / Perguntar à IA
2. Ou use endpoint local (Ollama / vLLM / privado), aponte `endpoint` para `http://localhost:...`

> **Webhooks de notificação seguem o mesmo princípio**: o template default envia "título + resumo + tempo do trigger", sem dados de linha. Personalize em `Settings → Notificações`.

## 12. Atalhos de segurança

| Ação | Entrada |
|---|---|
| Conformidade GB17859 (segurança nível 2.0 da China) | ⌘K → "Conformidade · nome da conexão" / clique direito → Compliance |
| PII Scan | Clique direito banco → PII Scanner |
| View de mascaramento | Clique direito banco / tabela → Gerar view de mascaramento |
| Data Contracts | ⌘K → "Data Contracts" / Ferramentas → Data Contracts |
| Exportação criptografada | Resultado / Editor → Exportar → `.skbk` |
| Política global | `Settings → Mascaramento` / `Settings → Marca d'água` |
| Atalhos custom (anti-toque) | `Settings → Atalhos` |

## 13. Limitações conhecidas

Fronteiras a ter em mente:

- **Linter é heurístico**: sem parser SQL completo; raramente falha (string literal com `where` dentro de `/* ... */`). Para operações de alto risco, ative confirmação dupla de prod (digitar nome da conexão).
- **Conformidade requer permissão**: `mysql.user` precisa de SELECT; `pg_authid` precisa de superuser; itens sem permissão viram `unknown`, **não considere `unknown` como `pass`**.
- **Mascaramento na renderização é UI-only**: dado no DB segue original. Para impedir leitura, use view de mascaramento + lockdown de permissões.
- **Arquivo criptografado não resiste a "dicionário brute-force"**: 200k iter PBKDF2 = ~10^7 de custo; senhas fracas podem ser quebradas offline. Use senhas fortes ou KMS / chaves públicas internas.
- **Marcador de ambiente é soft**: `extra.env = 'prod'` depende de o usuário marcar; um deslize ("dev") desativa as proteções prod. Padronize via "exportar config → importar no time".
