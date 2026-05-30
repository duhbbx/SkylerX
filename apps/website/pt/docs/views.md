# Visualizações alternativas do resultado

Ao executar SQL, o resultado padrão é a grade (veja [Grade de resultados](./grid.md)). Mas muitas vezes a grade não é a melhor visualização — para cem linhas de `(month, revenue)`, um gráfico de linhas é dez mil vezes mais intuitivo que a tabela. O SkylerX disponibiliza um conjunto de **visualizações alternativas** na toolbar de resultados: os dados não são re-executados, apenas mostrados em outra forma na memória.

Esta página explica: **quando trocar de visualização, como cada uma é calculada, o formato de dados esperado e o que se pode exportar**.

## Quando trocar de visualização

| Forma dos dados | Visualização recomendada | Cenário típico |
|---|---|---|
| Uma coluna categórica + uma numérica | Barra / Pizza / Donut | Vendas por cidade, erros por endpoint |
| Uma coluna de tempo + uma numérica (contínua) | Linha / Área | Tendência DAU, uso de CPU |
| Duas colunas numéricas (correlação) | Scatter | Atividade vs retenção |
| Três colunas categóricas / numéricas | Pivot | Canal × Mês = Receita |
| Duas colunas `(lat, lng)` | Scatter geográfico | Distribuição de lojas, mapa de usuários |
| Uma coluna de tempo + um label | Linha do tempo | Deploys, ciclo de vida do pedido |
| `(id, parent_id, ...)` | Árvore FK auto-referenciada | Threads de comentário, departamentos |
| Histórico de uma mesma linha | Histórico de linha | Auditoria |

Acionamento no rodapé (`packages/ui/src/components/ResultGrid.vue:1202-1215`):

```vue
<button :disabled="!result?.rows.length" @click="chartOpen = true">📊 Gráficos</button>
<div class="menu-box">
  <button @click="showViewMenu = !showViewMenu">📐 Vistas</button>
  <!-- menu -->
  <button @click="altView = 'pivot'">⊞ Pivot</button>
  <button @click="altView = 'tree'">🌳 Árvore</button>
  <button @click="altView = 'geo'">🗺 Geográfico</button>
  <button @click="altView = 'timeline'">⏱ Linha do tempo</button>
</div>
```

Todas em modal; ao fechar, volta à grade — são "lupas" sobre a grade, não a substituem.

## 1. Gráficos (barra / linha / pizza + 4 extras)

`packages/ui/src/components/ChartDialog.vue`, **630 linhas**, botão: **📊 Gráficos**.

### Decisões de design

Comentários do código explicam:

> Sem ECharts, SVG feito à mão (barra / linha + pizza, cem linhas cada), motivos:
> - app desktop sensível a tamanho; gráfico é "ferramenta" da grade, não palco principal
> - 3 tipos cobrem 90% dos casos; ECharts pode entrar depois
> - SVG é fácil de exportar PNG (toDataURL via `<canvas>`)

7 tipos, todos SVG manual:

| Gráfico | Aplica a | Limite | Notas |
|---|---|---|---|
| 📊 Barra | Comparação categórica | 50 linhas | Eixo Y auto-arredondado |
| 📈 Linha | Tendência / série temporal | 200 linhas | Path `M / L` |
| 🥧 Pizza | Proporção | 50 linhas | Marca percentual auto |
| ⛰ Área | Tendência + magnitude | 200 linhas | Linha fechada na baseline |
| ·· Scatter | Pontos discretos | 200 linhas | Círculos |
| ⭕ Donut | Proporção | 50 linhas | Externo `r * 1.0`, interno `r * 0.55` |
| 📡 Radar | Comparação multi-dimensão | 50 linhas, ≥3 pontos | Um eixo por linha |

### Seleção de colunas

Três seletores no topo: **Label** (qualquer coluna, `.toString()`), **Value** (coluna numérica detectada; não-numéricas exibem `(?)` no nome), **tipo**. `isNumericColumn` analisa 20 linhas com `Number.isFinite(Number(v))`; Y = primeira numérica. `watch` reseta a seleção quando o result muda.

Regra: `Number(v)` NaN → pula a linha; acima do limite, primeiras N (barra/pizza 50, linha/área/scatter 200, radar 50).

