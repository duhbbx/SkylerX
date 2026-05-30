# Troubleshooting & Compatibility

## Common connection failures

### `ECONNREFUSED` — connection refused

- DB process is not running, or the wrong port is bound
- Check: `nc -zv <host> <port>` or `telnet`
- Docker: `docker ps` to confirm the container is Up and the port mapping is right

### `ETIMEDOUT` — timeout

- Firewall / security group / VPN is blocking traffic
- SSH tunnel scenarios: bastion host unreachable

### `Authentication failed`

- Wrong username / password
- MySQL `caching_sha2_password` compatibility — upgrade mysql2 or switch to `mysql_native_password`
- PG `pg_hba.conf` doesn't allow the source

### Oracle `ORA-12541: TNS:no listener`

- The Oracle container hasn't finished starting, or LISTENER hasn't registered
- Wait 1-2 minutes and retry
- Double-check the service name (default XEPDB1; `gvenzl/oracle-free` uses FREEPDB1)

### Oracle `ORA-00900: invalid SQL statement near 'v'` (connecting to OceanBase)

- A telltale sign of an **OceanBase Oracle tenant** — the `VERSION()` function does not exist in Oracle mode
- Fixed in SkylerX v0.5+ (probes with `SELECT 1 FROM DUAL` instead)
- Older versions: upgrade

### Oracle `ORA-01950: insufficient quota on tablespace USERS`

A newly created Oracle user has no quota — inserts / table creation fail. **Fix**:

```sql
-- Run with a SYSDBA connection
ALTER USER "your_username" QUOTA UNLIMITED ON USERS;
-- Or more permanently
GRANT UNLIMITED TABLESPACE TO "your_username";
```

> ⚠️ Oracle uppercases unquoted identifiers. If the username was created with double-quoted lowercase (`"test"`), later ALTER must use the same double-quoted, original-case form.

### MongoDB ObjectId can't be edited

- Editing `_id` in the grid fails — after IPC serialization the ObjectId becomes a string, and the driver doesn't auto-wrap
- Fixed in SkylerX v0.5+: the driver detects 24-hex `_id` strings and wraps them as ObjectId
- Older versions: for collections with real ObjectId PKs, edit in mongosh

## Error code reference

### MySQL / MariaDB / TiDB / Doris / StarRocks

| errno | Meaning | Common cause |
|---|---|---|
| 1045 | Access denied | Wrong username / password |
| 1049 | Unknown database | DB doesn't exist |
| 1054 | Unknown column | Typo |
| 1062 | Duplicate entry | Unique-key violation |
| 1064 | SQL syntax error | Syntax mistake |
| 1146 | Table doesn't exist | Table missing / wrong DB |
| 1213 | Deadlock | Deadlock — retry |
| 1264 | Out of range value | Column type can't hold the value |
| 2002 | Can't connect via socket | Wrong host / port |
| 2003 | Can't connect to MySQL server | Refused |
| 2013 | Lost connection during query | Server crashed / timed out |

### PostgreSQL / compatible dialects (KingbaseES / openGauss / CockroachDB / Greenplum / Redshift / H2)

5-digit SQLSTATE:

| Code | Meaning |
|---|---|
| 23505 | unique violation |
| 23502 | not null violation |
| 23503 | foreign key violation |
| 42P01 | undefined table |
| 42703 | undefined column |
| 42601 | syntax error |
| 28000 | invalid authorization |
| 08001 | unable to connect |
| 40001 | serialization failure (retry) |
| 53300 | too many connections |

### Oracle / OB Oracle tenant / DM

ORA-xxxxx series:

| Code | Meaning |
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

## Performance issues

### Sluggish on large result sets

- Default page size too large? Drop to 200-500 rows — virtual scrolling kicks in
- Too many columns? Hide the ones you don't need (right-click header → Hide)

### High network latency

- Slow remote connections: use SSH tunnels with compression / place a bastion closer
- Slow AI: pick a closer provider region (deepseek.com is fast inside China)

### SkylerX itself is slow to start

- Check `Settings → Startup` → uncheck "Automatic update check"
- macOS: `xattr -d com.apple.quarantine /Applications/SkylerX.app` strips the quarantine attribute

## Data security / privacy

- Passwords encrypted via the OS keychain (macOS Keychain / Win DPAPI / Linux Secret Service)
- AI **does not send data** by default — only schema hints
- All connections / SQL history / snippets / settings are kept in local SQLite
- No telemetry, no statistics upload

## Common upgrade issues

### Auto-update fails

- Network issue: download the new installer manually from [Releases](https://github.com/duhbbx/SkylerX/releases)
- Permission issue: macOS app isn't writable — reinstall as admin

### Connections / settings disappeared after upgrade

**Should not happen** — the local SQLite is forward-compatible. If you see this, **do not delete the old data directory** — first [file an issue](https://github.com/duhbbx/SkylerX/issues) — it's usually a path migration problem.

## Filing a bug

If nothing above helps:

1. Click "**✨ Ask AI**" on any error dialog to see if the AI can pinpoint it
2. Still stuck → [GitHub Issues](https://github.com/duhbbx/SkylerX/issues/new)
3. Include in your issue:
   - SkylerX version (`Help → About`)
   - OS + version
   - Database type + version
   - Steps to reproduce
   - Full error message

## Enterprise / on-prem deployment

- Deep Chinese-vendor compliance (Loongson / Phytium / Kunpeng)
- SM crypto / MLPS deployment
- Database migration consulting (Oracle → DM / KingbaseES)
- Custom in-network builds

Contact: `duhbbx@gmail.com` · WeChat `tuhoooo`
