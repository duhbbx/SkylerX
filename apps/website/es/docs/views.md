# Vistas alternativas para el resultado

Tras ejecutar un SQL obtienes un resultado y, por defecto, lo ves como una cuadrícula (ver [Cuadrícula de resultados](./grid.md)). Pero a menudo la cuadrícula no es la mejor forma de mirarlo: cien filas de `(month, revenue)` se entienden mil veces mejor como gráfico de líneas. SkylerX añade a la barra de resultados un conjunto de **vistas alternativas**: no se ejecuta de nuevo el SQL, simplemente se reformatea el resultado en memoria.

Esta página explica: **cuándo cambiar de vista, cómo se calcula cada una, qué forma de datos requiere y qué se puede guardar como salida**.

## Cuándo conviene cambiar de vista

| Forma del dato | Vista recomendada | Escenario típico |
|---|---|---|
| Una columna de categoría + una numérica | Barras / pastel / dona | Ventas por ciudad, errores por endpoint |
| Una columna de tiempo + una numérica (continua) | Línea / área | Tendencia de DAU, uso de CPU |
| Dos columnas numéricas (correlación) | Dispersión | Actividad vs retención de usuarios |
| Tres columnas categóricas / numéricas | Tabla dinámica | Canal × mes = ingresos |
| Dos columnas `(lat, lng)` | Dispersión geográfica | Distribución de tiendas, mapa de usuarios |
| Una de tiempo + una de etiqueta | Línea temporal | Eventos de despliegue, ciclo de un pedido |
| `(id, parent_id, ...)` | Árbol con FK auto-referencial | Comentarios anidados, departamentos |
| Varios cambios históricos de la misma fila | Historial de fila | Auditoría de un registro |

Disparador desde la barra inferior (`packages/ui/src/components/ResultGrid.vue:1202-1215`):

```vue
<button :disabled="!result?.rows.length" @click="chartOpen = true">📊 图表</button>
<div class="menu-box">
  <button @click="showViewMenu = !showViewMenu">📐 视图</button>
  <!-- 弹出菜单 -->
  <button @click="altView = 'pivot'">⊞ 透视</button>
  <button @click="altView = 'tree'">🌳 树形</button>
  <button @click="altView = 'geo'">🗺 地理</button>
  <button @click="altView = 'timeline'">⏱ 时间轴</button>
</div>
```

Todas estas vistas se abren como modal; al cerrarlas vuelves a la cuadrícula: son "lupas" para la cuadrícula, no la reemplazan.

## 1. Vista de gráficos (barras / línea / pastel + 4 variantes)

`packages/ui/src/components/ChartDialog.vue`, **630 líneas**, botón: **📊 Gráficos**.

### Decisiones de diseño

Los comentarios del código son sinceros:

> No usamos ECharts; dibujamos SVG a mano (cada uno de barras / línea / pastel ronda las cien líneas) por:
> - El tamaño de la app de escritorio importa; los gráficos son solo una herramienta auxiliar del result grid, no el protagonista
> - Tres tipos cubren el 90% de las inspecciones puntuales; ya habrá tiempo de incorporar ECharts si hace falta más vistosidad
> - El SVG es fácil de exportar a PNG (toDataURL vía `<canvas>`)

Los 7 gráficos están escritos a mano en SVG puro:

| Gráfico | Para qué | Límite | Notas |
|---|---|---|---|
| 📊 Barras (bar) | Comparar valores por categoría | Primeras 50 filas | Redondeo automático del eje Y |
| 📈 Línea (line) | Tendencia / serie temporal | Primeras 200 filas | Path `M / L` |
| 🥧 Pastel (pie) | Proporciones | Primeras 50 filas | Etiquetas automáticas de porcentaje |
| ⛰ Área (area) | Tendencia + magnitud | Primeras 200 filas | Línea cerrada a la baseline |
| ·· Dispersión (scatter) | Nube de puntos discreta | Primeras 200 filas | Puntos circulares |
| ⭕ Dona (donut) | Variante de proporciones | Primeras 50 filas | Anillo externo `r * 1.0`, hueco interno `r * 0.55` |
| 📡 Radar (radar) | Comparativa multidimensional | Primeras 50 filas, mínimo 3 puntos | Un eje por fila |

