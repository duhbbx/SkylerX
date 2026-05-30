# Seguridad y cumplimiento

SkylerX se diseña para entornos dev / test / prod a la vez e incorpora un modelo de seguridad extremo a extremo, **desde las credenciales hasta el renderizado del resultado, desde el envío del SQL hasta las exportaciones masivas**. Esta página repasa cada línea de defensa que realmente está en el código: qué hace, qué no hace y qué evidencias puede dejar para operaciones y auditoría.

## 1. Resumen

El modelo de seguridad se reparte en cinco etapas según el "flujo del dato", cada una con su propio respaldo en código:

| Etapa | Módulo / fichero | Responsabilidad principal |
|---|---|---|
| Persistencia de credenciales | `apps/desktop/src/main/db/connectionStore.ts` | Cifrado de contraseñas y claves SSH con el llavero del SO (Electron `safeStorage`) |
| Identificación de entorno | `packages/ui/src/connEnv.ts` | Etiquetas tricolor dev / test / prod + conexión solo lectura + whitelist de lectura |
| Interceptación de sentencias | `packages/ui/src/sqlLint.ts` | 7 reglas heurísticas (UPDATE/DELETE sin WHERE, DROP/TRUNCATE en prod, etc.) |
| Presentación del dato | `packages/ui/src/masking.ts` + `DataMaskingViewDialog` | Matching por nombre de columna → masking en render + vistas de desensibilización en BD |
| Gobierno / auditoría | `compliance.ts` / `PiiScannerDialog` / `DataContractDialog` / `export-encrypt.ts` | Comprobaciones de cumplimiento, escaneo PII, contratos de datos, exportación cifrada |

A continuación, cada bloque tal y como está en el código.

## 2. Cifrado de contraseñas de conexión (llavero del SO)

Ubicación: `apps/desktop/src/main/db/connectionStore.ts`.

Al crear/editar una conexión, la contraseña no se guarda en plano en la SQLite; pasa por `safeStorage` de Electron (macOS = Keychain, Windows = DPAPI, Linux = libsecret / kwallet):

```ts
function encryptPassword(plain?: string): string | null {
  if (!plain) return null
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(plain).toString('base64')}`
  }
  return `plain:${Buffer.from(plain, 'utf8').toString('base64')}`
}
```

Los campos almacenados llevan un prefijo para identificar la versión:

| Prefijo | Significado | Cuándo aparece |
|---|---|---|
| `enc:` | Cifrado con llavero del SO | Camino normal en macOS / Windows / la mayoría de Linux |
| `plain:` | base64 de respaldo (**solo dev**) | Cuando `safeStorage.isEncryptionAvailable()` devuelve `false`; típico en contenedores Linux mínimos sin libsecret/kwallet |
| Otro | Compatibilidad con versiones anteriores sin prefijo | Datos históricos |

> **Importante:** si ves `plain:`, SkylerX sigue funcionando, pero **es equivalente a texto plano**. En Linux, instala `gnome-keyring` o `kwallet` y pídele al usuario que reedite la conexión (cualquier cambio guardará y forzará el recifrado).

### Claves para túnel SSH

La configuración SSH incluye `password` / `privateKey` / `passphrase`, y todas usan la misma cadena de cifrado. **Al listar las conexiones (`listConnections`) se eliminan estos campos** para no llevar secretos redundantes en memoria:

```ts
function decryptSsh(stored, withSecrets) {
  const ssh = JSON.parse(decryptPassword(stored)) as SshConfig
  return withSecrets
    ? ssh
    : { ...ssh, password: undefined, privateKey: undefined, passphrase: undefined }
}
```

Solo al conectar realmente o al rehidratar el formulario de edición (`getConnection`) se devuelven las claves completas.

## 3. Etiqueta de entorno dev / test / prod + protección de producción

Ubicación: `packages/ui/src/connEnv.ts`.

El campo `extra.env` de la conexión guarda una enumeración tristate:

| Valor | Etiqueta UI | Color (`ENV_META.color`) | Severidad por defecto |
|---|---|---|---|
| `dev` | Desarrollo | `#4caf50` verde | Estándar |
| `test` | Test | `#e0a020` naranja | Estándar |
| `prod` | Producción | `#e04050` rojo | **Activa reglas SQL extra + doble confirmación antes de ejecutar** |