### Eixo Y

Para deixar o tick visualmente "redondo", o topo usa `Math.ceil(m / 10^floor(log10(m))) * 10^floor(log10(m))`. Format de ticks: `B / M / k` para > 1e9 / 1e6 / 1e4.

### Saída: exportar PNG

À direita: `⬇ Exportar PNG` → `XMLSerializer` no SVG → `<canvas>` 2× HiDPI (fundo escuro `#1d1e22`) → `canvas.toBlob('image/png')` → `SaveFileDialog`. Nome: `chart-{kind}-{ts}.png`, 1440×720, perfeito para Lark / Slack.

## 2. Pivot (PivotDialog)

`packages/ui/src/components/PivotDialog.vue`, 162 linhas. **📐 Vistas → ⊞ Pivot**.

Faz **pivot na memória** do resultado atual; não re-executa SQL. Algoritmo simples — linhas agrupadas por `(rowFields...)` → buckets por `colField` → agregação no bucket.

### Três eixos + função

| Controle | Comportamento |
|---|---|
| **Linhas** (chips multi-seleção) | Agrupa por essas colunas; key concatenada por `'\|'` |
| **Colunas** (dropdown) | Valores distintos dessa coluna viram colunas (ordem lexicográfica) |
| **Valor** + agregação | Para cada (row, col), agrega a coluna value |
| Dropdown de agregação | `COUNT / SUM / AVG / MIN / MAX` |

### Algoritmo

`Map<rowKey, Map<colKey, number[]>>` aninhado: percorre `result.rows`, `rowKey` = strings das `rowFields` com `|`, `colKey` = string do `colField`, `Number(row[valueField])` entra. `NULL` vira literal `'NULL'`. COUNT usa `length`, demais agregam.

### Limitações

Comentários do código:

> Sem suporte: múltiplos value fields, ordem de coluna (pivot por ordem lex), filtros; próxima versão.

Para ordenar "meses 1-12 em vez de 10, 11, 12, 1, 2..." é preciso usar zero-pad no SQL (`'01' / '02' / ...`).

### Saída

Apenas tabela temporária; não exporta direto. Para persistir:

- Fechar pivot → clique direito → copiar CSV / Markdown → colar em Excel / Notion
- Reescrever em SQL: MySQL `GROUP BY x WITH ROLLUP` / PG `crosstab()`

## 3. Scatter geográfico (GeoMapDialog)

`packages/ui/src/components/GeoMapDialog.vue`, 138 linhas. **📐 Vistas → 🗺 Geo**.

Sem leaflet / sem mapa base, SVG plota direto `(lng, lat)`:

> Projeção: equidistante (Mercator distorce pouco; lat/lng direto é suficiente).
> Sem: mapa base (sem tiles), clustering (muitos pontos viram blob, mas zoom + drag resolvem).

### Reconhecimento automático

```ts
latCol = cols.find(c => /^(lat|latitude|y)$/i.test(c)) ?? cols[0]
lngCol = cols.find(c => /^(lng|lon|long|longitude|x)$/i.test(c)) ?? cols[1]
labelCol = cols.find(c => /^(name|title|label|id)$/i.test(c)) ?? ''
```

Filtros numéricos:

```ts
if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue
```

### Bounds automáticos

Não mapa-mundi; bounds = "envolve todos os pontos + 5%":

```ts
const dx = Math.max(0.001, (maxX - minX) * 0.05)
return { minX: minX - dx, maxX: maxX + dx, ... }
```

Os quatro cantos exibem coordenadas; hover no ponto mostra `lat=... lng=...`.

### Saída

Visual apenas; sem export PNG (próxima versão). Para persistir, exporte uma classificação + use Gráficos (scatter) + screenshot.

### Formato esperado

| Aliases | Exemplo |
|---|---|
| `lat`, `latitude`, `y` | `latitude FLOAT` |
| `lng`, `lon`, `long`, `longitude`, `x` | `lng DECIMAL(9,6)` |
| `name`, `title`, `label`, `id` (label opcional) | `store_name VARCHAR` |

Fora desses nomes, selecione manualmente — basta valor numérico dentro do range.

## 4. Linha do tempo (TimelineDialog)

