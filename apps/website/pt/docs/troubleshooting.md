# Troubleshooting e compatibilidade

## Problemas comuns de conexão

### `ECONNREFUSED` — conexão recusada

- O processo do banco não está rodando / porta errada
- Verifique: `nc -zv <host> <port>` ou `telnet`
- Containers Docker: `docker ps` para ver se está Up e se o mapeamento de portas está correto

### `ETIMEDOUT` — timeout

- Firewall / security group / VPN bloqueando
- Cenário SSH tunnel: jump host inacessível

### `Authentication failed` — falha de autenticação

- Usuário / senha incorretos
- Compatibilidade `caching_sha2_password` do MySQL — atualize mysql2 ou mude para `mysql_native_password`
- `pg_hba.conf` do PG não permite a origem

### Oracle `ORA-12541: TNS:no listener`

- Container Oracle ainda não iniciou completamente ou LISTENER não registrado
- Aguarde 1-2 minutos e tente novamente
- Verifique se o service name está correto (padrão XEPDB1, `gvenzl/oracle-free` usa FREEPDB1)

### Oracle `ORA-00900: invalid SQL statement near 'v'` (conectando ao OceanBase)

- Este é o sinal característico do **tenant OceanBase Oracle** — a função `VERSION()` não existe no modo Oracle
- SkylerX v0.5+ já corrigido (usa `SELECT 1 FROM DUAL` como healthcheck)
- Versões antigas: atualize para a mais recente

### Oracle `ORA-01950: insufficient quota on tablespace USERS`

Usuários Oracle recém-criados sem quota falham ao inserir / criar tabelas. **Correção**:

```sql
-- Execute com conexão SYSDBA
ALTER USER "your_username" QUOTA UNLIMITED ON USERS;
-- Ou mais radicalmente
GRANT UNLIMITED TABLESPACE TO "your_username";
```

> ⚠️ Oracle converte por padrão identificadores não-quoted para maiúsculas; se o nome do usuário foi criado entre aspas duplas e em minúsculas (`"test"`), os ALTERs subsequentes também precisam das aspas e do case original.

### MongoDB ObjectId não pode ser editado

- Editar o campo `_id` na grade falha — após serialização IPC, ObjectId vira string e o driver não faz wrap automático
- SkylerX v0.5+ já corrigido: o driver detecta automaticamente strings 24-hex em `_id` e faz wrap para ObjectId
- Versões antigas: para coleções com PK ObjectId real, use mongosh temporariamente

## Tabela rápida de códigos de erro

### MySQL / MariaDB / TiDB / Doris / StarRocks

| errno | Significado | Causa comum |
|---|---|---|
| 1045 | Access denied | Usuário / senha errados |
| 1049 | Unknown database | Banco não existe |
| 1054 | Unknown column | Nome de coluna errado |
| 1062 | Duplicate entry | Violação de índice único |
| 1064 | SQL syntax error | Erro de sintaxe |
| 1146 | Table doesn't exist | Tabela não existe / banco errado |
| 1213 | Deadlock | Deadlock, repita a operação |
| 1264 | Out of range value | Tipo da coluna não comporta o valor |
| 2002 | Can't connect via socket | Host / porta errados |
| 2003 | Can't connect to MySQL server | Conexão recusada |
| 2013 | Lost connection during query | Servidor caiu / timeout |

### PostgreSQL / dialetos compatíveis (KingbaseES / openGauss / CockroachDB / Greenplum / Redshift / H2)

SQLSTATE de 5 dígitos:

| code | Significado |
|---|---|
| 23505 | unique violation |
| 23502 | not null violation |
| 23503 | foreign key violation |
| 42P01 | undefined table |
| 42703 | undefined column |
| 42601 | syntax error |
| 28000 | invalid authorization |
| 08001 | unable to connect |
| 40001 | serialization failure (repita) |
| 53300 | too many connections |

### Oracle / tenant OB Oracle / DM 达梦

Série ORA-xxxxx:

| code | Significado |
|---|---|
| 00900 | invalid SQL statement |
| 00904 | invalid identifier |
| 00911 | invalid character |
| 00942 | table or view does not exist |
| 01017 | invalid username/password |
| 01950 | no privileges on tablespace |
| 12541 | TNS no listener |
| 12514 | service not found |
| 28000 | account locked |

## Performance lenta

### Grandes resultados travando

- Tamanho de página padrão grande demais? Reduza para 200-500 linhas, a rolagem virtual será ativada automaticamente
- Colunas demais? Esconda as desnecessárias (clique direito no cabeçalho da coluna → Esconder)

### Latência de rede alta

- Conexão remota lenta: use SSH tunnel com compressão / aproxime o jump host
- IA lenta: troque para um provider em região mais próxima (deepseek.com é rápido na China)

### SkylerX inicia devagar

- Verifique `Settings → Inicialização` → desmarque "verificar atualizações automaticamente"
- macOS: `xattr -d com.apple.quarantine /Applications/SkylerX.app` para remover o atributo de quarentena

## Segurança / privacidade de dados

- Senhas criptografadas — via chaveiro do SO (macOS Keychain / Win DPAPI / Linux Secret Service)
- IA por padrão **não envia dados**, apenas schema hint
- Todas as conexões / histórico SQL / snippets / settings ficam em SQLite local
- Nenhuma estatística / telemetria é enviada

## Problemas comuns de atualização

### Atualização automática falhou

- Problema de rede: baixe a nova versão manualmente em [Releases](https://github.com/duhbbx/SkylerX/releases)
- Problema de permissão: macOS sem permissão de escrita, reinstale como administrador

### Conexões / configurações perdidas após atualização

**Não deveria acontecer**. O SQLite local é compatível entre versões. Se ocorrer, **não delete o diretório de dados da versão antiga**; primeiro [abra uma issue](https://github.com/duhbbx/SkylerX/issues) — normalmente é um problema de migração de path.

## Reportar bug

Se nenhuma das opções acima resolver:

1. Em qualquer popup de erro da aplicação, clique em "**✨ Perguntar à IA**" para ver se a IA localiza o problema
2. Ainda não resolveu → [GitHub Issues](https://github.com/duhbbx/SkylerX/issues/new)
3. Inclua na issue:
   - Versão do SkylerX (`Help → About`)
   - Sistema operacional + versão
   - Tipo de banco de dados + versão
   - Passos para reproduzir
   - Mensagem de erro completa

## Parceria empresarial / implantação privada

- Adaptação profunda para ambientes 信创 (龙芯 / 飞腾 / 鲲鹏)
- Implantação com Criptografia nacional chinesa SM2/SM3/SM4 / Conformidade GB17859 (segurança nível 2.0 da China)
- Consultoria em migração de banco de dados (Oracle → 达梦 / KingbaseES)
- Versão customizada para rede interna

Contato: `duhbbx@gmail.com` · WeChat `tuhoooo`