### Conexión completa de solo lectura (`extra.readOnly`)

`connReadOnly()` la etiqueta. SkylerX revisa por dos vías independientes:

1. **A nivel de conexión**: `isReadOnlyStatement(sql)` aplica una whitelist por primera palabra clave (`select` / `with` / `show` / `explain` / `desc(ribe)` / `pragma`) y bloquea las que no estén.
2. **Modo de commit**: una conexión de solo lectura fuerza `auto` (las transacciones manuales no aplican); ver `initialCommitMode()`.

### Marca de agua en producción

`Settings → Marca de agua` permite personalizar texto / ángulo / opacidad / color; las conexiones prod muestran una marca SVG sobre el editor SQL, la cuadrícula de resultados y los previews de exportación, dificultando la difusión por capturas.

## 4. SQL Linter — 7 reglas integradas

Ubicación: `packages/ui/src/sqlLint.ts`.

Escaneo heurístico por cadena, sin parser completo; solo detecta patrones "obviamente peligrosos". Tres niveles:

| Severidad | Feedback UI | ¿Ejecuta? |
|---|---|---|
| `error` | Diálogo modal de doble confirmación | Se ejecuta solo si el usuario confirma |
| `warn` | Toast | **Sí ejecuta** (solo avisa) |
| `info` | Decide la integración (badge en el sidebar del editor) | Sí ejecuta |

Tabla completa:

| ID | Severidad | Disparador | Mensaje |
|---|---|---|---|
| `no-where-update` | error | `UPDATE` + sin `WHERE` | UPDATE sin WHERE: actualizará la tabla entera |
| `no-where-delete` | error | `DELETE FROM` + sin `WHERE` | DELETE sin WHERE: vaciará la tabla |
| `prod-drop` | error | conexión env=prod + `DROP TABLE/DATABASE/SCHEMA/INDEX/VIEW` | DROP XXX en producción |
| `prod-truncate` | warn | conexión env=prod + `TRUNCATE` | TRUNCATE en producción |
| `cross-join` | warn | `SELECT` + `FROM a, b` (JOIN por coma) o `JOIN` sin `ON/USING` | Multitabla sin condición de unión (posible producto cartesiano) |
| `select-star` | info | `SELECT *` | SELECT *: mejor enumerar columnas |
| `forgotten-limit` | info | `SELECT` sin `LIMIT` / `FETCH FIRST` / `TOP n` / `COUNT()` | SELECT sin LIMIT: podría traer demasiadas filas |

### Restricciones "baratas"

Para descartar comentarios se usan dos regex sencillas (`/\/\*[\s\S]*?\*\//g` y `/--[^\n]*/g`); así un `-- WHERE 1=1` falso no engaña al linter. Todas las reglas son O(n) sobre la cadena; pueden correr en la ruta crítica sin penalizar al usuario.

### Agregación de múltiples sentencias

`lintStatements(stmts, ctx)` conserva un único hallazgo por id, quedándose con la severidad más alta; perfecto para "selecciono y ejecuto un archivo entero".

## 5. Contratos de datos (notNull / range / regex)

Ubicación: `packages/ui/src/components/DataContractDialog.vue`.

Un contrato de datos define a priori qué valores no deben aparecer en un campo. Cuatro partes:

| Campo | Tipo | Descripción |
|---|---|---|
| `name` | string | Nombre del contrato |
| `table` | string | `schema.table` al que aplica |
| `notNull` | `string[]` | Columnas que no pueden ser NULL |
| `range` | `Record<string, [min, max]>` | Rango numérico; `null` = sin límite |
| `regex` | `Record<string, string>` | Regex obligatorio para el valor |
| `enabled` | boolean | Interruptor de activación |