`packages/ui/src/components/TimelineDialog.vue`, 171 linhas. **📐 Vistas → ⏱ Linha do tempo**.

### Detecção automática

```ts
timeCol = cols.find(c => /at$|_time$|date|time|created|updated/i.test(c)) ?? cols[0]
labelCol = cols.find(c => /^(name|title|label|id|user|action)$/i.test(c)) ?? ''
colorCol = ''   // opcional: colore por essa coluna
```

Acerta `created_at / updated_at / event_time / order_date / login_time` etc.

### Parse de tempo (`toMs`)

Quatro formatos:

```ts
function toMs(v: unknown): number | null {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000   // heurística ms ou s
  const ms = Date.parse(String(v))  // ISO / "YYYY-MM-DD HH:MM:SS"
  return Number.isNaN(ms) ? null : ms
}
```

> Abaixo de 1e12 (ano 2001) é interpretado como segundos Unix; acima, ms. Para o raro caso pré-1969, converta com `to_char(...)` no SQL.

### Renderização

Linha do tempo horizontal, pontos alternam acima/abaixo (`i % 2 === 0 ? -16 : +16`), eixo X com 5 ticks.

Com **color** definido, valores distintos usam paleta de 8 (`#7c6cff / #4caf50 / #e0a020 / #e04050 / #3aa1ff / #b48cff / #67c23a / #ff9966`); legenda no rodapé. Hover mostra `tempo · label`.

### Formato esperado

Mínimo uma coluna de tempo (Date / ISO / Unix s ou ms). Label / Color opcionais.

## 5. Árvore FK auto-referenciada (TreeViewDialog)

`packages/ui/src/components/TreeViewDialog.vue`, 130 linhas. **📐 Vistas → 🌳 Árvore**.

Ideal para **FK auto-referenciada** ou hierarquia: comentários (`comments.parent_id → comments.id`), departamentos, regiões.

### Três eixos

| Seletor | Regra |
|---|---|
| **id** | `/^id$/i` ou primeira coluna |
| **parent** | `/parent[_-]?id\|pid/i` ou vazio |
| **label** | `/^(name\|title\|label)$/i` ou fallback id |

### Algoritmo

Duas passagens: 1ª indexa por id (`byId: Map<id, node>`); 2ª anexa filhos ao pai. Pais ausentes (incluindo NULL) → raiz. `parent === self` é raiz (proteção contra `WHERE id=1 AND parent_id=1` espúrio).

### Detecção de ciclo

`walk(n, depth)` DFS com `Set<string>`; mesmo id duas vezes → `n.cycle = true` e para. Marca `⚠` amarelo; tooltip "ciclo". Comum em dados editados a mão.

### Renderização

Após flatten, indentação `depth * 18px`; `▸ <label> #<id>`. Hover do label exibe JSON completo via `title=`.

### Formato esperado

Mínimo id + parent; `SELECT id, parent_id, name FROM comments WHERE post_id = 1234` retorna toda a árvore.

## 6. Histórico de linha (RowHistoryDialog)

`packages/ui/src/components/RowHistoryDialog.vue`, 123 linhas.

Propósito: **versões de uma linha específica** — dado a PK de uma linha, encontra todas as versões em tabelas-sombra `audit / *_history / *_log`.

### Descoberta de tabela-sombra

`SELECT table_name FROM information_schema.tables WHERE table_name LIKE '{base}_%' OR table_name = 'audit_{base}' OR table_name = '{base}_history'` → preenche `<datalist>`.

### Consulta de versões

`SELECT * FROM {shadow} WHERE {pk}=... ORDER BY changed_at, updated_at, created_at, version, revision DESC LIMIT 200`. Cinco colunas candidatas no ORDER BY (MySQL tolera, PG estrito; audit costuma ter ao menos uma). Mini-tabela compacta com células de até 80 chars.

### Formato esperado

Tabela de negócio + tabela-sombra `*_history` / `*_audit` / `*_log` (PK + colunas + `changed_at / version`). Implementações triggered comuns satisfazem.

> Nota: o dialog está implementado (`Workspace.vue` tem `rowHistOpen` e mount), mas a entrada via menu de contexto da grade ainda não foi conectada — capacidade reservada.

## 7. Linhagem de dados (LineageDialog) — versão heurística