### Selección de columnas

Tres selectores en la barra superior: **Label** (cualquier columna, `.toString()`), **Value** (auto-detecta columnas numéricas; si no lo es, se etiqueta como `(?)`), **Tipo**. `isNumericColumn` toma las primeras 20 filas y prueba `Number.isFinite(Number(v))`; por defecto Y = primera columna numérica. Al cambiar de result, `watch` resetea las selecciones.

Reglas de datos: las filas cuyo `Number(v)` sea NaN se descartan; si la cantidad supera el límite, solo se usan las primeras N (barras / pastel 50; línea / área / dispersión 200; radar 50).

### Eje Y

Para que la escala se vea "redonda", el máximo se calcula como `Math.ceil(m / 10^floor(log10(m))) * 10^floor(log10(m))`. Las etiquetas se formatean en `B / M / k` (cuando son mayores que 1e9 / 1e6 / 1e4).

### Salida: exportar PNG

Botón a la derecha `⬇ Exportar PNG` → `XMLSerializer` serializa el SVG → un `<canvas>` lo redibuja a 2× HiDPI (fondo oscuro `#1d1e22`) → `canvas.toBlob('image/png')` → pasa por el `SaveFileDialog` propio. Nombre `chart-{kind}-{ts}.png`, resolución 1440×720, perfecto para pegar en Feishu / Slack.

## 2. Tabla dinámica (PivotDialog)

`packages/ui/src/components/PivotDialog.vue`, 162 líneas. Disparador: **📐 Vista → ⊞ Pivot**.

Objetivo: aplicar pivot **en memoria** al resultado actual, sin volver a ejecutar el SQL. El algoritmo no tiene misterio: agrupa filas por `(rowFields...)` → dentro de cada grupo, distribuye por `colField` → en cada cubo aplica `agg`.

### Tres ejes + una función de agregación

| Control | Comportamiento |
|---|---|
| **Filas** (chips multiselección) | Agrupa por estas columnas; la clave se forma con `'\|'` |
| **Columna** (desplegable) | Los valores distintos de esa columna se despliegan como cabeceras (orden lexicográfico) |
| **Valor** + agregación | Aplica la agregación a esa columna en cada celda (row, col) |
| Desplegable de agregación | `COUNT / SUM / AVG / MIN / MAX` |

### Algoritmo

Dos niveles anidados `Map<rowKey, Map<colKey, number[]>>`: se recorre `result.rows`; `rowKey` es la concatenación con `|` de las columnas de `rowFields`; `colKey` es el valor en string de `colField`; `Number(row[valueField])` entra al array. `NULL` se unifica como literal `'NULL'` (entra al mismo grupo). COUNT usa `length`; el resto, agregaciones numéricas.

### Limitaciones

El propio código las admite:

> No se soporta: varios value field, orden personalizado de las columnas (van en lexicográfico), filtros; quedan pendientes para la siguiente versión.

Es decir, si quieres "ordenar por mes 1-12 en lugar de 10, 11, 12, 1, 2...", aún no se puede; antes hay que pasar la columna a string con cero a la izquierda (`'01' / '02' / ...`) en el propio SQL.

### Salida

Es solo una vista temporal de tabla, no se exporta. Para persistir los datos te sugerimos:

- Cerrar el pivot, volver a la cuadrícula → clic derecho copiar → elegir CSV / Markdown y pegar en Excel / Notion
- Reescribir el pivot en SQL: `GROUP BY x WITH ROLLUP` en MySQL / `crosstab()` en PG

## 3. Dispersión geográfica (GeoMapDialog)

`packages/ui/src/components/GeoMapDialog.vue`, 138 líneas. Disparador: **📐 Vista → 🗺 Geo**.

No usamos leaflet ni mapa base, dibujamos los `(lng, lat)` directamente como puntos en SVG. El propio código lo explica:

> Proyección: equidistante (Mercator deforma poco visualmente y, para datos locales, dibujar coordenadas directamente basta; nada de sistemas complejos).
> Lo que no se hace: mapa base (no traemos tiles) y clustering (con demasiados puntos se emborrona, pero se resuelve con zoom).