Se guarda en `localStorage.skylerx.dataContracts` como array JSON.

### Uso típico

```json
{
  "name": "用户表完整性",
  "table": "public.users",
  "notNull": ["phone", "email"],
  "range": { "age": [0, 150] },
  "regex": { "email": "^[^@]+@[^@]+$", "phone": "^1\\d{10}$" },
  "enabled": true
}
```

### Importar / Exportar

- **📋 Exportar** → copia el JSON al portapapeles, lo puedes pegar en doc compartido / git
- **📥 Importar** → pega un JSON y sobrescribe la lista actual

De este modo, el DBA puede repartir los contratos por equipo / proyecto y los desarrolladores los obtienen al importarlos en su SkylerX.

## 6. Escaneo de campos sensibles (PII Scanner)

Ubicación: `packages/ui/src/components/PiiScannerDialog.vue`.

Heurística en dos pasos: **matching por nombre de columna → verificación por muestreo**.

### Paso de matching por nombre

Usa la regex `columnPattern` de `DEFAULT_MASK_RULES` (ver siguiente sección). Por ejemplo, una columna `user_phone` cae en `(phone|mobile|tel|手机|电话)` y se clasifica como `phone`.

### Paso de verificación por muestreo (opcional)

Para las columnas detectadas, toma las primeras N filas (50 por defecto, ajustable 10-1000) y aplica regex de confirmación:

| kind | Regex de verificación |
|---|---|
| `phone` | `/^\+?[\d\s\-()]{7,20}$/` |
| `email` | `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` |
| `idCard` | `/^\d{15}$\|^\d{17}[\dxX]$/` |
| `bankCard` | `/^\d{12,19}$/` |
| `name` / `address` / `default` | Sin verificación; solo por nombre |

Si el porcentaje de aciertos es < 30%, se descarta como "coincidencia de nombre, no PII real" y se quita del informe.

### Informe y siguientes pasos

El informe se agrupa por tabla en orden descendente de hits; se puede **📋 Exportar CSV** (columnas: schema/table/column/data_type/rule/kind/sample). El CSV vale para auditoría; también puedes clic derecho en la base → "Generar vista de desensibilización" sobre esas columnas.

## 7. Vistas de desensibilización (DataMaskingViewDialog)

Ubicación: `packages/ui/src/masking.ts` + `packages/ui/src/components/DataMaskingViewDialog.vue`.

### 7.1 Reglas predeterminadas

`DEFAULT_MASK_RULES` es la base; el usuario puede borrar / cambiar / añadir reglas en `Settings → Desensibilización`.

| Regla | columnPattern | kind | Activa por defecto | Algoritmo |
|---|---|---|---|---|
| Teléfono | `(phone\|mobile\|tel\|手机\|电话)` | phone | ✅ | 3 iniciales + `****` + 4 finales |
| Email | `(email\|mail\|邮箱)` | email | ✅ | Inicial + `***@domain` |
| DNI | `(id_?card\|身份证\|idno)` | idCard | ✅ | 6 iniciales + `*…` + 4 finales |
| Tarjeta bancaria | `(bank_?card\|card_?no\|账号\|账户)` | bankCard | ✅ | 4 + ` **** **** ` + 4 |
| Nombre | `(real_?name\|user_?name\|full_?name\|姓名)` | name | ❌ | Inicial + `*` (resto oculto) |
| Dirección | `(address\|addr\|地址)` | address | ❌ | 6 iniciales + `***` |
| Password / Token | `(password\|passwd\|secret\|pwd\|token\|api_?key\|密码)` | default | ✅ | 2 iniciales + `****` + 2 finales |

### 7.2 Masking al renderizar vs. vista de desensibilización en BD

SkylerX ofrece dos caminos independientes:

