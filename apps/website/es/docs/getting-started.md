# Guía rápida

De la descarga a tu primera consulta en 5 minutos.

## 1. Descargar e instalar

Ve a la [página de descargas](/es/download) y elige el instalador de tu plataforma:

- **macOS**: archivo `.dmg`, arrástralo a Applications
- **Windows**: asistente `.exe`, pulsa Next hasta el final
- **Linux**: `.AppImage` (sin instalación, `chmod +x` y a correr) o `.deb` / `.rpm` (`sudo dpkg -i` / `sudo rpm -ivh`)

En el primer arranque se inicializa automáticamente la base de configuración local (SQLite, ubicada en el directorio estándar de datos de usuario del SO).

## 2. Crear la primera conexión

Inicia la aplicación → arriba a la izquierda "Nueva conexión" (⌘N / Ctrl+N) → elige dialecto.

### MySQL / PostgreSQL y otros dialectos principales

| Campo | Ejemplo |
|---|---|
| Nombre de la conexión | BD de desarrollo local |
| Dialecto | MySQL |
| Host | 127.0.0.1 |
| Puerto | 3306 (por defecto en MySQL) |
| Usuario | root |
| Contraseña | (tu contraseña) |
| Base de datos | (opcional, déjala vacía para elegir tras conectar) |
| Etiqueta de entorno | dev / test / prod |

Pulsa "Probar conexión" → si tiene éxito, pulsa "Guardar".

### Oracle / tenant OB Oracle

Oracle exige Service Name (por defecto `XEPDB1`; el contenedor `gvenzl/oracle-free` usa `FREEPDB1`):

| Campo | Ejemplo |
|---|---|
| Dialecto | Oracle |
| Host | 127.0.0.1 |
| Puerto | 1521 |
| Usuario | system |
| Contraseña | oracle |
| Base / Service | FREEPDB1 |
| Avanzado → privilege | (vacío = normal) o SYSDBA / SYSOPER, etc. |

### Bases de datos chinas 信创

- **达梦 DM**: puerto 5236, requiere instalar el paquete npm `dmdb` (`pnpm -F @db-tool/desktop add dmdb`)
- **KingbaseES (人大金仓)**: puerto 54321 (por defecto), compatible PG, sin driver adicional
- **openGauss**: compatible PG, sin driver adicional
- **OceanBase**: puerto 2881, usa mysql2; los tenants Oracle también se conectan con este dialecto

Descripción detallada de campos en [Gestión de conexiones →](/es/docs/connections)

## 3. Explorar el árbol de navegación

En la lista de conexiones **haz doble clic en la conexión** → el árbol de la izquierda se despliega automáticamente:

```
📦 BD de desarrollo local (MySQL)
  └── 📁 mydb
       ├── 📁 Tablas (12)
       │    ├── users
       │    ├── orders
       │    └── ...
       ├── 📁 Vistas (3)
       ├── 📁 Funciones (1)
       └── 📁 Procedimientos (0)
```

**Doble clic en el nombre de la tabla** → abre la cuadrícula de datos por defecto (SELECT de las primeras 200 filas, modificable en [Settings → Tamaño de página predeterminado]).

## 4. Escribir SQL y ejecutar

- Pulsa "Nueva consulta" en la barra o ⌘T / Ctrl+T para abrir una pestaña SQL
- Monaco autocompleta nombres de tabla, columna y palabras clave
- ⌘+Enter / Ctrl+Enter ejecuta (si hay selección, solo ejecuta lo seleccionado)
- El resultado aparece en la cuadrícula inferior

### Algunos atajos habituales

| Acción | macOS | Windows / Linux |
|---|---|---|
| Paleta de comandos | ⌘K | Ctrl+K |
| Búsqueda global de objetos | ⌘⇧O | Ctrl+Shift+O |
| Ejecutar SQL | ⌘+Enter | Ctrl+Enter |
| Formatear SQL | ⌘⇧F | Ctrl+Shift+F |
| Mostrar/ocultar chat de IA | ⌘⇧L | Ctrl+Shift+L |
| Nueva ventana (segunda sesión) | ⌘⇧N | Ctrl+Shift+N |

Todos los atajos son personalizables en `Settings → Atajos de teclado`.

## 5. Configurar el asistente de IA (opcional)

`Settings → AI Provider` → añade cualquier proveedor soportado:

- Anthropic (familia Claude)
- OpenAI (GPT-4 / familia o1)
- DeepSeek
- Codex
- Grok / xAI

Una vez añadida la API Key, puedes:
- Usar el panel de chat lateral (⌘⇧L)
- Tener autocompletado en línea estilo Copilot dentro del editor
- En cualquier diálogo de error, pulsar "✨ Preguntar a la IA" para diagnóstico automático
- Acceder a 7 Toolboxes especializados (migraciones / tuning / leer EXPLAIN / generar datos de prueba / lenguaje natural → SQL / escribir comentarios / interpretar el propósito de la tabla)

## 6. Llevarlo más lejos

- [Editor SQL en profundidad](/es/docs/query) — autocompletado / snippets / EXPLAIN
- [Cuadrícula de resultados](/es/docs/grid) — modo edición / filtros / coloreado / exportación
- [Asistente de IA](/es/docs/ai) — configuración de providers / sistema de memoria / detalle de Toolboxes
- [Resolución de problemas y compatibilidad](/es/docs/troubleshooting) — diagnóstico automático de ORA-xxx / SQLSTATE

## ¿Tienes problemas?

- En cualquier diálogo de error de la app pulsa "**✨ Preguntar a la IA**"; SkylerX envía SQL + mensaje de error + metadatos de la conexión a la IA
- Si no se resuelve: [GitHub Issues](https://github.com/duhbbx/SkylerX/issues)
