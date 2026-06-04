# Navigation Tree — manual QA

Covers: object-type coverage per dialect, multi-select (Ctrl/Shift), bulk ops, copy-connection-info submenu, exclude-system-objects, move-to-group picker, visible-DBs/schemas config, IME-safe prompts.

> Run when changing: `packages/ui/src/components/NavTree.vue`, `TreeItem.vue`, `tree-actions.ts`, `NavFilterDialog.vue`, `ContextMenu.vue`, `packages/core-driver/src/dialects/*.ts` (metadata), `packages/ui/src/dialog.ts` / `AppDialogs.vue` (prompts), `connExport.ts`.

## Setup

- Branch / commit:
- OS:
- Connections to at least: one MySQL, one PostgreSQL (standard), one openGauss/Vastbase, one Oracle or DM, ideally one SQL Server.

## Object-type coverage per dialect

Expand a schema and confirm the expected object-type groups appear (with counts). Create one of each kind first if the schema is empty.

| Dialect | Expected groups under a schema | OK? |
|---|---|:---:|
| MySQL / MariaDB / OceanBase / TiDB | 表 / 视图 / 函数 / 存储过程 / 事件 (+ 触发器 under a table) | [ ] |
| PostgreSQL (standard) | 表 / 视图 / 物化视图 / 函数 / 存储过程 / 序列 / 类型 | [ ] |
| openGauss / Vastbase | 表 / 视图 / 物化视图 / 函数 / 存储过程 / 序列 / 类型 / **包** / **同义词** | [ ] |
| Oracle / DM | 表 / 视图 / 函数 / 存储过程 / 包 / 序列 / 触发器 / **类型** / 同义词 | [ ] |
| SQL Server | 表 / 视图 / 函数 / 存储过程 / 触发器 / 序列 / 类型 / 同义词 | [ ] |

- [ ] **DM types show up** (regression: DM stores them as `object_type='CLASS'`, not `'TYPE'`) — create `CREATE TYPE … AS OBJECT (…)`, confirm it appears under 类型, and "view DDL" / drop work
- [ ] PG/openGauss: a **stored procedure** appears under 存储过程 ONLY, not duplicated under 函数 (openGauss reports procedures as routine_type=FUNCTION; must split by `prokind`)
- [ ] Expanding any new group lists its objects; right-click → drop / view-DDL works (matview → `DROP MATERIALIZED VIEW`)
- [ ] Standard PG without `pg_synonym`/`gs_package`: no error in the metadata fetch (those groups are openGauss-only)

## Multi-select & bulk ops

- [ ] **Plain click a table, then Shift+click a table further down in the same group → every table in between is selected** (regression: first Shift-select used to select only the clicked node)
- [ ] Ctrl/⌘+click toggles individual nodes into the multi-set
- [ ] Multi-select is constrained to siblings (same parent + same kind) — Shift across schemas/groups doesn't leak
- [ ] Bulk bar shows the count; DROP / TRUNCATE / export-DDL / copy-SELECT all act on the whole set
- [ ] **Connection Shift-range stays within the same group folder** (regression: ranging over the raw connection array used to select a far-away connection in another group). Plain-click a connection in group A, Shift+click another in group A → only that group's contiguous range; a target in group B falls back to single-toggle

## Copy connection info (submenu)

Right-click a connection → **复制连接内容 ▸**:

- [ ] Submenu expands on hover with: JDBC URL / JSON / 多行文本 / 单行(分号)
- [ ] **None of the four formats contain the password** (paste and check; also check `ssh.password` is absent in JSON)
- [ ] JDBC URL is dialect-correct (jdbc:mysql:// , jdbc:postgresql:// , jdbc:sqlserver://…;databaseName= , jdbc:oracle:thin:@…/service , jdbc:dm://)
- [ ] Empty optional fields (no database / no group) are omitted from multi-line / single-line

## Exclude system DBs/schemas (visible-DBs/schemas config)

Right-click connection → 配置可见库/Schema:

- [ ] **"排除系统库/Schema" button** unchecks system DBs/schemas only (mysql / information_schema / pg_catalog / SYS / SYSAUDITOR / SYSSSO / db_owner …); user objects stay checked; toast reports the count
- [ ] **DM: SYSDBA stays checked** (it holds user objects), SYS/SYSAUDITOR/SYSSSO get unchecked
- [ ] PG `pg_temp_N` / `pg_toast` excluded (pg_* prefix)
- [ ] **Single-level dialects (MySQL/ClickHouse) show NO schema expand ▸** on database rows (no pointless fetch / no ECONNRESET); two-level (PG/SQL Server) still show the ▸ and sub-schema list
- [ ] Save → reopen → checkbox state persisted

## Move to group (combobox)

Select multiple connections → bulk "移动到分组":

- [ ] Dialog input is a **combobox**: dropdown lists existing groups, and you can type a new name
- [ ] A **new** group name is created (appears as a folder) and persists
- [ ] **Leading/trailing whitespace is trimmed** (`"  新组  "` → group `新组`)
- [ ] **Empty input = remove from group** (connections move to ungrouped)
- [ ] Toast names the target group, or says "moved out of group"

## IME-safe prompts (regression)

Any prompt dialog (move-to-group, rename, new group):

- [ ] **Type Chinese (or any IME), press Enter to confirm the candidate → the dialog does NOT submit**; only a second Enter (not composing) submits
- [ ] Typing `新分组vvv` and confirming yields exactly `新分组vvv` (not the truncated `新分组`)
- [ ] Esc during composition cancels the IME candidate, not the dialog

## Connection env marker

- [ ] A connection with an environment set shows a **hollow ring ○** (env: dev green / test orange / prod red) AND a **filled dot ●** (connection status), visually distinct — not two identical dots
- [ ] A connection with no env shows only the status dot