- **Masking en render**: `Settings → Desensibilización → Activar`. El frontend aplica regla → algoritmo al vuelo; **no toca la BD**, y al exportar puedes elegir "original / enmascarado" en el diálogo.
- **Vista de desensibilización en BD** (`DataMaskingViewDialog`): genera SQL `CREATE OR REPLACE VIEW ... AS SELECT mask_expr(c) ...` y la aplicación lee desde la vista, no de la tabla original. Seis estrategias:

| Estrategia | Expresión SQL (ejemplo MySQL) |
|---|---|
| `raw` original | `` `c` AS `c` `` |
| `md5` | `` md5(CAST(`c` AS char(4000))) AS `c` `` |
| `partial` N inicio + M fin | `` CONCAT(LEFT(`c`,N), '***', RIGHT(`c`,M)) AS `c` `` |
| `fixed` valor fijo | `'***' AS \`c\`` |
| `truncate` truncar | `` LEFT(`c`, max) AS `c` `` |
| `null` | `` NULL AS `c` `` |

Al abrir el diálogo, `recommendStrategy(colName)` sugiere por nombre; el usuario puede sobreescribir por columna. El SQL se puede editar antes de pulsar ▶ Crear vista.

## 8. Comprobación de cumplimiento (Cumplimiento GB17859, 等保 2.0)

Ubicación: `packages/ui/src/compliance.ts` + `packages/ui/src/components/ComplianceDialog.vue`.

Solo cubre lo que se puede verificar desde la conexión a la BD; no entra en firewall / cifrado de disco u otros aspectos del SO. Cuatro estados:

| Severidad | Significado |
|---|---|
| `pass` ✅ | Cumple |
| `warn` ⚠️ | No cumple, pero riesgo controlable (audit log no habilitado, SSL apagado, etc.) |
| `fail` ❌ | Incumplimiento grave (root remoto abierto, usuarios sin contraseña, etc.) |
| `unknown` — | No se puede determinar (permisos insuficientes o función solo disponible en versión comercial) |

### Familia MySQL (MySQL / MariaDB / OceanBase / TiDB) — 7 reglas

| ID | Categoría | Título | Detección |
|---|---|---|---|
| `mysql.auth.password-policy` | Identidad | Política de contraseñas fuertes | `SHOW VARIABLES LIKE 'validate_password%'`, policy ≥ MEDIUM y length ≥ 8 |
| `mysql.audit.enabled` | Auditoría | Audit log activado | `audit_log_*` (enterprise) o `server_audit_*` (MariaDB) |
| `mysql.auth.root-remote` | Control de acceso | root sin acceso remoto | `SELECT user, host FROM mysql.user WHERE user='root'` |
| `mysql.auth.anonymous` | Control de acceso | Sin usuarios anónimos | `mysql.user WHERE user=''` |
| `mysql.transport.ssl` | Integridad | SSL obligatorio en transporte | `require_secure_transport=ON` |
| `mysql.audit.slowlog` | Auditoría | Slow query log activado | `slow_query_log=ON` |
| `mysql.integrity.binlog` | Integridad | binlog habilitado | `log_bin=ON` (prerrequisito para PITR / replicación) |

### Familia PostgreSQL (PG / KingbaseES / openGauss / Greenplum / CockroachDB) — 6 reglas

| ID | Categoría | Título | Detección |
|---|---|---|---|
| `pg.auth.password-encryption` | Identidad | Cifrado SCRAM-SHA-256 | `SHOW password_encryption` |
| `pg.audit.pgaudit` | Auditoría | Extensión pgaudit instalada | `pg_extension WHERE extname='pgaudit'` |
| `pg.transport.ssl` | Integridad | SSL activado | `SHOW ssl` |
| `pg.access.superuser-count` | Control de acceso | Número limitado de superusuarios (≤ 2) | `SELECT rolname FROM pg_roles WHERE rolsuper` |
| `pg.audit.log-statement` | Auditoría | log_statement configurado | `SHOW log_statement` ≠ none |
| `pg.auth.empty-password` | Identidad | Sin usuarios con contraseña vacía | `pg_authid WHERE rolpassword IS NULL AND rolcanlogin` |

