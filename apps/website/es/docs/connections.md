# Gestión de conexiones

## Nueva conexión

⌘N / Ctrl+N o el botón "Nueva conexión" arriba a la izquierda → se abre el formulario.

### Campos básicos (todos los dialectos)

| Campo | Descripción |
|---|---|
| Nombre de la conexión | Solo para mostrar, libre |
| Dialecto | Tipo de base de datos (MySQL / PG / Oracle / ...) |
| Host | hostname o IP |
| Puerto | Se rellena por defecto según el dialecto (MySQL 3306 / PG 5432 / Oracle 1521 ...) |
| Usuario | Nombre de usuario |
| Contraseña | Si la dejas vacía, se pide al primer conectar |
| Base de datos | Base / schema por defecto, puede quedar vacío |
| Grupo | Carpeta del nivel raíz del árbol, útil para gestionar varios entornos |
| Etiqueta de entorno | dev / test / prod — prod activa la [protección de producción](#proteccion-de-produccion) |

### Campos específicos por dialecto

#### Oracle / tenant OB Oracle

| Campo | Descripción |
|---|---|
| Service Name | Por defecto XEPDB1; el contenedor `gvenzl/oracle-free` usa FREEPDB1 |
| privilege | SYSDBA / SYSOPER / SYSASM / SYSBACKUP / SYSDG / SYSKM / SYSRAC; déjalo vacío para conexión normal |

> **Acceso SYSDBA** en Oracle normalmente conecta a la raíz del CDB (`FREE` y no `FREEPDB1`).

#### Snowflake

| Campo | Descripción |
|---|---|
| Account | Identificador Snowflake del tipo `xy12345.us-east-1` |
| Warehouse | Almacén de cómputo |
| Role | Rol por defecto |
| Schema | Schema por defecto |
| Authenticator | Por defecto password, o `snowflake_jwt` con clave privada |
| Private Key Path | Archivo PEM con la clave privada (visible en modo JWT) |
| Private Key Passphrase | Frase de paso de la clave privada (si existe) |

#### MongoDB

Modo opcional **URI directo**: `mongodb://user:pass@host:27017/db?replicaSet=rs0`; al rellenarlo se ignoran host/port/user/password.

#### SQLite / DuckDB

No requieren host/port/user, solo la **ruta del archivo de la base de datos**:
- Botón "Examinar…" al lado para abrir el selector de archivos del SO
- Se permiten nombres de archivos inexistentes (se crea automáticamente)
- Si lo dejas vacío → modo memoria `:memory:` (se pierde al cerrar la app)

#### ClickHouse

| Campo | Descripción |
|---|---|
| URL | URL completa (`https://user:pass@host:8443/...`); si la rellenas, se ignoran host/port |
| Show System Databases | Por defecto oculta las bases `system` / `information_schema` |

#### Redis

Solo host/port/password/dbIndex. SkylerX expande automáticamente las 16 bases lógicas (db0..db15).

#### H2

Solo se soporta el **modo PG-server**. H2 debe arrancarse con `-pg`:

```bash
java -cp h2-2.x.x.jar org.h2.tools.Server \
  -pg -pgPort 5435 -ifNotExists -baseDir ./data
```

Y conectar con: Host=localhost, Port=5435, User=`sa`, Password=vacío.

## Túnel SSH

¿La base está detrás de un bastión? Cambia a la pestaña **SSH** → activa el túnel:

- SSH host / puerto / usuario
- Autenticación: **contraseña** o **clave privada** (`~/.ssh/id_rsa`, etc.)
- Frase de paso de la clave (si está cifrada)

SkylerX abre el túnel SSH automáticamente y conecta a la base de datos a través de él.

## SSL / TLS

Cambia a la pestaña **SSL** → activa SSL:

- Verificar o no el certificado del servidor
- CA / certificado / clave (pega el PEM o selecciona el archivo)

## Modo de commit manual

`Settings → Modo de commit por defecto` o **por conexión → Avanzado → Modo de commit**:

- `auto` (por defecto): cada SQL se confirma de inmediato
- `manual`: el usuario debe pulsar "Commit / Rollback" explícitamente; SkylerX mantiene una conexión larga para preservar la transacción

Ideal para reparación de datos / migraciones críticas. **Recomendamos manual para conexiones de producción**.

## Probar conexión

Botón "Probar conexión" al pie del formulario → feedback inmediato:
- ✅ Éxito + versión del servidor + latencia de ida y vuelta
- ❌ Fallo + código de error + clasificación automática ("conexión rechazada", "DNS", "timeout", "autenticación", "SSL", etc.) + pasos sugeridos

En el diálogo de fallo, pulsa **"✨ Preguntar a la IA"** y SkylerX enviará el error + metadatos de la conexión al asistente de IA.

## Protección de producción (`env=prod`)

Las conexiones marcadas como prod tienen protecciones extra:

- En el nivel raíz del árbol aparece un badge rojo `[prod]`
- Al ejecutar `DROP TABLE / DATABASE / INDEX` / `TRUNCATE` / `UPDATE/DELETE` sin WHERE, **se exige escribir el nombre de la conexión** para continuar
- La IA responde de forma más conservadora en prod (por defecto estilo SELECT-only)

La etiqueta de entorno es **una configuración puramente local**, no afecta a la base de datos.

## Almacenamiento cifrado de contraseñas

Las contraseñas se cifran con el llavero del SO:

- **macOS**: Keychain Access
- **Windows**: DPAPI (basado en la sesión del usuario actual)
- **Linux**: Secret Service (GNOME Keyring / KWallet)

Si el llavero no está disponible, se hace fallback a base64 con el prefijo visible `plain:` (**advertencia: no es seguro**). **En producción se recomienda encarecidamente** asegurar la disponibilidad del llavero.

## Gestión de grupos

Cada conexión puede colgar de un **grupo** (opcional); el árbol raíz se pliega por grupo:

```
📁 Desarrollo
   ├── MySQL local
   └── PostgreSQL local
📁 Test
   └── OceanBase de test
📁 Producción  ⚠
   └── prod-mysql [prod]
```

Al crear la conexión, basta con escribir el nombre en el campo "Grupo" (Enter para confirmar).

## Múltiples ventanas (consulta paralela de varias conexiones)

⌘⇧N / Ctrl+Shift+N abre una nueva ventana SPA → carga la misma base de configuración; cada ventana conecta por su cuenta sin interferencias.

Perfecto para "prod a la izquierda, staging a la derecha y comparar".

## Eliminar conexión

Clic derecho en la conexión → Eliminar → doble confirmación → se elimina el registro de SQLite y se limpia en el Keychain.

La base de datos **no se ve afectada**; solo desaparece la configuración local en SkylerX.
