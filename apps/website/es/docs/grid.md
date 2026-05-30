# Cuadrícula de resultados

Después de ejecutar el SQL, los resultados aparecen en la cuadrícula inferior.

## Paginación + scroll virtual

- Por defecto 200 filas por página, configurable en `Settings → Tamaño de página predeterminado`
- Para resultados grandes (> 10000 filas) se activa automáticamente el **scroll virtual**, renderizando solo las filas visibles: 1 millón de filas siguen siendo fluidas
- Paginador inferior: primera / anterior / siguiente / última + caja para saltar

## Modo de edición

Los `SELECT` de una sola tabla son editables por defecto (se desactiva si se detecta JOIN / agregación):

### Editar una celda

- **Doble clic en la celda** → entra al instante en modo edición (cursor enfocado + texto existente seleccionado, basta con teclear para reemplazar)
- El input se ajusta exactamente al ancho y alto de la celda, WYSIWYG
- Enter confirma / Esc cancela
- Las celdas modificadas se marcan con fondo distintivo como dirty

### Añadir una fila

- "➕ Añadir fila" en la barra o teclea directamente en la fila vacía del final de la cuadrícula
- Edición multicolumna: Tab pasa a la siguiente columna
- Deja la clave primaria vacía → valor por defecto / autoincremento de la BD

### Eliminar filas

- Selecciona las filas (multiselección) → "🗑 Eliminar selección" en la barra
- La fila completa queda marcada en rojo como dirty

### Deshacer / Confirmar

- "↺ Deshacer" revierte todos los cambios sin confirmar
- "✓ Confirmar" abre el diálogo "Previsualización SQL":
  ```sql
  UPDATE users SET email='new@x.com' WHERE id=42;
  INSERT INTO users (name, email) VALUES ('Bob', 'bob@x.com');
  DELETE FROM users WHERE id=99;
  ```
- Tras la confirmación del usuario, **se aplica como una transacción única**; si falla se hace ROLLBACK automático y se conservan los cambios sin perderse

## Aspecto de las celdas

- **NULL** → fondo gris con la palabra `NULL`
- **Cadena vacía** → marcador `''` en gris claro
- **Texto largo** → trunca con elipsis + tooltip
- **JSON** → fuente monoespaciada + resaltado por color (objetos / arrays / literales)
- **BLOB** → detección automática de imagen (PNG / JPEG / GIF / WEBP por encabezado); si no, muestra `<BLOB N bytes>` + previsualización hex
- **Columnas numéricas** → en la cabecera aparece un mini sparkline con la tendencia de la página
- **Celda nula / números grandes** → coloreado condicional por defecto (desactivable en Settings)

## Operaciones de columna

### Menú contextual de la cabecera

- Copiar nombre de la columna
- Ordenar por esta columna ascendente / descendente / quitar orden
- Ocultar / mostrar
- Añadir filtro
- Añadir campo referenciado (si es FK, trae una columna de la tabla referenciada para mostrarla)

### Ancho de columna

Arrastra el borde de la cabecera; **doble clic en el borde** ajusta automáticamente al contenido.

## Filtrado

Botón 🔍 de la barra o clic derecho en la cabecera → Añadir filtro, soporta:

- Cadena: contains / startsWith / regex
- Número: `= != < > between`
- Fecha: rango
- Booleano: marcar / desmarcar
- NULL: `IS NULL` / `IS NOT NULL`

Varias columnas se combinan con AND; **filtro multivalor estilo Excel**: pulsa ⋯ arriba a la derecha de la cabecera → lista de valores distintos con checkboxes.

## Ordenación

- Clic en la cabecera: ascendente → descendente → quitar
- Multi-columna: mantén Shift al hacer clic en orden

## Copiar

Selecciona el rango → ⌘C / Ctrl+C → copia (TSV por defecto).

Botón "Copiar como":
- CSV
- TSV
- Array JSON
- Tabla Markdown
- SQL `VALUES (...)` (cómodo para pegar en un INSERT)
- SQL `INSERT INTO ...` (sentencia completa)

## Exportar

Botón "Exportar" en la barra → diálogo de selección de formato:

- **CSV / TSV** — separadores de fila / campo personalizables
- **JSON / NDJSON** — array / un documento por línea
- **Excel .xlsx** — usa SheetJS real, conserva fórmulas y estilos
- **Markdown / HTML** — tabla + estilos opcionales
- **SQL INSERT** — cómodo para mover toda una tabla a otra BD
- **.skbk cifrado** (experimental) — AES-256-GCM + PBKDF2, **datos cifrados al salir**

## Salto por clave foránea

- Clic derecho en una celda → "Saltar a fila referenciada" — localiza automáticamente la tabla referenciada + condición WHERE
- Clic derecho en una celda → "Ver referencias inversas" — qué tablas / filas referencian este valor

## Menú contextual de celda — Preguntar a la IA / búsqueda entre tablas

Clic derecho sobre una celda:

- Copiar
- Saltar a fila referenciada / Ver referencias inversas
- **Buscar el valor entre tablas** — si este valor aparece en otro sitio de la base
- **Preguntar a la IA** — envía a la IA el error o los datos anómalos seleccionados para que los analice

## Múltiples vistas

Selector de vistas en la barra superior derecha:

- **Cuadrícula** (por defecto)
- **JSON** (JSON crudo, útil para depuración)
- **Formulario** (cuando hay una sola fila con muchas columnas, formulario vertical label-value para editar)
- **Tabla dinámica**
- **Árbol con FK auto-referencial** (jerarquías como comentarios / departamentos)
- **Dispersión geográfica** (detecta automáticamente las columnas lat/long)
- **Línea temporal** (columna de tiempo + numérica → línea / barras)
- **Gráficos** (barras / líneas / pastel, exportable a PNG)