### Exportación del informe Markdown

**Exportar Markdown** llama a `renderReport()`; agrupa por categoría, añade una línea de resumen "Resumen: ✅ N · ⚠️ N · ❌ N · — N" y, por regla, su descripción, conclusión y `evidence`. El nombre incluye conexión y timestamp: `compliance-<safeName>-<YYYY-MM-DDTHH-MM-SS>.md`.

### Ejecución concurrente

"Iniciar comprobación" lanza `Promise.all` para correr todas las reglas en paralelo; los fallos no afectan al resto (`try/catch` → `unknown`); el driver hace su propio pooling/reuso.

### Otros dialectos

Los dialectos que no son MySQL ni PG muestran un placeholder:

```
El dialecto actual no tiene comprobaciones de cumplimiento — confirmar manualmente
```

Se añadirán Oracle / SQL Server / SQLite / DM cuando haga falta.

## 9. Cifrado nacional chino SM2 / SM3 / SM4 (planificado)

En el conjunto de reglas de cumplimiento ya está como criterio "`password_encryption=md5` se considera débil por GB17859 / 国密" (ver `pg.auth.password-encryption`). Las APIs auxiliares SM2 / SM3 / SM4 (para firma/cifrado a nivel de aplicación antes de persistir) **aún no se han publicado**; el plan es entregar un `cryptoCn.ts` independiente en v0.6:

- SM2 (curvas elípticas) firma / cifra / descifra (basado en sm-crypto)
- SM3 digest
- SM4 bloque simétrico (CBC / ECB)

Cuando la API se estabilice, se documentará en esta página en el apartado "APIs auxiliares de 国密".

## 10. Exportación cifrada .skbk

Ubicación: `packages/ui/src/export-encrypt.ts`.

Cifra cualquier texto (típicamente dump SQL o configuración de conexiones) con una contraseña, generando un JSON de una sola línea con extensión `.sql.enc` / `.skbk`.

### Cadena de algoritmos

| Etapa | Algoritmo | Parámetros |
|---|---|---|
| Derivación de clave | PBKDF2-HMAC-SHA-256 | iter = `DEFAULT_ITER` = **200 000** (ajustable; queda en la cabecera) |
| Cifrado | AES-GCM 256 | salt 16B + iv 16B, renovados cada vez |
| Integridad | Auth tag de 128 bits propio de AES-GCM | Contraseña errónea / archivo modificado → `WRONG_PASSWORD` |
| Cabecera | `magic: 'SKYLERX-ENC-v1'` | Identifica la versión al cambiar algoritmo/parámetros |

> **Por qué 200 000 iteraciones**: OWASP 2023 recomienda SHA-256 ≥ 600 000, pero el cliente de escritorio debe convivir con máquinas viejas (un Atom haría 1+ s con 600k). Para contenido muy sensible, sube manualmente `iter` al llamar a `encryptText`.

### Formato persistido

```json
{
  "magic": "SKYLERX-ENC-v1",
  "salt": "<base64 16B>",
  "iv":   "<base64 16B>",
  "iter": 200000,
  "data": "<base64 ciphertext + tag>"
}
```

Orden de campos fijo (cómodo para git diff); una sola línea, ideal para streaming.

### Códigos de error

| Error | Cuándo se lanza | Reacción UI |
|---|---|---|
| `INVALID_BLOB` | Faltan campos / tipo erróneo / `magic` no coincide | Aviso "Archivo corrupto" |
| `WRONG_PASSWORD` | Falla el auth tag de AES-GCM (contraseña errónea o archivo alterado) | Aviso "Contraseña incorrecta" (sin distinguir, para no filtrar el motivo) |

### Dependencia de Web Crypto

Todo va por `globalThis.crypto.subtle`, sin dependencias externas. Funciona en el renderer de Electron, en navegadores modernos y en Node 18+ (para tests). Entornos muy antiguos lanzan `Web Crypto API unavailable: upgrade to Node 18+ or a modern browser`.

