# Início rápido

5 minutos, do download à primeira consulta bem-sucedida.

## 1. Baixar e instalar

Vá para a [página de download](/pt/download) e escolha o instalador da sua plataforma:

- **macOS**: arquivo `.dmg`, arraste para Applications
- **Windows**: assistente `.exe`, siga clicando em Next
- **Linux**: `.AppImage` (sem instalação, `chmod +x` e execute) ou `.deb` / `.rpm` (`sudo dpkg -i` / `sudo rpm -ivh`)

Na primeira inicialização, o banco de configuração local é criado automaticamente (SQLite, no diretório padrão de dados do usuário do SO).

## 2. Criar a primeira conexão

Inicie a aplicação → canto superior esquerdo "Nova conexão" (⌘N / Ctrl+N) → escolha o dialeto.

### MySQL / PostgreSQL e outros dialetos comuns

| Campo | Exemplo |
|---|---|
| Nome da conexão | Banco local de dev |
| Dialeto | MySQL |
| Host | 127.0.0.1 |
| Porta | 3306 (padrão MySQL) |
| Usuário | root |
| Senha | (sua senha) |
| Banco | (opcional; vazio = escolhe após conectar) |
| Marcador de ambiente | dev / test / prod |

Clique em "Testar conexão" → após sucesso, clique em "Salvar".

### Oracle / tenant OB Oracle

Oracle precisa de Service Name (padrão `XEPDB1`, container `gvenzl/oracle-free` usa `FREEPDB1`):

| Campo | Exemplo |
|---|---|
| Dialeto | Oracle |
| Host | 127.0.0.1 |
| Porta | 1521 |
| Usuário | system |
| Senha | oracle |
| Database / Service | FREEPDB1 |
| Avançado → privilege | (vazio = normal) ou SYSDBA / SYSOPER etc. |

### Bancos de dados chineses (信创)

- **达梦 DM**: porta 5236, requer pacote npm `dmdb` (`pnpm -F @db-tool/desktop add dmdb`)
- **KingbaseES**: porta 54321 (padrão), via compatibilidade PG, sem driver adicional
- **openGauss**: via compatibilidade PG, sem driver adicional
- **OceanBase**: porta 2881, via mysql2 — tenant Oracle também usa este dialeto

Detalhes dos campos em [Gerenciamento de conexões →](/pt/docs/connections)

## 3. Navegar pela árvore

Na lista de conexões, **duplo clique** → árvore de navegação à esquerda se expande:

```
📦 Banco local de dev (MySQL)
  └── 📁 mydb
       ├── 📁 Tabelas (12)
       │    ├── users
       │    ├── orders
       │    └── ...
       ├── 📁 Views (3)
       ├── 📁 Funções (1)
       └── 📁 Procedures (0)
```

**Duplo clique na tabela** → abre a grade de dados por padrão (SELECT primeiras 200 linhas, ajustável em [Settings → tamanho de página padrão]).

## 4. Escrever e executar SQL

- Clique em "Nova consulta" na toolbar ou ⌘T / Ctrl+T para abrir uma nova aba SQL
- O editor Monaco autocompleta nomes de tabelas / colunas / palavras-chave
- ⌘+Enter / Ctrl+Enter para executar (executa apenas a seleção se houver)
- O resultado aparece na grade abaixo

### Alguns atalhos comuns

| Ação | macOS | Windows / Linux |
|---|---|---|
| Paleta de comandos | ⌘K | Ctrl+K |
| Busca global de objetos | ⌘⇧O | Ctrl+Shift+O |
| Executar SQL | ⌘+Enter | Ctrl+Enter |
| Formatar SQL | ⌘⇧F | Ctrl+Shift+F |
| Alternar painel de chat IA | ⌘⇧L | Ctrl+Shift+L |
| Nova janela (segunda sessão) | ⌘⇧N | Ctrl+Shift+N |

Todos os atalhos são customizáveis em `Settings → Atalhos de teclado`.

## 5. Configurar o assistente de IA (opcional)

`Settings → AI Provider` → adicione qualquer provider suportado:

- Anthropic (família Claude)
- OpenAI (família GPT-4 / o1)
- DeepSeek
- Codex
- Grok / xAI

Após informar a API Key, você pode usar:
- Painel de chat à direita (alternar com ⌘⇧L)
- Autocompletar inline no editor (estilo Copilot)
- Qualquer popup de erro tem um botão "✨ Perguntar à IA" para diagnóstico automático
- 7 Toolboxes profissionais (escrever migração / tuning / interpretar EXPLAIN / gerar dados de teste / linguagem natural → SQL / escrever comentários / interpretar uso da tabela)

## 6. Recursos avançados

- [Editor SQL aprofundado](/pt/docs/query) — autocompletar / biblioteca de snippets / EXPLAIN
- [Grade de resultados](/pt/docs/grid) — modo edição / filtros / coloração / exportação
- [Assistente de IA](/pt/docs/ai) — configuração de providers / sistema de memória / Toolboxes em detalhes
- [Troubleshooting e compatibilidade](/pt/docs/troubleshooting) — diagnóstico automático de erros comuns ORA-xxx / SQLSTATE

## Com problemas?

- Em qualquer popup de erro, clique em "**✨ Perguntar à IA**" — envia automaticamente SQL + erro + metadados da conexão à IA
- Ainda não resolveu: [GitHub Issues](https://github.com/duhbbx/SkylerX/issues)
