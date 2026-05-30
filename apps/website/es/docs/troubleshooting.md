# Resolución de problemas y compatibilidad

## Problemas comunes de conexión

### `ECONNREFUSED` — Conexión rechazada

- El proceso de la base no está activo o el puerto está mal
- Comprueba: `nc -zv <host> <port>` o `telnet`
- Contenedores Docker: `docker ps` para ver si está Up y si el puerto está mapeado

### `ETIMEDOUT` — Timeout

- Cortafuegos / security group / VPN bloqueando
- Con túnel SSH: el bastión no responde

### `Authentication failed` — Falla la autenticación

- Usuario o contraseña incorrectos
- Compatibilidad con MySQL `caching_sha2_password` — actualiza mysql2 o usa `mysql_native_password`
- En PG, `pg_hba.conf` no permite ese origen

### Oracle `ORA-12541: TNS:no listener`

- El contenedor Oracle no terminó de arrancar o el LISTENER no se registró
- Espera 1-2 minutos y reintenta
- Verifica el service name (por defecto XEPDB1; `gvenzl/oracle-free` usa FREEPDB1)

### Oracle `ORA-00900: invalid SQL statement near 'v'` (al conectar OceanBase)

- Es típico del **tenant Oracle de OceanBase**: `VERSION()` no existe en modo Oracle
- En SkylerX v0.5+ está corregido (usa `SELECT 1 FROM DUAL` para probar)
- Versiones antiguas: actualiza a la última

### Oracle `ORA-01950: insufficient quota on tablespace USERS`

Un usuario Oracle recién creado sin quota no podrá insertar ni crear tablas. **Solución**:

```sql
-- 用 SYSDBA 连接执行
ALTER USER "your_username" QUOTA UNLIMITED ON USERS;
-- 或更彻底
GRANT UNLIMITED TABLESPACE TO "your_username";
```

> ⚠️ Oracle convierte por defecto los identificadores no entrecomillados a mayúsculas; si el usuario se creó con comillas dobles y minúsculas (`"test"`), los ALTER posteriores también deben usar comillas dobles y respetar el case.

### No se puede editar el ObjectId en MongoDB

- Editar `_id` desde la cuadrícula falla; al pasar por IPC, ObjectId se serializa a string y el driver no lo reenvuelve solo
- SkylerX v0.5+ ya lo arregla: el driver detecta strings 24-hex en `_id` y los wrappea como ObjectId
- En versiones antiguas: edita temporalmente con mongosh

## Códigos de error

### MySQL / MariaDB / TiDB / Doris / StarRocks

| errno | Significado | Causa típica |
|---|---|---|
| 1045 | Access denied | Usuario / contraseña errónea |
| 1049 | Unknown database | La base no existe |
| 1054 | Unknown column | Nombre de columna mal escrito |
| 1062 | Duplicate entry | Conflicto de índice único |
| 1064 | SQL syntax error | Error de sintaxis |
| 1146 | Table doesn't exist | Tabla inexistente o base equivocada |
| 1213 | Deadlock | Deadlock, reintenta |
| 1264 | Out of range value | El tipo de columna no cabe el valor |
| 2002 | Can't connect via socket | Host / puerto erróneos |
| 2003 | Can't connect to MySQL server | Conexión rechazada |
| 2013 | Lost connection during query | Server crash / timeout |

### PostgreSQL / dialectos compatibles (KingbaseES / openGauss / CockroachDB / Greenplum / Redshift / H2)

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
| 40001 | serialization failure (reintenta) |
| 53300 | too many connections |

### Oracle / tenant OB Oracle / DM 达梦

Familia ORA-xxxxx:

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

## Rendimiento

### Cuadrícula con muchas filas va lenta

- ¿Tamaño de página demasiado grande? Bájalo a 200-500 filas; el scroll virtual se activa solo
- ¿Demasiadas columnas? Oculta las que no necesites (clic derecho en cabecera → Ocultar)

### Latencia de red alta

- Conexión remota lenta: túnel SSH con compresión o bastión más cercano
- IA lenta: cambia a una región más próxima (`deepseek.com` rápido en China)

### SkylerX arranca lento

- `Settings → Arranque` → desactiva "Buscar actualizaciones automáticamente"
- macOS: `xattr -d com.apple.quarantine /Applications/SkylerX.app` quita el atributo de cuarentena

## Seguridad / privacidad

- Las contraseñas se cifran con el llavero del SO (macOS Keychain / Win DPAPI / Linux Secret Service)
- La IA por defecto **no envía datos**, solo hints de schema
- Conexiones / historial SQL / snippets / configuración viven en SQLite local
- No se sube ningún tipo de telemetría

## Problemas al actualizar

### Falla la auto-actualización

- Problema de red: descarga manualmente desde [Releases](https://github.com/duhbbx/SkylerX/releases)
- Permisos: en macOS, si la app no puede escribir, reinstala como administrador

### Tras actualizar, se perdieron conexiones / ajustes

**No debería pasar**. La SQLite local es compatible entre versiones. Si ocurre, **no borres el directorio de datos de la versión anterior** y [abre un Issue](https://github.com/duhbbx/SkylerX/issues); normalmente es un asunto de migración de rutas.

## Reportar bugs

Si lo anterior no resuelve:

1. En cualquier diálogo de error de la app, pulsa "**✨ Preguntar a la IA**" a ver si lo localiza
2. Si sigue sin resolverse → [GitHub Issues](https://github.com/duhbbx/SkylerX/issues/new)
3. Adjunta:
   - Versión de SkylerX (`Help → About`)
   - SO + versión
   - Tipo de base + versión
   - Pasos para reproducir
   - Mensaje de error completo

## Colaboración empresarial / despliegue privado

- Adaptación profunda para entornos 信创 (Loongson / Phytium / Kunpeng)
- Despliegues con cifrado nacional chino / GB17859
- Consultoría de migración de bases (Oracle → 达梦 / KingbaseES)
- Versiones personalizadas para intranet

Contacto: `duhbbx@gmail.com` · WeChat `tuhoooo`
