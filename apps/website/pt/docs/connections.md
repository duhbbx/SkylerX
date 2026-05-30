# Gerenciamento de conexões

## Nova conexão

⌘N / Ctrl+N ou o botão "Nova conexão" no canto superior esquerdo → abre o formulário.

### Campos básicos (todos os dialetos)

| Campo | Descrição |
|---|---|
| Nome da conexão | Apenas para exibição, livre |
| Dialeto | Tipo de banco (MySQL / PG / Oracle / ...) |
| Host | hostname ou IP |
| Porta | Preenchida automaticamente conforme o dialeto (MySQL 3306 / PG 5432 / Oracle 1521 ...) |
| Usuário | Nome de usuário |
| Senha | Pode deixar vazio para salvar e perguntar na primeira conexão |
| Banco | Banco / schema padrão; pode ficar vazio |
| Grupo | Pasta na raiz da árvore de conexões, útil para gerenciar múltiplos ambientes |
| Marcador de ambiente | dev / test / prod — prod ativa [proteção de produção](#proteção-de-produção) |

### Campos específicos por dialeto

#### Oracle / tenant OB Oracle

| Campo | Descrição |
|---|---|
| Service Name | Padrão XEPDB1; container `gvenzl/oracle-free` usa FREEPDB1 |
| privilege | SYSDBA / SYSOPER / SYSASM / SYSBACKUP / SYSDG / SYSKM / SYSRAC; vazio para conexão normal |

> **Login SYSDBA** no Oracle normalmente conecta na raiz CDB (`FREE`, não `FREEPDB1`).

#### Snowflake

| Campo | Descrição |
|---|---|
| Account | Identificador Snowflake estilo `xy12345.us-east-1` |
| Warehouse | Compute warehouse |
| Role | Papel padrão |
| Schema | Schema padrão |
| Authenticator | Padrão password, ou `snowflake_jwt` para chave privada |
| Private Key Path | Arquivo PEM da chave privada (exibido no modo JWT) |
| Private Key Passphrase | Passphrase da chave privada (se houver) |

#### MongoDB

Modo **URI direto** opcional: `mongodb://user:pass@host:27017/db?replicaSet=rs0`. Quando preenchido, ignora host/port/user/password.

#### SQLite / DuckDB

Não precisam de host/port/user, apenas do **caminho do arquivo do banco**:
- Botão "Procurar…" ao lado abre o diálogo de arquivos do sistema
- Permite escolher um nome de arquivo inexistente (cria novo banco)
- Vazio → modo em memória `:memory:` (perdido ao fechar a aplicação)

#### ClickHouse

| Campo | Descrição |
|---|---|
| URL | URL completa (`https://user:pass@host:8443/...`); ignora host/port se preenchida |
| Show System Databases | Por padrão, esconde os bancos `system` / `information_schema` |

#### Redis

Apenas host/port/password/dbIndex. O SkylerX expande automaticamente os 16 bancos lógicos (db0..db15).

#### H2

Apenas modo **PG-server**. O H2 deve ser iniciado com o parâmetro `-pg`:

```bash
java -cp h2-2.x.x.jar org.h2.tools.Server \
  -pg -pgPort 5435 -ifNotExists -baseDir ./data
```

Depois conecte: Host=localhost, Port=5435, User=`sa`, Password=vazio.

## SSH tunnel

O banco está atrás de um jump host? Vá para a **aba SSH** → habilite SSH tunnel:

- Host SSH / porta / usuário
- Autenticação: **senha** ou **chave privada** (`~/.ssh/id_rsa` ou similar), uma das duas
- Passphrase da chave privada (se criptografada)

O SkylerX abre o túnel SSH automaticamente e conecta ao banco através dele.

## SSL / TLS

Vá para a **aba SSL** → habilite SSL:

- Validar certificado do servidor?
- CA / certificado / chave (cole o texto PEM ou escolha arquivo)

## Modo Manual Commit

`Settings → Modo de commit padrão global` ou **por conexão → Avançado → Modo de commit**:

- `auto` (padrão): cada SQL é commitado imediatamente
- `manual`: o usuário deve clicar explicitamente em "Commit / Rollback"; o SkylerX mantém uma conexão longa para preservar a transação

Ideal para correção de dados / migrações críticas. **Recomendado fortemente manual para conexões de produção**.

## Testar conexão

Botão "Testar conexão" no rodapé do formulário → feedback em tempo real:
- ✅ Sucesso + exibe versão do servidor + latência de round-trip
- ❌ Falha + código de erro + classificação automática ("conexão recusada" / "DNS" / "timeout" / "autenticação" / "SSL" etc.) + passos de troubleshooting

No popup de falha, clique em **"✨ Perguntar à IA"** → envia automaticamente o erro + metadados da conexão para o assistente de IA.

## Proteção de produção (`env=prod`)

Conexões marcadas como prod ganham proteções extras:

- Raiz da árvore exibe badge vermelha `[prod]`
- Ao executar `DROP TABLE / DATABASE / INDEX` / `TRUNCATE` / `UPDATE/DELETE` sem WHERE, **exige digitar o nome da conexão** para prosseguir
- A IA é mais conservadora em prod (estilo SELECT-only por padrão)

A determinação do ambiente é **puramente local na config** e não afeta o banco em si.

## Armazenamento criptografado de senhas

Senhas são criptografadas via chaveiro do SO:

- **macOS**: Keychain Access
- **Windows**: DPAPI (baseado no login atual do usuário)
- **Linux**: Secret Service (GNOME Keyring / KWallet)

Se o chaveiro não estiver disponível, há fallback para base64 (claramente marcado com o prefixo `plain:`, **alertando que não é seguro**). **Em produção, garanta** que o chaveiro está disponível.

## Gerenciamento por grupo

Cada conexão pode ser anexada a um **grupo** (opcional); a árvore agrupa por dobramento:

```
📁 Ambiente de desenvolvimento
   ├── MySQL local
   └── PostgreSQL local
📁 Ambiente de teste
   └── OceanBase teste
📁 Ambiente de produção  ⚠
   └── prod-mysql [prod]
```

Ao adicionar uma conexão, preencha o nome no campo "Grupo" (Enter confirma).

## Múltiplas janelas (consultar conexões em paralelo)

⌘⇧N / Ctrl+Shift+N abre uma nova janela SPA → carrega o mesmo banco de configurações; as duas janelas conectam separadamente e não interferem.

Ideal para o cenário "prod à esquerda, staging à direita para comparar".

## Apagar conexão

Clique direito na conexão → Excluir → confirmação dupla → registro removido do SQLite + limpeza sincronizada do Keychain.

**O banco em si não é afetado**; a exclusão apenas remove a config da conexão no SkylerX.