### Detección automática de columnas

```ts
latCol = cols.find(c => /^(lat|latitude|y)$/i.test(c)) ?? cols[0]
lngCol = cols.find(c => /^(lng|lon|long|longitude|x)$/i.test(c)) ?? cols[1]
labelCol = cols.find(c => /^(name|title|label|id)$/i.test(c)) ?? ''
```

Filtrado por rango numérico (para descartar basura):

```ts
if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue
```

### Encuadre automático

No es el mapa mundial completo; los bounds se calculan para "contener exactamente los puntos + 5% de margen":

```ts
const dx = Math.max(0.001, (maxX - minX) * 0.05)
return { minX: minX - dx, maxX: maxX + dx, ... }
```

En los bordes del SVG aparecen las coordenadas de las cuatro esquinas; al pasar el ratón por un punto se muestra `lat=... lng=...`.

### Salida

Solo navegación visual; no exporta PNG (puede que en la próxima versión). Para una visualización persistente, añade en el SQL una columna de categoría y usa la vista de gráfico (dispersión) para capturarla.

### Requisitos de los datos

| Nombres aceptados | Ejemplo |
|---|---|
| `lat`, `latitude`, `y` | `latitude FLOAT` |
| `lng`, `lon`, `long`, `longitude`, `x` | `lng DECIMAL(9,6)` |
| `name`, `title`, `label`, `id` (etiqueta, opcional) | `store_name VARCHAR` |

Si no coinciden con los nombres estándar también vale: selecciónalos manualmente en los desplegables, siempre que el valor sea numérico y esté dentro del rango.

## 4. Línea temporal (TimelineDialog)

`packages/ui/src/components/TimelineDialog.vue`, 171 líneas. Disparador: **📐 Vista → ⏱ Línea temporal**.

### Detección automática

```ts
timeCol = cols.find(c => /at$|_time$|date|time|created|updated/i.test(c)) ?? cols[0]
labelCol = cols.find(c => /^(name|title|label|id|user|action)$/i.test(c)) ?? ''
colorCol = ''   // opcional: clasifica por esta columna y aplica color
```

Suele acertar columnas como `created_at / updated_at / event_time / order_date / login_time`.

### Parseo del valor temporal (`toMs`)

Admite cuatro formatos:

```ts
function toMs(v: unknown): number | null {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000   // ms or s 启发式
  const ms = Date.parse(String(v))  // ISO / "YYYY-MM-DD HH:MM:SS"
  return Number.isNaN(ms) ? null : ms
}
```

> Los valores por debajo de 1e12 (año 2001) se interpretan como segundos Unix y se multiplican por 1000; por encima, como ms. Para datos de negocio normales sobra; los timestamps anteriores a 1969 pueden malinterpretarse: en ese caso conviértelos en string con `to_char(...)` en el propio SQL.

### Renderizado

Línea temporal horizontal; los eventos alternan arriba/abajo para evitar solapamientos (`i % 2 === 0 ? -16 : +16`); el eje X muestra cinco marcas equidistantes con fechas.

Si especificas la columna **color**, los valores distintos toman 8 colores de la paleta (`#7c6cff / #4caf50 / #e0a020 / #e04050 / #3aa1ff / #b48cff / #67c23a / #ff9966`), y aparece una leyenda abajo. Al pasar el ratón por un punto se muestra `tiempo · label` en la barra inferior de información.

### Requisitos de los datos

Al menos una columna de tiempo (Date / ISO / segundos o milisegundos Unix). Label y Color son opcionales.

## 5. Árbol con FK auto-referencial (TreeViewDialog)

`packages/ui/src/components/TreeViewDialog.vue`, 130 líneas. Disparador: **📐 Vista → 🌳 Árbol**.

Ideal para **claves foráneas auto-referenciales** o datos jerárquicos: comentarios anidados (`comments.parent_id → comments.id`), departamentos (`departments.parent_dept_id → id`), regiones administrativas (`regions.parent_id`).

### Tres ejes

