# Alternate Views for Result Sets

Once a SQL statement returns a result set, the default view is the grid (see [Result grid](./grid.md)). But the grid isn't always the best lens — staring at a hundred rows of `(month, revenue)` to spot a trend is a thousand times harder than glancing at a line chart. SkylerX packs a set of **alternate views** into the result toolbar that re-render the same in-memory result without rerunning SQL.

This page explains: **when an alternate view beats the grid, how each view computes, what data shape it needs, and what artifacts you can save**.

## When alternate views beat the grid

| Data shape | Recommended view | Typical scenario |
|---|---|---|
| One categorical + one numeric column | Bar / pie / donut | Sales by city, errors by endpoint |
| One time + one numeric column (continuous) | Line / area | DAU trend, CPU usage |
| Two numeric columns (correlation) | Scatter | User activity vs retention |
| Three categorical / numeric columns | Pivot | Channel × month = revenue |
| Two columns `(lat, lng)` | Geo scatter | Store distribution, user map |
| Time column + label column | Timeline | Deploys, order lifecycle |
| `(id, parent_id, ...)` | Self-FK tree | Threaded comments, org charts |
| Multiple historic snapshots of the same row | Row history | Audit-table traceback |

Toolbar triggers (`packages/ui/src/components/ResultGrid.vue:1202-1215`):

```vue
<button :disabled="!result?.rows.length" @click="chartOpen = true">📊 Chart</button>
<div class="menu-box">
  <button @click="showViewMenu = !showViewMenu">📐 View</button>
  <!-- popup menu -->
  <button @click="altView = 'pivot'">⊞ Pivot</button>
  <button @click="altView = 'tree'">🌳 Tree</button>
  <button @click="altView = 'geo'">🗺 Geo</button>
  <button @click="altView = 'timeline'">⏱ Timeline</button>
</div>
```

All these views open in modals and return to the grid when closed — they're a magnifying glass on the grid, not a replacement.

## 1. Chart view (bar / line / pie + 4 extras)

`packages/ui/src/components/ChartDialog.vue`, **630 lines**. Trigger: **📊 Chart**.

### Design choices

The code comments are refreshingly honest:

> No ECharts; SVG charts hand-rolled (a couple hundred lines each for bar / line + pie). Reasons:
> - Desktop app bundle size matters; charts are a result-grid utility, not the headline
> - These three types cover 90% of ad-hoc data inspection; we can graduate to ECharts later
> - SVG renders cleanly to PNG (toDataURL via `<canvas>`)

All seven chart types are hand-written SVG:

| Chart | Best for | Cap | Notes |
|---|---|---|---|
| 📊 Bar | Categorical comparison | First 50 rows | Y-axis ceiling auto-rounded |
| 📈 Line | Trend / time series | First 200 rows | `M / L` path |
| 🥧 Pie | Share / composition | First 50 rows | Auto percentage labels |
| ⛰ Area | Trend with magnitude | First 200 rows | Line closed down to baseline |
| ·· Scatter | Point cloud | First 200 rows | Dots |
| ⭕ Donut | Composition variant | First 50 rows | Outer `r * 1.0`, inner `r * 0.55` |
| 📡 Radar | Multi-dimensional | First 50 rows, ≥ 3 points | One axis per row |

### Column picker

Three selectors in the top bar: **Label** (any column, `.toString()`), **Value** (auto-detected numeric columns; non-numeric ones get `(?)` suffix), **Type**. `isNumericColumn` samples the first 20 rows with `Number.isFinite(Number(v))`. Default Y = first numeric column. The selectors `watch` and reset when the result changes.

Row handling: rows where `Number(v)` is NaN are skipped; overflow past the row cap takes only the first N (bar / pie 50; line / area / scatter 200; radar 50).

### Y-axis

For a clean axis, the ceiling is `Math.ceil(m / 10^floor(log10(m))) * 10^floor(log10(m))`. Tick labels are formatted as `B / M / k` (above 1e9 / 1e6 / 1e4).

### Output: PNG export

