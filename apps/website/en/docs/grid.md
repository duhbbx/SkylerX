# Result Grid

After running a SQL statement, results appear in the grid below the editor.

## Pagination + virtual scrolling

- Default page size 200 rows; adjust in `Settings → Default page size`
- Large result sets (> 10,000 rows) auto-enable **virtual scrolling** — only visible rows are rendered, so a million-row scroll stays smooth
- Bottom pager: first / prev / next / last + a jump-to input

## Editable mode

The result of a single-table `SELECT` is editable by default (auto-disabled when JOIN / aggregation is detected):

### Edit a cell

- **Double-click a cell** → enter edit mode (input focused, existing text selected — type to overwrite)
- The input fits the cell exactly — WYSIWYG
- Enter to confirm / Esc to cancel
- Modified cells get a "dirty" highlight

### Add rows

- Toolbar "➕ Add row", or just type into the blank row at the bottom of the grid
- Multi-column entry: Tab moves to the next column
- Leave the PK column blank → DB default / auto-increment kicks in

### Delete rows

- Check rows (multi-select) → toolbar "🗑 Delete selected"
- The whole row gets a red dirty marker

### Undo / Commit

- "↺ Undo" reverts all uncommitted changes
- "✓ Commit" pops the "SQL preview" dialog:
  ```sql
  UPDATE users SET email='new@x.com' WHERE id=42;
  INSERT INTO users (name, email) VALUES ('Bob', 'bob@x.com');
  DELETE FROM users WHERE id=99;
  ```
- After you confirm, **everything commits as one transaction**; on failure SkylerX rolls back automatically, keeping your edits intact

## Cell visuals

- **NULL** → grey `NULL` text
- **Empty string** → light grey `''` placeholder
- **Long text** → truncated with ellipsis + tooltip
- **JSON** → monospace + syntax-colored (object / array / literal)
- **BLOB** → auto-detected images (PNG / JPEG / GIF / WEBP headers), otherwise `<BLOB N bytes>` + hex preview
- **Numeric columns** → sparkline added to the column header (trend on the current page)
- **NULL cells / big numbers** → conditional coloring by default (toggle in Settings)

## Column operations

### Right-click menu on column headers

- Copy column name
- Sort ascending / descending / clear
- Hide / show
- Add filter
- Add referenced field (for FK columns — pulls in a column from the referenced table)

### Column width

Drag the column border to resize; **double-click the border** to auto-fit content width.

## Filtering

Toolbar 🔍 or right-click a column header → add filter. Supports:

- String: contains / startsWith / regex
- Number: `= != < > between`
- Date: ranges
- Boolean: checked / unchecked
- NULL: `IS NULL` / `IS NOT NULL`

Multiple columns AND together. **Excel-style multi-value filter**: click ⋯ in the column header top-right → shows a checklist of distinct values.

## Sorting

- Click a column header: ascending → descending → cleared
- Multi-column sort: hold Shift while clicking

## Copy

Select a region → ⌘C / Ctrl+C → copies (TSV by default).

Toolbar "Copy as":
- CSV
- TSV
- JSON array
- Markdown table
- SQL `VALUES (...)` (paste into INSERT)
- SQL `INSERT INTO ...` (complete insert statements)

## Export

Toolbar "Export" → pick a format:

- **CSV / TSV** — customizable row / field separators
- **JSON / NDJSON** — array / one-doc-per-line
- **Excel .xlsx** — real SheetJS output, formulas / styles preserved
- **Markdown / HTML** — table + optional styling
- **SQL INSERT** — handy for moving table data between databases
- **Encrypted .skbk** (experimental) — AES-256-GCM + PBKDF2, **so your data leaves the building locked**

## Foreign-key jumps

- Right-click cell → "Jump to referenced row" — finds the referenced table + WHERE clause automatically
- Right-click cell → "Find reverse references" — shows which tables / rows point at the current value

## Right-click cell menu — Ask AI / Cross-table value search

Right-click any cell:

- Copy
- Jump to referenced row / find reverse references
- **Search this value across tables** — does this value appear anywhere else in the database?
- **Ask AI** — sends the selected error or odd data to the AI for analysis

## Alternate views

The view switcher in the top-right of the toolbar:

- **Grid** (default)
- **JSON** (raw JSON, handy for debugging)
- **Form** (single row, multi-column → vertical label-value form editing)
- **Pivot table**
- **Self-referencing FK tree** (parent-child data such as comments / departments)
- **Geo scatter** (auto-detects lat / lng columns)
- **Timeline** (time column + numeric column → line / bar)
- **Chart** (bar / line / pie, PNG export)
