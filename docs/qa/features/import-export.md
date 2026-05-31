# Import / Export — manual QA

Covers: CSV, Excel, JSON, SQL, Parquet, Markdown export from result grid; CSV / JSON import to a table.

> Run when changing: `packages/ui/src/export/*`, `packages/ui/src/import/*`, `apps/desktop/src/main/ipc/files.ts`.

## Setup

- Branch / commit:
- OS:
- Active connection + sample table (e.g. sakila.film with 1000 rows)

## Export from result grid

For each format, verify:

### CSV
- [ ] Right-click grid → Export → CSV → save dialog → write file
- [ ] Open file in TextEdit / Notepad → headers on first line, comma-separated
- [ ] Open file in Numbers / Excel / LibreOffice → table renders correctly
- [ ] Special chars (commas, quotes, newlines within fields) properly escaped (RFC 4180)
- [ ] UTF-8 BOM optional (settings) — Chinese / Japanese chars render in Excel for Windows
- [ ] Evidence: paste first 3 lines + screenshot in spreadsheet app

### Excel (.xlsx)
- [ ] Export Excel → opens in Numbers / Excel
- [ ] Column types preserved (numbers stay numbers, dates stay dates)
- [ ] Header row formatted (bold)
- [ ] Large result (50k rows) → file under reasonable size, opens within 10s
- [ ] Evidence: screenshot of spreadsheet

### JSON
- [ ] Export JSON → save → open in editor
- [ ] Array of objects, one per row
- [ ] BigInt → string (with `:string` marker to avoid JS number precision loss)
- [ ] Dates → ISO 8601 strings
- [ ] BLOB → base64 string
- [ ] Evidence: paste first 3 objects

### SQL
- [ ] Export SQL → save → file contains `INSERT INTO <table> VALUES (...)` per row
- [ ] Identifier quoting matches dialect (backtick for MySQL, double-quote for PG, etc.)
- [ ] String escaping is correct (no SQL injection if value contains `'`)
- [ ] Header comment with dialect + timestamp
- [ ] Multi-row INSERT batches (e.g. every 1000 rows)
- [ ] Evidence: paste first 5 lines

### Parquet
- [ ] Export Parquet → open with `parquet-cli` or pandas → schema + rows preserved
- [ ] Numeric types correctly mapped (INT → INT32/64, DECIMAL → DECIMAL)
- [ ] Date / timestamp preserved
- [ ] Evidence: paste `parquet-cli inspect output.parquet` output

### Markdown
- [ ] Export MD → file contains Markdown table
- [ ] Header row + separator row + data rows
- [ ] Wide content truncated with ellipsis (e.g. 100 char limit per cell, configurable)
- [ ] Renders correctly in GitHub preview
- [ ] Evidence: screenshot of GitHub-rendered MD

## Export options

- [ ] Choose subset of columns → only those exported
- [ ] Choose subset of rows (selection) → only those exported
- [ ] Choose all rows (even if grid only loaded first 1000) → exports full result via re-query / streaming
- [ ] Evidence:

## Large dataset streaming

- [ ] Run query returning 1M+ rows → "Export all" → progress bar
- [ ] Memory stays bounded (Activity Monitor under 1GB)
- [ ] No OOM
- [ ] Cancel button works
- [ ] Resulting file size matches expected (rows × avg width)
- [ ] Evidence: Activity Monitor screenshot during export

## Import (CSV → table)

- [ ] Right-click table → Import CSV → wizard opens
- [ ] Step 1: file picker → pick a CSV
- [ ] Step 2: preview of first 50 rows + column mapping
- [ ] Step 3: type inference — verify INT / DATE / VARCHAR detected
- [ ] Step 4: confirm import → progress bar
- [ ] After import → row count in tree updated
- [ ] Evidence: paste before/after `SELECT COUNT(*)`

### Edge cases
- [ ] Mismatched column count → error per row, skipped (not aborted)
- [ ] Bad date format → error per row, skipped + summary
- [ ] Duplicate primary key → error per row, ON CONFLICT option chosen
- [ ] Header row included / excluded (toggle in wizard)
- [ ] CSV with BOM → detected and stripped
- [ ] CSV with Windows CRLF / Unix LF → both handled
- [ ] Quoted fields with embedded commas / newlines → parsed correctly
- [ ] Evidence:

## Import (JSON → table)

- [ ] Array of objects → inserted as rows
- [ ] NDJSON (one JSON per line) → inserted as rows
- [ ] Field mapping (JSON key → column) editable in wizard
- [ ] Evidence:

## Encrypted export (if shipped)

- [ ] Choose "Encrypted" toggle in export dialog → enter passphrase
- [ ] Resulting file requires passphrase to open via the app's import
- [ ] Wrong passphrase on import → specific error, no partial decryption
- [ ] Evidence:

## Cross-platform

- [ ] macOS: file dialog respects sandbox; saves to ~/Downloads by default
- [ ] Windows: respects %USERPROFILE%\Downloads
- [ ] Linux: respects XDG_DOWNLOAD_DIR
- [ ] All 3: file permissions reasonable (644 / -rw-r--r-- on Unix)
- [ ] Evidence:

## Known limitations

- Excel export over 1M rows splits across sheets (Excel limit is 1,048,576 per sheet)
- Parquet export requires `parquetjs-lite` (bundled); may fail on exotic dialects with non-standard DECIMAL precision
- Markdown export not suitable for >10k rows (file gets huge); UI warns
