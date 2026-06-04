---
title: Roteiro
description: Próximos bancos de dados e planos de funcionalidades do SkylerX, atualizados a cada trimestre.
---

# Roteiro

> Última atualização: 2026-06-04
> Plano direcional — não é um compromisso. A cadência real depende de feedback e recursos.
> Fonte completa: [ROADMAP.md no GitHub](https://github.com/duhbbx/SkylerX/blob/main/ROADMAP.md)

Quer impulsionar algo?

- 👍 vote na [issue](https://github.com/duhbbx/SkylerX/issues) correspondente
- Registre uma nova solicitação: [Nova Issue de Funcionalidade](https://github.com/duhbbx/SkylerX/issues/new/choose)
- Discuta arquitetura: [Discussions](https://github.com/duhbbx/SkylerX/discussions)

## Legenda

- ✅ Publicado
- 🟢 Em andamento / este trimestre
- 🔵 Próximo trimestre
- ⚪ Candidato — a prioridade muda conforme o feedback
- 🟣 Longo prazo / requer mudança de arquitetura

---

## 1. Suporte a bancos de dados

### 1.1 Já suportados (em 2026-05)

| Categoria | Drivers |
|---|---|
| **Relacional (código aberto)** | MySQL · MariaDB · PostgreSQL · SQLite · H2 |
| **Relacional (comercial)** | Oracle · SQL Server |
| **Chineses / 信创** | DM (达梦) · KingbaseES (人大金仓) · OceanBase · TiDB · GBase |
| **Analíticos (MPP/OLAP)** | ClickHouse · Snowflake · Amazon Redshift · Apache Doris · StarRocks · DuckDB |
| **Séries temporais** | TDengine |
| **NoSQL** | MongoDB · Redis · Elasticsearch |

### 1.2 Plano de integração

#### 🟢 2026 T3 (jul–set)

| Banco de dados | Tipo | Observações |
|---|---|---|
| **PolarDB-PG / -X** | Nativo de nuvem | Reutiliza o driver existente |
| **GaussDB (Huawei)** | 信创 | Modo compatível com PG |
| **TimescaleDB** | Séries temporais (ext. PG) | Hypertable / agregações contínuas |
| **Cassandra / ScyllaDB** | NoSQL wide-column | CQL sobre o canal SQL |
| **InfluxDB 3.x** | Séries temporais | FlightSQL |

#### 🔵 2026 T4 (out–dez)

| Banco de dados | Tipo | Observações |
|---|---|---|
| **Trino / Presto** | SQL federado | API HTTP, a árvore de catálogos mapeia as subfontes |
| **Apache Hive (HS2)** | SQL para big data | JDBC sobre Kerberos / LDAP |
| **Neo4j** | Grafo | Bolt + Cypher, novo canal |
| **Couchbase** | NoSQL multimodelo | N1QL |
| **AWS DynamoDB** | KV / documento | PartiQL, canal NoSQL |
| **pgvector / Milvus / Qdrant** | Vetorial | Visualizador dedicado de campos vetoriais |

#### ⚪ Candidatos 2027 S1

Apache IoTDB · Nebula Graph · SequoiaDB · GreatSQL · Hologres (Aliyun PG) · Lindorm (Aliyun HBase) · TDSQL-C (Tencent) · QuestDB · Apache Druid · Apache Pinot · Flink SQL Gateway · Materialize · RisingWave · Vertica · BigQuery · Athena

#### 🟣 Longo prazo (depende da demanda)

Apache HBase · Impala · DynamoDB Streams · Cassandra CDC · visualizadores LMDB / RocksDB · Weaviate / Chroma · ArangoDB (multimodelo)

---

## 2. Roteiro de funcionalidades

### 2.1 Editor e UX de consultas

| Status | Funcionalidade |
|---|---|
| ✅ | Linter SQL + autocompletar inline com IA |
| ✅ | Histórico de consultas com tags + fixação |
| ✅ | **Modo Notebook** — SQL / Markdown multicélula, persistido localmente; estilo Jupyter |
| 🟢 | **Visual Query Builder** — arrastar para fazer join, JOIN automático, agregação por GUI |
| 🔵 | **Speech-to-SQL** — Whisper offline → tradução por IA |
| 🔵 | **Tradutor de SP entre dialetos** — Oracle PL/SQL ↔ PG PL/pgSQL ↔ DM |
| ✅ | **Editor de regras de linter personalizadas** — padrões proibidos / regras de estilo definidos pelo usuário (correspondência por regex + nível de severidade) |
| ⚪ | Biblioteca de snippets + sincronização entre dispositivos |

### 2.2 UX da grade de resultados

| Status | Funcionalidade |
|---|---|
| ✅ | Edição inline + commit DML, "Perguntar à IA" em erros, visualizador de células |
| ✅ | **Diff de resultados de consulta** — compara dois conjuntos de resultados por linha / célula, marcando o que foi adicionado / removido / alterado |
| ✅ | **Mascaramento na exportação** — quando o mascaramento está ativado, copiar / exportar (CSV/JSON/SQL/…) mascara colunas inteiras conforme as regras, de forma consistente com a grade — chega de "mostra mascarado, exporta em texto puro" |
| 🟢 | **Visão Form** — editor vertical de linha única para tabelas largas |
| 🟢 | **Filtro multivalor estilo Excel** |
| 🔵 | **Vínculo Master/Detail** — selecione uma linha, carregue automaticamente as tabelas relacionadas |
| 🔵 | **Dropdown de busca de FK** ao editar colunas de FK |
| ⚪ | Expansão ao vivo de colunas por JOIN · Pivot · visualizador em árvore de colunas JSON |

### 2.3 Esquema e modelagem

| Status | Funcionalidade |
|---|---|
| ✅ | Geração de DDL · Diff de esquema · Mock data v1 |
| ✅ | Assistente de migração Oracle → DM |
| ✅ | **Avaliação de migração** — perfilamento da origem (17 categorias de objetos + métricas de risco) + classificação A/B/C/D + conversão de PL/SQL com IA + exportação para Word/PDF/Excel; design de IR hub-and-spoke |
| ✅ | **Layout automático de diagrama ER** — engenharia reversa a partir do esquema ativo, vínculos automáticos por chave estrangeira (filho → pai), tamanho do nó conforme o número de colunas, tabelas com PK destacadas, foco em uma tabela + vizinhos, exportação PNG / SVG |
| 🔵 | **Engenharia direta** — edite o diagrama ER → gere a migração |
| ✅ | **Migração entre bancos v2** — IR hub-and-spoke: faz parsing de MySQL/Oracle/DM/SQL Server → gera PG/Oracle/DM/MySQL com tipos / índices / views / FKs completos; migração de dados (parametrizada em blocos + incremental + validação) |
| ✅ | **Grafo de linhagem de dados** — faz parsing de SQL → linhagem em nível de tabela (nível de coluna no roteiro) |
| ⚪ | Integração com dbt · Linhagem em nível de coluna |

### 2.4 DBA / operações

| Status | Funcionalidade |
|---|---|
| ✅ | Visualizador de EXPLAIN · sparklines de consultas lentas · Health check v1 |
| ✅ | **Eliminador de consultas de longa duração** — lista de processos/sessões entre dialetos (MySQL `information_schema.PROCESSLIST` / PG `pg_stat_activity` / MSSQL `sys.dm_exec_requests` / Oracle `v$session`); KILL por linha com confirmação `KILL` digitada em conexões de produção |
| 🟢 | **Detecção de índices mortos** + estatísticas de tamanho |
| 🟢 | **Consulta lenta → reescrita automática + sugestão de índice** |
| 🔵 | Dashboard de atraso de replicação |
| ✅ | **Previsão de tendência de crescimento de armazenamento** — captura snapshots dos tamanhos de bancos/tabelas, ajusta a curva de capacidade de 7/30/90 dias + alerta de limite |
| ⚪ | Ajuste de pool de conexões · Log de auditoria assinado · Agendador de backups |

### 2.5 IA

| Status | Funcionalidade |
|---|---|
| ✅ | Chat com IA · Perguntar à IA em erros · Mock data v1 · Health check v1 |
| 🟢 | **Mock data v2** — ciente de FK entre tabelas + campos semânticos (nomes, endereços, telefones) |
| 🟢 | **Health check v2** — biblioteca de antipadrões expandida para mais de 50 verificações |
| 🔵 | **Autocompletar em streaming (estilo Cursor)** — sugestões à medida que você digita |
| ✅ | **RAG sobre esquema + documentação** — esquema (tabelas / views / funções) + documentação fragmentados → vetor (compatível com OpenAI /v1/embeddings) + recuperação híbrida BM25 (fusão RRF) + piso de relevância; injeta apenas as tabelas relevantes no contexto da IA; fallback léxico gracioso quando não há embeddings |
| ⚪ | Regras de mascaramento sugeridas por IA · SQL → diagrama ER |

### 2.6 Colaboração / multidispositivo

| Status | Funcionalidade |
|---|---|
| ✅ | Multijanela · i18n em 7 idiomas |
| 🔵 | **Sincronização de conexões com criptografia E2E** — entre dispositivos, criptografada em repouso |
| 🔵 | **Biblioteca de consultas da equipe** — somente leitura / comentário / fork |
| ⚪ | Edição web · Visualizador móvel somente leitura |
| 🟣 | Consulta em par em tempo real (protocolo Yjs) |

### 2.7 Integrações e exportação

| Status | Funcionalidade |
|---|---|
| ✅ | Exportação para CSV / Excel / JSON / SQL / Parquet / Markdown |
| ✅ | **Visualizador de gráficos (ECharts)** — um clique a partir da grade de resultados: linha / barra / pizza / dispersão; detecta automaticamente colunas numéricas para Y, não numéricas para X; suporta zoom + múltiplas séries; renderização na thread principal de até 5000 linhas |
| 🔵 | **Predefinições de gráficos / dashboards** — salve "esta consulta → este gráfico" para reutilização |
| 🔵 | **Exportação para BI** — fontes de dados Metabase / Superset / PowerBI / Tableau |
| ⚪ | Endpoints mock REST / GraphQL |

### 2.8 Plugins / extensibilidade

| Status | Funcionalidade |
|---|---|
| 🔵 | **API de plugins de drivers de terceiros** |
| ⚪ | Plugins de formato de exportação / plugins de tema |

### 2.9 Árvore de navegação / navegação do workspace

A NavTree é o ponto de entrada para 95% do trabalho diário — uma onda de melhorias que acabou de chegar:

| Status | Funcionalidade |
|---|---|
| ✅ | **Seleção múltipla + operações em lote** — Ctrl/⌘+clique / Shift+intervalo; DROP / TRUNCATE / mover para grupo / copiar template SELECT / exportar DDL / testar conexões em paralelo; o SQL em lote usa multi-alvo nativo onde suportado (PG `DROP TABLE a, b, c`) ou execução sequencial com fail-fast nos demais (Oracle/DM/SQLite). Refs #25 |
| ✅ | **Arrastar para redimensionar a largura** — 200-600px, duplo clique reseta, persistido nas configurações. Refs #17 |
| ✅ | **Filtro de BD/Schema visível por conexão** — chip N/M estilo DataGrip ao lado do nome da conexão; a v2 suporta filtro de schema por banco (cenário PG com 50 schemas em um único BD). Refs #24 |
| ✅ | **Busca local na árvore (Ctrl/⌘+F)** — filtro ao vivo sobre os nós carregados, expansão forçada de ramos com correspondências |
| ✅ | **Índice completo de objetos do catálogo + busca entre árvores** — cache plano do catálogo por conexão (~5MB / 100 mil objetos / varredura de 10ms); construção silenciosa em segundo plano na primeira busca; correspondências exibidas acima da árvore; cobre tabelas / views / funções / procedures / sequences / triggers / índices; filtragem por pílula de tipo |
| ✅ | **Clique para vincular chaves do Redis** — um clique em uma chave Redis na navegação foca a aba RedisPane correspondente e seleciona a chave; não abre uma nova aba. Refs #19 |
| ✅ | **Completude de tipos de objeto entre dialetos** — Oracle/DM (incl. correção do object_type `CLASS` do DM para tipos), Vastbase/openGauss + toda a família PG (views materializadas / procedures / tipos; openGauss também packages / synonyms), SQL Server (funções / procedures / triggers / sequences / tipos / synonyms) |
| ✅ | **Excluir BDs/schemas de sistema com um clique** — na configuração de BDs/schemas visíveis, um clique desmarca os BDs/schemas de sistema (mysql / pg_catalog / SYS / SYSAUDITOR …), sem tocar nos objetos do usuário; dialetos de nível único (MySQL etc.) deixam de exibir um dropdown de schema inútil |
| ✅ | **Copiar informações de conexão** — clique direito em uma conexão → submenu "Copiar informações de conexão": URL JDBC / JSON / multilinha / linha única (;) — nunca inclui a senha |
| ✅ | **Mover para grupo (combobox)** — mover em lote para grupo: escolha um grupo existente no dropdown ou digite um novo nome (com trim, criado se ausente); vazio = remover do grupo |
| 🟢 | **Localizador global de objetos Cmd+Shift+P** — modal fuzzy entre conexões, complementa a busca na árvore |
| 🔵 | **Persistir índice no IndexedDB** — resultados em milissegundos no início a frio (com marcador de obsolescência) |
| 🔵 | **revealObject para todos os tipos** — atualmente revela tabelas/views na árvore; expandir para funções / procedures / sequences |
| ⚪ | **Operações em lote entre conexões selecionadas** — ex.: relatório noturno em todas as conexões com a tag `prod` |

---

## 3. Plataforma / engenharia

| Status | Item |
|---|---|
| ✅ | Matriz de build multiarquitetura (macOS arm/x64 · Windows · Linux) |
| ✅ | Espelho Aliyun OSS + alternador automático de canal de atualização |
| 🟢 | **Assinatura de código** — Apple Developer + Windows (via SignPath OSS) |
| 🟢 | **Relatório de falhas** — Sentry auto-hospedado com source maps |
| 🔵 | Playwright E2E + matriz de CI |
| 🔵 | Integração com Codecov |
| ⚪ | AppImage / Snap / Flatpak / MS Store / MAS / tap do Homebrew |

---

## 4. Documentação / comunidade

| Status | Item |
|---|---|
| ✅ | Site em 7 idiomas + SEO + Umami auto-hospedado |
| ✅ | Documentação de DBA / Schema / NoSQL / Segurança / IA / Produtividade |
| 🟢 | **Tutoriais em vídeo** (Bilibili + YouTube, < 3 min por funcionalidade central) |
| 🔵 | Estudos de caso / Site público de changelog |

---

## Marcos

| Data | Destaque |
|---|---|
| 2026-06 | RAG sobre esquema (híbrido vetor + BM25) · diagrama ER + exportação PNG/SVG · diff de resultados de consulta · mascaramento na exportação · completude de tipos de objeto na navegação entre dialetos · verificação ao vivo do leitor entre dialetos (DM/Oracle/MySQL/Vastbase) |
| 2026-05 | Configurações de IA → SQLite criptografado · SEO em 7 idiomas · Umami auto-hospedado |
| 2026-04 | Onda de drivers ClickHouse / Snowflake / Doris / StarRocks / Redshift / H2 |
| 2026-03 | Canal NoSQL (MongoDB / Redis / Elasticsearch) · Linter SQL · IA inline |
| 2026-02 | Visualizador de EXPLAIN · sparklines de consultas lentas · assistente Oracle → DM |
| 2026-01 | Primeiro lançamento público (MySQL / PG / Oracle / SQL Server / DM / KingbaseES) |

---

## Quer contribuir?

- Veja [CONTRIBUTING.md](https://github.com/duhbbx/SkylerX/blob/main/CONTRIBUTING.md) para configuração, testes e regras de PR
- Novos drivers: copie qualquer `packages/core-driver/src/drivers/*` como template
- O próprio roteiro está em [ROADMAP.md](https://github.com/duhbbx/SkylerX/blob/main/ROADMAP.md) — PRs são bem-vindos