| Selector | Regla de inferencia |
|---|---|
| **id** | Primero `/^id$/i`; si no, la primera columna |
| **parent** | `/parent[_-]?id\|pid/i`; por defecto vacío |
| **label** | `/^(name\|title\|label)$/i`; si no, fallback al id |

### Algoritmo

Dos pasadas: la primera construye el índice por id (`byId: Map<id, node>`); la segunda cuelga los hijos del padre; si el parent id no está en el índice (incluido NULL) la fila se considera raíz. `parent === self` se trata como raíz (para evitar pseudo-registros del tipo `WHERE id=1 AND parent_id=1`).

### Detección de ciclos

`walk(n, depth)` DFS con un `Set<string>` de visitados; si vuelve a aparecer el mismo id, marca `n.cycle = true` y se detiene. Junto al nodo aparece un `⚠` amarillo y el tooltip avisa de "ciclo". Suele ocurrir cuando un cambio manual rompió la jerarquía (lo que debía ser una relación padre-hijo se volvió un ciclo).

### Renderizado

Tras aplanar el árbol, sangra `depth * 18px`; cada nodo muestra `▸ <label> #<id>`. Al pasar el ratón sobre la etiqueta, `title="{json}"` muestra el registro completo (inspección rápida a ojo).

### Requisitos de los datos

Mínimo dos columnas: id + parent; un único `SELECT id, parent_id, name FROM comments WHERE post_id = 1234` te trae el árbol entero y la vista lo renderiza por niveles.

## 6. Historial de cambios de fila (RowHistoryDialog)

`packages/ui/src/components/RowHistoryDialog.vue`, 123 líneas.

Objetivo: **trazabilidad de versiones de una fila** — dada la clave primaria de un registro en una tabla, encontrar todas sus versiones en las tablas espejo `audit / *_history / *_log`.

### Descubrimiento automático de la tabla espejo

Al abrir, ejecuta `SELECT table_name FROM information_schema.tables WHERE table_name LIKE '{base}_%' OR table_name = 'audit_{base}' OR table_name = '{base}_history'`, y carga los candidatos en un `<datalist>`; el usuario elige o teclea.

### Consulta del historial

Tras fijar la tabla espejo, consulta por la PK: `SELECT * FROM {shadow} WHERE {pk}=... ORDER BY changed_at, updated_at, created_at, version, revision DESC LIMIT 200`. El ORDER BY enumera cinco columnas candidatas; la BD usa la que exista (MySQL es tolerante, PG estricto; las tablas de audit habituales tienen al menos una). El resultado se muestra como una mini tabla compacta con cada celda truncada a 80 caracteres.

### Requisitos de los datos

Necesitas la tabla de negocio + una tabla espejo `*_history` / `*_audit` / `*_log` (PK + columnas de negocio repetidas + campos `changed_at / version`). La mayoría de implementaciones con triggers de audit cumplen esta convención.

> Nota de implementación: el diálogo ya está en el repositorio (`Workspace.vue` monta el modal y tiene el estado `rowHistOpen`), pero aún no hay entrada directa desde el menú contextual de la cuadrícula: queda reservada para una próxima integración.

## 7. Linaje de datos (LineageDialog) — versión heurística

`packages/ui/src/components/LineageDialog.vue`, 98 líneas.

El propio código lo aclara desde el principio:

> Linaje de columna (versión heurística): aún no hay un parser SQL real, así que arrancamos con la heurística más simple: si en el texto de un SQL del historial aparece «`{table}.{column}`» o el nombre desnudo `{column}` (siempre que el SQL haga FROM de `{table}`), se considera relacionada.
> Precisión limitada: hay falsos negativos (alias / subconsultas) y falsos positivos (columnas con el mismo nombre). Avisamos claramente al usuario de que es la versión "heurística"; cuando exista el parser SQL, lo sustituiremos por un análisis real.

### Algoritmo

Carga los últimos 500 SQL del historial de la conexión y aplica dos regex con word boundary `\b{table}\b` + `\b{column}\b` sobre cada texto. Si hay match, mira el comienzo: `INSERT / UPDATE` → entra a sinks (escritura); `SELECT / WITH` → entra a sources (lectura).