Top-right `⬇ Export PNG` → `XMLSerializer` serializes the SVG → `<canvas>` draws it at 2× HiDPI (dark `#1d1e22` background) → `canvas.toBlob('image/png')` → routed through the custom `SaveFileDialog`. File name `chart-{kind}-{ts}.png`, resolution 1440×720 — fits straight into Lark / Slack.

## 2. Pivot table (PivotDialog)

`packages/ui/src/components/PivotDialog.vue`, 162 lines. Trigger: **📐 View → ⊞ Pivot**.

The pitch: **pivot the current result in memory** without rerunning SQL. The algorithm is straightforward — group rows by `(rowFields...)`, then bucket each group by `colField`, then `agg` per bucket.

### Three axes + one aggregator

| Control | Behavior |
|---|---|
| **Rows** (multi-select chips) | Group by these columns; key joined with `'\|'` |
| **Columns** (dropdown) | Each distinct value becomes a header column (lexicographic order) |
| **Value** + aggregator | Per `(row, col)` cell, aggregate this column |
| Aggregator dropdown | `COUNT / SUM / AVG / MIN / MAX` |

### Algorithm

Two nested maps `Map<rowKey, Map<colKey, number[]>>`: one pass over `result.rows`; `rowKey` is the `|`-joined string of `rowFields`; `colKey` is the stringified `colField`; `Number(row[valueField])` lands in the array. `NULL` is normalized to the literal `'NULL'` (grouped together). COUNT uses `length`; others use numeric aggregation.

### Limitations

The code comments admit it:

> Not supported: multiple value fields, ordered column names (pivot columns are lexicographic), filtering — possibly next release.

So "sort months 1-12 instead of 10, 11, 12, 1, 2..." isn't possible yet. Work around it in SQL by zero-padding (`'01' / '02' / ...`).

### Output

This is just a transient table view — no direct export. To persist:

- Close pivot → back to grid → right-click copy → CSV / Markdown into Excel / Notion
- Rewrite the pivot in SQL: MySQL `GROUP BY x WITH ROLLUP` / PG `crosstab()`

## 3. Geo scatter (GeoMapDialog)

`packages/ui/src/components/GeoMapDialog.vue`, 138 lines. Trigger: **📐 View → 🗺 Geo**.

No leaflet, no basemap — SVG dots drawn straight from `(lng, lat)`. The code comments explain:

> Projection: equirectangular (Mercator's visual distortion is small for local data; raw lng/lat is plenty without a heavy CRS).
> Not done: basemap (no tiles), clustering (dense points smear but pan/zoom helps).

### Auto column detection

```ts
latCol = cols.find(c => /^(lat|latitude|y)$/i.test(c)) ?? cols[0]
lngCol = cols.find(c => /^(lng|lon|long|longitude|x)$/i.test(c)) ?? cols[1]
labelCol = cols.find(c => /^(name|title|label|id)$/i.test(c)) ?? ''
```

Strict numeric guards (to filter junk data):

```ts
if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue
```

### Auto-framing

Not a full world map — the bounds "just enclose all points with 5% padding":

```ts
const dx = Math.max(0.001, (maxX - minX) * 0.05)
return { minX: minX - dx, maxX: maxX + dx, ... }
```

Corner lng/lat labels appear on the SVG edges. Hovering a point shows `lat=... lng=...`.

### Output

Visual browse only — no PNG export (possibly next release). For a persistable visualization, add a category column to the SQL and use the scatter chart view.

### Data shape

| Recognized columns | Example |
|---|---|
| `lat`, `latitude`, `y` | `latitude FLOAT` |
| `lng`, `lon`, `long`, `longitude`, `x` | `lng DECIMAL(9,6)` |
| `name`, `title`, `label`, `id` (label, optional) | `store_name VARCHAR` |

Non-standard names work too — pick them manually as long as values are numeric and in range.

## 4. Timeline (TimelineDialog)

`packages/ui/src/components/TimelineDialog.vue`, 171 lines. Trigger: **📐 View → ⏱ Timeline**.

### Auto column detection

```ts
timeCol = cols.find(c => /at$|_time$|date|time|created|updated/i.test(c)) ?? cols[0]
labelCol = cols.find(c => /^(name|title|label|id|user|action)$/i.test(c)) ?? ''
colorCol = ''   // optional: color points by this column
```

Catches `created_at / updated_at / event_time / order_date / login_time` etc. by default.

### Time parsing (`toMs`)

Handles four formats:

```ts
function toMs(v: unknown): number | null {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000   // ms or s heuristic
  const ms = Date.parse(String(v))  // ISO / "YYYY-MM-DD HH:MM:SS"
  return Number.isNaN(ms) ? null : ms
}
```

> Numbers below 1e12 (year 2001) are treated as Unix seconds (×1000); above that as ms. Business timestamps work fine; rare pre-1969 timestamps get misclassified — if your data has those, convert to strings with `to_char(...)` in SQL first.

### Rendering

Horizontal timeline; points are staggered up/down to avoid overlap (`i % 2 === 0 ? -16 : +16`); the X axis has 5 evenly spaced date labels.

If a **color** column is set, distinct values use an 8-color palette in order (`#7c6cff / #4caf50 / #e0a020 / #e04050 / #3aa1ff / #b48cff / #67c23a / #ff9966`) and a legend appears below. Hovering a point shows `time · label` in the info bar.

### Data shape

At minimum one time column (any Date / ISO / Unix seconds or ms). Label / Color are optional.

## 5. Self-referencing FK tree (TreeViewDialog)

`packages/ui/src/components/TreeViewDialog.vue`, 130 lines. Trigger: **📐 View → 🌳 Tree**.

Good for **self-referencing FKs** or hierarchical data: nested comments (`comments.parent_id → comments.id`), org departments (`departments.parent_dept_id → id`), administrative regions (`regions.parent_id`).

### Three axes

| Selector | Inference rule |
|---|---|
| **id** | Match `/^id$/i` first, else the first column |
| **parent** | Match `/parent[_-]?id\|pid/i`, blank by default |
| **label** | Match `/^(name\|title\|label)$/i`, else fall back to id |

### Algorithm

Two passes: first builds an id index (`byId: Map<id, node>`), second wires children to parents. A parent id missing from the index (including NULL) means root. `parent === self` is treated as root (defending against rogue rows like `WHERE id=1 AND parent_id=1`).

### Cycle detection

`walk(n, depth)` does DFS with a `Set<string>` of visited ids; if it revisits one it sets `n.cycle = true` and stops. A yellow `⚠` appears next to the node and a "cycle" tooltip shows on hover. Common after ops mistakes (what should be parent-child becomes a loop).

### Rendering

Flattened, each node indented by `depth * 18px`, displayed as `▸ <label> #<id>`. Hovering the label shows the full JSON via `title="{json}"` for quick visual inspection.

### Data shape

At minimum id + parent. A single `SELECT id, parent_id, name FROM comments WHERE post_id = 1234` retrieves the whole tree at once and the view renders it.

## 6. Row history (RowHistoryDialog)

`packages/ui/src/components/RowHistoryDialog.vue`, 123 lines.

The pitch: **single-row version traceback** — given a row's PK in some table, find all versions in `audit / *_history / *_log` shadow tables.

### Auto shadow-table discovery

On open, runs `SELECT table_name FROM information_schema.tables WHERE table_name LIKE '{base}_%' OR table_name = 'audit_{base}' OR table_name = '{base}_history'`. Candidates fill a `<datalist>` dropdown — pick one or type your own.

### History query

Once a shadow table is set, queries by PK: `SELECT * FROM {shadow} WHERE {pk}=... ORDER BY changed_at, updated_at, created_at, version, revision DESC LIMIT 200`. ORDER BY lists five candidate columns at once — the database uses whichever exists (MySQL is tolerant, PG is strict; most audit tables have at least one). Result shown as a compact mini-table, each cell truncated to 80 chars.

### Data shape

A business table + a `*_history` / `*_audit` / `*_log` shadow table (PK + duplicated business columns + a `changed_at / version` field). Standard audit-trigger implementations satisfy this.

> Implementation note: the dialog is already wired up (`Workspace.vue` has `rowHistOpen` state and the modal mount), but there isn't a right-click entry from the result grid yet — it's reserved for a future menu extension.

## 7. Data lineage (LineageDialog) — heuristic version

`packages/ui/src/components/LineageDialog.vue`, 98 lines.

The code comment is upfront:

> Column lineage (heuristic version): no real SQL parser yet. Crude heuristic — scan historical SQL text for `{table}.{column}` or bare `{column}` (when the SQL FROMs `{table}`) and call those related.
> Limited accuracy: misses (aliases / subqueries) and false positives (same-name columns). The UI clearly labels this "heuristic" — we'll replace it with a real lineage analyzer when a SQL parser ships.

### Algorithm

Pulls the most recent 500 history SQL entries for this connection and matches each with `\b{table}\b` + `\b{column}\b` word-boundary regexes. On match, looks at the leading keyword: `INSERT / UPDATE` → sinks (write); `SELECT / WITH` → sources (read).

### Rendering

Two columns:

- **← Sinks** — SQL that writes **to** this column (INSERT / UPDATE)
- **→ Sources** — SQL that reads **from** this column (SELECT / WITH)

Each row shows execution time + the first 120 chars of the SQL. A yellow banner at the top warns "heuristic results, not for audit".

### Data shape

Depends on the query history (`client.connections.history`). If you've never run a related query in SkylerX, the lineage window shows "No hits".

> Implementation note: same as RowHistoryDialog — wired up in `Workspace.vue`, needs an external trigger (`lineageOpen.value = {...}`), no dedicated UI entry yet — reserved API.

## Capability matrix

| View | Auto column detection | Data cap | Static export | Re-runs SQL | Best for |
|---|---|---|---|---|---|
| Charts (7 kinds) | Numeric column sniff | 50 / 200 rows | PNG (2× HiDPI) | No | Magnitude / trend / composition |
| Pivot | First / second / third column | Browser memory | Copy as CSV | No | Two-axis cross aggregation |
| Geo scatter | `lat / lng / x / y` aliases | None | No | No | Lat/lng direct draw |
| Timeline | `at$ / time / date / created` suffixes | None | No | No | Event stream + categorical color |
| Tree | `id / parent_id / name` | None | No | No | Self-FK hierarchy |
| Row history | Heuristic `*_history / *_audit` | 200 rows (SQL LIMIT) | No | ✓ (audit table) | Single-row traceback |
| Lineage | — | 500 history entries | No | No | Column read/write (heuristic) |

## Trigger summary

| View | Entry | Notes |
|---|---|---|
| Chart | Result toolbar `📊 Chart` | Opens to bar by default |
| Pivot / Tree / Geo / Timeline | Result toolbar `📐 View → popup menu` | Same modal, shared `altView` state |
| Row history | `rowHistOpen.value = { conn, table, pk }` | Reserved, awaits right-click menu |
| Lineage | `lineageOpen.value = { conn, table, column }` | Reserved, awaits right-click menu |

Closing a modal returns to the grid — pagination / sort state is preserved. Alternate views are a magnifying glass on top of the grid, not a replacement.

## A tiny decision tree

Looking at **magnitude / ranking / trend / composition**? → Chart
- Magnitude vs time → Line / Area
- Categorical ranking → Bar
- Composition → Pie / Donut
- Multi-dimensional → Radar

Looking at a **two-axis cross** (e.g. "channel × month")? → Pivot

Got **`(lat, lng)`**? → Geo scatter

Got a **time column**:
- Continuous time series (daily DAU) → Line
- Discrete events (deploys, releases, alerts) → Timeline

**Self-FK** data → Tree

Want **one row's history**? → Row history

Want **who reads / writes this column**? → Lineage (heuristic, use with caution)

That covers every alternate view at the result-set layer. If your data shape doesn't fit any of these, 90% of the time a quick SQL rewrite makes it fit — failing that, drop back to the grid, copy to Excel / Numbers / Notion, and continue there.

To look at the SQL itself (slow log, EXPLAIN, index recommendations), see [Advanced features](./advanced.md); for import/export and migration, see [Database support](./databases.md).
