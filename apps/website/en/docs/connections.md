# Connection Management

## Create a connection

⌘N / Ctrl+N or the "New connection" button in the top-left → form pops up.

### Common fields (all dialects)

| Field | Description |
|---|---|
| Name | Display label, anything goes |
| Dialect | Database type (MySQL / PG / Oracle / ...) |
| Host | Hostname or IP |
| Port | Auto-filled per dialect (MySQL 3306 / PG 5432 / Oracle 1521 ...) |
| User | Username |
| Password | Leave blank to be asked on first connect |
| Database | Default database / schema, optional |
| Group | Folder at the tree root, useful for managing multiple environments |
| Environment | dev / test / prod — prod triggers [production safeguards](#production-safeguards) |

### Dialect-specific fields

#### Oracle / OB Oracle tenant

| Field | Description |
|---|---|
| Service Name | Default XEPDB1; container `gvenzl/oracle-free` uses FREEPDB1 |
| privilege | SYSDBA / SYSOPER / SYSASM / SYSBACKUP / SYSDG / SYSKM / SYSRAC; leave blank for normal |

> **SYSDBA login** on Oracle typically targets the CDB root (`FREE` rather than `FREEPDB1`).

#### Snowflake

| Field | Description |
|---|---|
| Account | Snowflake identifier such as `xy12345.us-east-1` |
| Warehouse | Compute warehouse |
| Role | Default role |
| Schema | Default schema |
| Authenticator | `password` by default, or `snowflake_jwt` for private-key auth |
| Private Key Path | PEM file (shown in JWT mode) |
| Private Key Passphrase | Optional passphrase |

#### MongoDB

Optional **URI mode**: `mongodb://user:pass@host:27017/db?replicaSet=rs0` — overrides host/port/user/password when set.

#### SQLite / DuckDB

No host/port/user — just a **database file path**:
- "Browse…" opens the system file picker
- Non-existent file names are accepted (a new DB is created)
- Empty path → in-memory mode `:memory:` (lost when the app closes)

#### ClickHouse

| Field | Description |
|---|---|
| URL | Full URL (`https://user:pass@host:8443/...`); overrides host/port when set |
| Show System Databases | The `system` / `information_schema` databases are hidden by default |

#### Redis

Just host/port/password/dbIndex. SkylerX automatically expands the 16 logical databases (db0..db15).

#### H2

Only **PG-server mode** is supported. Start H2 with `-pg`:

```bash
java -cp h2-2.x.x.jar org.h2.tools.Server \
  -pg -pgPort 5435 -ifNotExists -baseDir ./data
```

Then connect: Host=localhost, Port=5435, User=`sa`, Password=empty.

## SSH tunneling

Database behind a bastion host? Switch to the **SSH tab** → enable SSH tunneling:

- SSH host / port / user
- Auth: **password** or **private key** (e.g. `~/.ssh/id_rsa`) — pick one
- Key passphrase (if encrypted)

SkylerX opens an SSH tunnel and routes the database connection through it.

## SSL / TLS

Switch to the **SSL tab** → enable SSL:

- Whether to verify the server certificate
- CA / cert / key (paste PEM text or pick a file)

## Manual commit mode

`Settings → Default commit mode` (global) or **per-connection → Advanced → Commit mode**:

- `auto` (default): each statement commits immediately
- `manual`: the user must explicitly press "Commit / Rollback"; SkylerX pins a long-lived connection to hold the transaction

Great for data fixes / critical migrations. **Strongly recommended for production connections**.

## Test connection

The "Test connection" button at the bottom of the form gives real-time feedback:
- ✅ Success + server version + round-trip latency
- ❌ Failure + error code + auto-classification ("refused" / "DNS" / "timeout" / "auth" / "SSL" etc.) + remediation steps

On a failed test, click **"✨ Ask AI"** to dump the error + connection metadata straight into the chat panel.

## Production safeguards (`env=prod`)

Connections tagged `prod` get extra protection:

- A red `[prod]` badge appears at the tree root
- Running `DROP TABLE / DATABASE / INDEX`, `TRUNCATE`, or `UPDATE/DELETE` without `WHERE` **requires typing the connection name** to proceed
- AI answers are more conservative on prod (default SELECT-only style)

The environment tag is **purely local config** — it doesn't touch the database itself.

## Encrypted password storage

Passwords are encrypted via the OS keychain:

- **macOS**: Keychain Access
- **Windows**: DPAPI (tied to the current logged-in user)
- **Linux**: Secret Service (GNOME Keyring / KWallet)

If the keychain is unavailable, SkylerX falls back to base64 encoding (clearly tagged with a `plain:` prefix and a **not-secure warning**). **In production, make sure the keychain is available**.

## Grouping

Each connection can sit under a **group** (optional). The tree collapses by group:

```
📁 Development
   ├── Local MySQL
   └── Local PostgreSQL
📁 Testing
   └── Test OceanBase
📁 Production  ⚠
   └── prod-mysql [prod]
```

When creating a connection, type a name into the "Group" field (Enter to confirm).

## Multiple windows (run queries in parallel)

⌘⇧N / Ctrl+Shift+N opens a fresh SPA window that loads the same config store. Each window has its own connections and doesn't interfere with the other.

Great for the "prod on the left, staging on the right" comparison workflow.

## Delete a connection

Right-click the connection → Delete → confirm → removes the entry from SQLite and clears the matching keychain item.

The database itself is **unaffected** — only the SkylerX-side connection config disappears.