### Renderizado

Doble columna:

- **← Sinks** — SQLs que **escriben** en esta columna (INSERT / UPDATE)
- **→ Sources** — SQLs que **leen** de esta columna (SELECT / WITH)

Cada fila muestra la hora de ejecución + los primeros 120 caracteres del SQL. Arriba aparece una banda amarilla que recuerda "este es un resultado heurístico, no apto para auditoría".

### Requisitos de los datos

Depende del **historial de consultas** (`client.connections.history`). Si nunca has ejecutado consultas relacionadas en SkylerX, el panel mostrará "No hits".

> Nota de implementación: igual que RowHistoryDialog, está montado en `Workspace.vue` y debe activarse desde fuera (`lineageOpen.value = {...}`); hoy no tiene UI dedicada, queda como API reservada.

## Matriz de soporte

| Vista | Detección automática | Límite de datos | Exportación estática | Re-ejecuta SQL | Recomendada para |
|---|---|---|---|---|---|
| Gráficos (7 tipos) | Sondeo de columnas numéricas | 50 / 200 filas | PNG (2× HiDPI) | No | Ver magnitud / tendencia / proporción |
| Tabla dinámica | Primera / segunda / tercera columna | Según memoria del navegador | Copiar como CSV | No | Agregación cruzada de dos ejes |
| Dispersión geográfica | Alias `lat / lng / x / y` | Sin límite | No | No | Dibujo directo de lat/long |
| Línea temporal | Sufijos `at$ / time / date / created` | Sin límite | No | No | Flujo de eventos + color por categoría |
| Árbol | `id / parent_id / name` | Sin límite | No | No | Jerarquías con FK auto-referencial |
| Historial de fila | Heurística por nombre `*_history / *_audit` | 200 filas (LIMIT del SQL) | No | Sí (consulta la tabla audit) | Trazabilidad de versiones de una fila |
| Linaje de datos | — | Últimos 500 del historial | No | No | Relación lectura/escritura por columna (heurística) |

## Resumen de disparadores

| Vista | Entrada | Notas |
|---|---|---|
| Gráficos | Barra de resultados `📊 Gráficos` | Abre directamente en barras por defecto |
| Pivot / Árbol / Geo / Línea temporal | Barra de resultados `📐 Vista → menú` | Comparten el mismo modal vía `altView` |
| Historial de fila | Disparado vía `rowHistOpen.value = { conn, table, pk }` | Reservado, a la espera de un menú contextual |
| Linaje de datos | Disparado vía `lineageOpen.value = { conn, table, column }` | Reservado, a la espera de un menú contextual |

Al cerrar los modales se vuelve a la cuadrícula original sin perder paginación ni ordenación: solo añaden una "lupa" sobre la cuadrícula, no la sustituyen.

## Mini árbol de decisión

¿Quieres ver **magnitud / ranking / tendencia / proporción**? → Gráfico
- Magnitud vs tiempo → línea / área
- Ranking por categoría → barras
- Proporción → pastel / dona
- Multidimensional → radar

¿Necesitas un **cruce bidimensional** (p. ej. "canal × mes")? → Pivot

Datos con **`(lat, lng)`** → dispersión geográfica

Datos con una **columna de tiempo**:
- Serie continua (DAU diario) → línea
- Eventos discretos (despliegues, alarmas) → línea temporal

Datos con **FK auto-referencial** → árbol

Quieres ver el **historial de una fila** → historial de fila

Quieres saber **quién lee y quién escribe** una columna → linaje (heurístico, úsalo con cautela)

Con esto cubrimos todas las vistas alternativas sobre el resultado. Si tu dato no encaja en ninguna, en el 90% de los casos basta reescribir el SQL para meterlo en alguna vista; si no, vuelve a la cuadrícula y usa Copiar para pegar en Excel / Numbers / Notion.

Para ver el comportamiento del SQL en sí (slow log, EXPLAIN, recomendación de índices), ve a [Avanzado e ingeniería](./advanced.md); para importar/exportar datos, ve a [Migración de datos](./databases.md).