## 11. Límite de privacidad con la IA

El asistente de IA (Anthropic / OpenAI / DeepSeek / Codex / Grok) es la pieza estrella de SkylerX, pero lo que envía a APIs externas se ciñe **al contexto estrictamente necesario**:

| Tipo | ¿Se envía? | Nota |
|---|---|---|
| Texto SQL actual | ✅ | Es la base de toda interacción / autocompletado iniciado por el usuario |
| Hints de schema (nombres de base / tabla / columna) | ✅ | Solo metadatos, **no se envían filas de datos** |
| Cuerpo del error + código | ✅ | Para "Preguntar a la IA", ver sección 4 del documento `AI` |
| Metadatos de la conexión (dialecto / nombre / base) | ✅ | Ayuda a la IA a usar el dialecto correcto |
| **Filas de resultado** | ❌ | Aunque el autocompletado IA esté activado, solo se mandan hints de schema, no las filas del SELECT |
| **Contraseña de conexión / clave privada SSH** | ❌ | El texto cifrado del keychain nunca se lee como prompt |
| **Configuración local de conexiones completa** | ❌ | Solo se toma `dialect / database` de la conexión activa |

Para aislar la IA por completo:

1. `Settings → AI Provider → vaciar API Key` → autocompletado / chat / Preguntar a la IA quedan desactivados
2. Usa un endpoint local (Ollama / vLLM / despliegue privado) y cambia el campo `endpoint` a `http://localhost:...`

> **Los webhooks de notificación con IA** siguen la misma regla: por defecto envían "título + resumen + hora de disparo", sin filas SQL. Lo puedes ajustar en la plantilla de `Settings → Notificaciones`.

## 12. Atajos a funciones de seguridad

| Acción | Entrada |
|---|---|
| Comprobación de cumplimiento GB17859 (等保 2.0) | ⌘K → "Cumplimiento GB17859 · nombre de conexión" / clic derecho en la conexión → Cumplimiento |
| Escaneo PII | Clic derecho en la base → PII Scanner |
| Generar vista de desensibilización | Clic derecho en base / tabla → Generar vista de desensibilización |
| Contratos de datos | ⌘K → "Contratos de datos" / Herramientas → Contratos de datos |
| Exportación cifrada | Resultado / Editor SQL → Exportar → elige `.skbk` |
| Políticas de seguridad globales | `Settings → Desensibilización` / `Settings → Marca de agua` |
| Atajos personalizados (anti error de pulsación) | `Settings → Atajos` |

## 13. Limitaciones conocidas

Cosas que el DBA debe tener presentes según el código actual:

- **El SQL Linter es heurístico**: sin parser SQL completo, el escaneo por cadena puede fallar en casos raros (comentarios `/* ... */` anidados + literales que incluyan `where`). Para operaciones críticas, mantén también la doble confirmación en prod (escribir el nombre de la conexión).
- **Las comprobaciones de cumplimiento requieren permisos de lectura**: `mysql.user` necesita SELECT; `pg_authid` necesita superusuario; sin permiso, la regla cae en `unknown` en lugar de `fail`; **no equipares `unknown` a `pass`**.
- **El masking en render solo vive en UI**: en la BD sigue el texto original. Para evitar de raíz que la aplicación lea el original, usa vistas de desensibilización en BD y restringe los permisos del usuario.
- **El archivo cifrado no es inmune a fuerza bruta**: 200k iteraciones de PBKDF2 dan un coste ~10^7; una contraseña débil sigue siendo crackeable offline. Usa contraseñas fuertes o distribuye con KMS / clave pública dentro del equipo.
- **La etiqueta de entorno es una restricción blanda**: `extra.env = 'prod'` lo rellena el usuario al guardar la conexión; si por error elige `dev`, no se activan las reglas exclusivas de prod. Para estandarizarlo, comparte la configuración por "exportar conexiones → compañeros importan".