`packages/ui/src/components/LineageDialog.vue`, 98 linhas.

Comentários do código:

> Linhagem de coluna (heurística): sem parser SQL real, usa heurística simples — SQLs do histórico onde aparece "`{table}.{column}`" ou bare `{column}` (se SQL tem FROM `{table}`) são considerados relacionados.
> Precisão limitada: pode perder (aliases / subqueries) e ter falsos positivos (mesmo nome). Avisamos ao usuário que é "heurística"; quando SQL parser entrar, substituiremos.

### Algoritmo

Últimos 500 SQLs da conexão; cada um casado com `\b{table}\b` + `\b{column}\b` (word boundary). Hit → analisa início: `INSERT / UPDATE` → sinks (escrita), `SELECT / WITH` → sources (leitura).

### Render

Duas colunas:

- **← Sinks** — SQL que **escreve** nessa coluna (INSERT / UPDATE)
- **→ Sources** — SQL que **lê** dessa coluna (SELECT / WITH)

Cada linha: timestamp + 120 chars de SQL. Banner amarelo no topo: "heurístico, não é evidência de auditoria".

### Formato esperado

Depende do **histórico** (`client.connections.history`). Se nunca executou SQL relacionado no SkylerX, "No hits".

> Nota: assim como RowHistoryDialog, está em `Workspace.vue` esperando trigger (`lineageOpen.value = {...}`); sem entrada própria na UI por enquanto.

## Matriz de suporte

| Visualização | Detecção auto | Limite | Export estático | Re-execução SQL | Ideal para |
|---|---|---|---|---|---|
| Gráficos (7 tipos) | Coluna numérica | 50 / 200 linhas | PNG (2× HiDPI) | Não | Ver magnitude / tendência / proporção |
| Pivot | 1ª/2ª/3ª colunas | RAM do browser | Copiar como CSV | Não | Agregação de dois eixos |
| Geográfico | Aliases `lat / lng / x / y` | Sem limite | Não | Não | Plotar lat/lng |
| Linha do tempo | Sufixo `at$ / time / date / created` | Sem limite | Não | Não | Eventos + cor por categoria |
| Árvore | `id / parent_id / name` | Sem limite | Não | Não | FK auto-referenciada |
| Histórico de linha | Heurística `*_history / *_audit` | 200 linhas (SQL LIMIT) | Não | ✓ (consulta audit) | Versões de uma linha |
| Linhagem | — | Histórico de 500 | Não | Não | Relação read/write de uma coluna (heurística) |

## Atalhos

| Vista | Entrada | Notas |
|---|---|---|
| Gráficos | Toolbar `📊 Gráficos` | Abre direto em barra |
| Pivot / Árvore / Geo / Linha do tempo | Toolbar `📐 Vistas → menu` | Mesmo modal, estado `altView` |
| Histórico de linha | Via `rowHistOpen.value = { conn, table, pk }` | Reservado, aguarda menu de contexto |
| Linhagem | Via `lineageOpen.value = { conn, table, column }` | Reservado, aguarda menu de contexto |

Fechar modal volta à grade sem perder paginação / ordenação — são apenas "lupas" sobre a grade.

## Pequena árvore de decisão

**Magnitude / ranking / tendência / proporção** → Gráficos
- magnitude vs tempo → linha / área
- ranking categórico → barra
- proporção → pizza / donut
- multi-dimensão → radar

**Cruzamento de eixos** ("canal × mês") → Pivot

Dados com **`(lat, lng)`** → Geográfico

Dados com **tempo**:
- série temporal contínua (DAU diário) → linha
- eventos discretos (deploys, alertas) → linha do tempo

**FK auto-referenciada** → Árvore

**Histórico de uma linha** → Histórico de linha

**Quem lê / escreve uma coluna** → Linhagem (heurística, com cautela)

Pronto, todas as vistas alternativas estão cobertas. Se a sua forma de dados não se encaixa, 90% das vezes basta reescrever o SQL — caso contrário, copie para Excel / Numbers / Notion.

Para inspecionar a execução do SQL (slow log, EXPLAIN, recomendação de índices), veja [Avançado e engenharia](./advanced.md); para import/export, veja [Migração de dados](./databases.md).
