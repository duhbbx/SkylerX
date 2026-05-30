# 结果集的替代视图

执行 SQL 拿到一份结果集,默认看到的是网格(参见 [结果集网格](./grid.md))。但很多时候网格不是最好的看法 — 一百行 `(month, revenue)` 看趋势,折线图比表格直观一万倍。SkylerX 在结果工具栏里塞了一组**替代视图**,数据不重跑,直接在内存里把当前结果集换种形态显示。

本页讲清楚:**何时换视图、各视图怎么算、要求什么样的数据形状、产出能保存为什么**。

## 何时换视图比看网格更直观

| 数据形态 | 推荐视图 | 典型场景 |
|---|---|---|
| 一列分类 + 一列数值 | 柱图 / 饼图 / 环形 | 销售按城市、错误按 endpoint |
| 一列时间 + 一列数值(连续) | 折线 / 面积 | DAU 趋势、CPU 占用 |
| 两列数值(关联性) | 散点 | 用户活跃 vs 留存 |
| 三列分类 / 数值 | 透视表 | 渠道 × 月份 = 收入 |
| `(lat, lng)` 两列 | 地理散点 | 门店分布、用户地图 |
| 一列时间 + 一列 label | 时间轴 | 部署事件、订单生命周期 |
| `(id, parent_id, ...)` | 自引用 FK 树 | 评论楼中楼、组织部门 |
| 同一行的多次历史 | 行变更历史 | audit 表追溯 |

底栏触发(`packages/ui/src/components/ResultGrid.vue:1202-1215`):

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

所有这些视图都在 modal 里打开,关闭后回到网格 — 它们是网格的"放大镜",不替代网格。

## 1. 图表视图(柱 / 折线 / 饼图 + 4 种扩展)

`packages/ui/src/components/ChartDialog.vue`,**630 行**,触发按钮:**📊 图表**。

### 设计选择

代码注释解释得很坦诚:

> 没引 ECharts,自己手写 SVG(柱 / 折线 + 饼图各百来行),原因:
> - 桌面 app 体积敏感;图表只是 result grid 的"小工具",不是主舞台
> - 三种图覆盖 90% 临时看数据的场景;要更花哨再升级 ECharts 不迟
> - SVG 渲染容易导出 PNG(toDataURL via `<canvas>`)

7 种图表都是纯手写 SVG:

| 图表 | 适用 | 上限 | 备注 |
|---|---|---|---|
| 📊 柱图(bar) | 分类数值对比 | 前 50 行 | 自动 Y 轴 round 上限 |
| 📈 折线(line) | 趋势 / 时序 | 前 200 行 | `M / L` 路径 |
| 🥧 饼图(pie) | 占比 | 前 50 行 | 自动百分比标注 |
| ⛰ 面积(area) | 趋势 + 量级 | 前 200 行 | 折线闭合到 baseline |
| ·· 散点(scatter) | 离散点云 | 前 200 行 | 圆点 |
| ⭕ 环形(donut) | 占比变种 | 前 50 行 | 外环 `r * 1.0`、内孔 `r * 0.55` |
| 📡 雷达(radar) | 多维度对比 | 前 50 行,至少 3 个点 | 每行一个轴 |

### 列选

顶栏三个选择器:**Label**(任意列,`.toString()`)、**Value**(自动嗅探数值列,非数值列名后会标 `(?)`)、**类型**。`isNumericColumn` 取前 20 行做 `Number.isFinite(Number(v))` 嗅探,默认 Y 列 = 第一个数值列。切换 result 时 `watch` 重置选择。

数据规则:`Number(v)` 出 NaN 的行被跳过,行数超上限只取前 N 行(柱 / 饼 50,折线 / 面积 / 散点 200,雷达 50)。

### Y 轴

为了让刻度看上去"整",上限走 `Math.ceil(m / 10^floor(log10(m))) * 10^floor(log10(m))` 取整。刻度数字格式化为 `B / M / k`(大于 1e9 / 1e6 / 1e4)。

### 产出:导出 PNG

工具栏右侧 `⬇ 导出 PNG` → `XMLSerializer` 序列化 SVG → `<canvas>` 2× HiDPI 绘制(深色背景 `#1d1e22`)→ `canvas.toBlob('image/png')` → 走自定义 `SaveFileDialog`。文件名 `chart-{kind}-{ts}.png`,分辨率 1440×720,适合直接贴到飞书 / Slack。

## 2. 透视表(PivotDialog)

`packages/ui/src/components/PivotDialog.vue`,162 行。触发:**📐 视图 → ⊞ 透视**。

定位:**在内存里**对当前结果集做 pivot,不重跑 SQL。算法不复杂 — 行按 `(rowFields...)` 分组 → 组内再按 `colField` 分桶 → 桶内 `agg`。

### 三轴 + 一个聚合函数

| 控件 | 行为 |
|---|---|
| **行**(chips 多选) | 按这些列分组,key 用 `'\|'` 拼 |
| **列**(下拉) | 这一列的所有 distinct 值会展开为表头列(字典序) |
| **值** + 聚合 | 在每个 (row, col) 格内对该列做聚合 |
| 聚合下拉 | `COUNT / SUM / AVG / MIN / MAX` |

### 算法

两层嵌套 `Map<rowKey, Map<colKey, number[]>>`:扫一遍 `result.rows`,`rowKey` 是 `rowFields` 各列字符串用 `|` 拼,`colKey` 是 `colField` 的字符串值,`Number(row[valueField])` 进数组。`NULL` 统一为字面 `'NULL'`(同组聚合)。COUNT 用 `length`,其它用数值聚合。

### 限制

代码注释直说:

> 不支持:多 value field、有序列名(pivot 列按字典序)、过滤;这些可以下一版补。

也就是说 — 想画"按月份排序 1-12 而不是 10、11、12、1、2..." 暂时做不到,需要先在 SQL 里把列改成 zero-padded 字符串(`'01' / '02' / ...`)。

### 产出

只是个临时表格视图,不能直接导出。需要持久化数据建议:

- 关掉透视回到网格 → 右键复制 → 选 CSV / Markdown 粘到 Excel / Notion
- 把 pivot 逻辑用 SQL 重写:MySQL 的 `GROUP BY x WITH ROLLUP` / PG 的 `crosstab()`

## 3. 地理散点(GeoMapDialog)

`packages/ui/src/components/GeoMapDialog.vue`,138 行。触发:**📐 视图 → 🗺 地理**。

不引 leaflet / 不画底图,SVG 散点直绘 `(lng, lat)`。代码注释解释:

> 投影:等距等距投影(Mercator 视觉变形小,本地数据用经纬度直绘也够看,不做复杂坐标系)。
> 没做:底图(不引 tiles)、聚类(点太多会糊但可拖拽 zoom 解)。

### 自动列识别

```ts
latCol = cols.find(c => /^(lat|latitude|y)$/i.test(c)) ?? cols[0]
lngCol = cols.find(c => /^(lng|lon|long|longitude|x)$/i.test(c)) ?? cols[1]
labelCol = cols.find(c => /^(name|title|label|id)$/i.test(c)) ?? ''
```

数值合理性硬筛(防垃圾数据):

```ts
if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue
```

### 自动取景框

不是世界地图全图,bounds 算"恰好包住所有点 + 5% 边距":

```ts
const dx = Math.max(0.001, (maxX - minX) * 0.05)
return { minX: minX - dx, maxX: maxX + dx, ... }
```

四个角的经纬度数值会标在 SVG 边沿,鼠标悬停某个点显示 `lat=... lng=...`。

### 产出

视觉浏览,不导出 PNG(下一版可能补)。要做持久化的可视化,SQL 输出加一列分类、用图表视图(散点)截图也行。

### 数据形状要求

| 列名兼容 | 例 |
|---|---|
| `lat`, `latitude`, `y` | `latitude FLOAT` |
| `lng`, `lon`, `long`, `longitude`, `x` | `lng DECIMAL(9,6)` |
| `name`, `title`, `label`, `id`(label,可选) | `store_name VARCHAR` |

不在标准名里也行 — 手动从下拉选即可,只要值是数值且在范围内。

## 4. 时间轴(TimelineDialog)

`packages/ui/src/components/TimelineDialog.vue`,171 行。触发:**📐 视图 → ⏱ 时间轴**。

### 自动列识别

```ts
timeCol = cols.find(c => /at$|_time$|date|time|created|updated/i.test(c)) ?? cols[0]
labelCol = cols.find(c => /^(name|title|label|id|user|action)$/i.test(c)) ?? ''
colorCol = ''   // 可选：按这列分类着色
```

会兜底命中 `created_at / updated_at / event_time / order_date / login_time` 等。

### 时间值解析(`toMs`)

四种格式都接得住:

```ts
function toMs(v: unknown): number | null {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000   // ms or s 启发式
  const ms = Date.parse(String(v))  // ISO / "YYYY-MM-DD HH:MM:SS"
  return Number.isNaN(ms) ? null : ms
}
```

> 1e12(2001 年)以下的数值会被当成 Unix 秒乘 1000;以上当 ms。一般业务时间够用,极少数 1969 年之前的时间戳会被错判 — 数据里有的话先在 SQL 里用 `to_char(...)` 转字符串。

### 渲染

水平时间轴,事件点上下错位防重叠(`i % 2 === 0 ? -16 : +16`),X 轴 5 段等距刻度显示日期。

如果指定了 **color** 列,distinct 值依次取 8 色调色板(`#7c6cff / #4caf50 / #e0a020 / #e04050 / #3aa1ff / #b48cff / #67c23a / #ff9966`),底下出现 legend 图例。鼠标悬停在点上,底部信息栏显示 `时间 · label`。

### 数据形状要求

至少一列时间(任意 Date / ISO / Unix 秒或毫秒)。Label / Color 都可选。

## 5. 自引用 FK 树(TreeViewDialog)

`packages/ui/src/components/TreeViewDialog.vue`,130 行。触发:**📐 视图 → 🌳 树**。

适合**自引用外键**或层级数据:评论楼中楼(`comments.parent_id → comments.id`)、组织部门(`departments.parent_dept_id → id`)、地理行政区(`regions.parent_id`)。

### 三个轴

| 选择器 | 推断规则 |
|---|---|
| **id** | 优先匹配 `/^id$/i`,否则第一列 |
| **parent** | 匹配 `/parent[_-]?id\|pid/i`,默认空 |
| **label** | 匹配 `/^(name\|title\|label)$/i`,否则 fallback 到 id |

### 算法

两遍扫描:第一遍按 id 建索引(`byId: Map<id, node>`),第二遍把孩子挂到父亲下;父 id 不在索引里(包括 NULL)的为根。`parent === self` 视为根(防止 `WHERE id=1 AND parent_id=1` 这种伪记录)。

### 环检测

`walk(n, depth)` DFS 用 `Set<string>` 记已访问;再次遇到同一 id 就把 `n.cycle = true` 并停。该节点旁会出现黄色 `⚠`,鼠标悬停提示"环"。常见于数据被运维误改后(应该是父子关系画成了循环)。

### 渲染

flatten 后按 `depth * 18px` 缩进,每节点显示 `▸ <label> #<id>`。鼠标悬停 label 用 `title="{json}"` 展示完整行数据(快速肉眼检查)。

### 数据形状要求

最少需要 id + parent 两列;一句 `SELECT id, parent_id, name FROM comments WHERE post_id = 1234` 把整棵树一次拿回来,视图就会自动渲染层级。

## 6. 行变更历史(RowHistoryDialog)

`packages/ui/src/components/RowHistoryDialog.vue`,123 行。

定位:**单行版本追溯** — 给定某张表某行的主键,找它在 `audit / *_history / *_log` 影子表里的所有版本。

### 影子表自动发现

打开时自动跑 `SELECT table_name FROM information_schema.tables WHERE table_name LIKE '{base}_%' OR table_name = 'audit_{base}' OR table_name = '{base}_history'`,候选填到 `<datalist>` 下拉,用户可以二选或手输。

### 查询历史

确定影子表后,按 PK 条件查 `SELECT * FROM {shadow} WHERE {pk}=... ORDER BY changed_at, updated_at, created_at, version, revision DESC LIMIT 200`。ORDER BY 一口气列五个候选列名,数据库会用存在的那个(MySQL 容忍 / PG 严格,常见 audit 表至少有一个)。结果以紧凑 mini 表显示,每个 cell 截断到 80 字符。

### 数据形状要求

需要业务表 + 一张 `*_history` / `*_audit` / `*_log` 影子表(主键 + 业务列重复 + `changed_at / version` 字段)。常见的 audit trigger 实现都满足这个约定。

> 实现说明:这个对话框在仓库里已经写好(`Workspace.vue` 里有 `rowHistOpen` 状态和 modal 挂载),但暂时没有从结果网格右键直接打开的入口 — 当前是给后续右键菜单预留的能力。

## 7. 数据血缘(LineageDialog)— 启发式版本

`packages/ui/src/components/LineageDialog.vue`,98 行。

代码注释开宗明义:

> 列血缘(启发式版本):还没有真 SQL parser,先用最简启发式 — 在历史 SQL 文本里出现「`{table}.{column}`」或裸 `{column}`(前提是 SQL 里 FROM 了 `{table}`)的视为相关。
> 准确度有限:会漏(别名 / 子查询)、会误报(同名列)。明确告诉用户这是「heuristic」版本,等 SQL parser 上线后会替换为真正的血缘分析。

### 算法

拉本连接最近 500 条历史 SQL,逐条用 `\b{table}\b` + `\b{column}\b` 两个 word-boundary 正则匹配文本。命中后再看开头:`INSERT / UPDATE` → 进 sinks(写入),`SELECT / WITH` → 进 sources(读取)。

### 渲染

双栏:

- **← Sinks** — 把数据**写入**这个列的 SQL(INSERT / UPDATE)
- **→ Sources** — 把数据**读出**这个列的 SQL(SELECT / WITH)

每行显示执行时间 + 前 120 字符的 SQL 摘要。顶部黄色横条提示用户"这是启发式结果,不可作为审计依据"。

### 数据形状要求

依赖**查询历史**(`client.connections.history`)。从未在 SkylerX 里跑过相关查询的话,血缘窗会显示"No hits"。

> 实现说明:同 RowHistoryDialog 一样,在 `Workspace.vue` 里已挂载、需要从外部 trigger(`lineageOpen.value = {...}`),目前没有专门的 UI 入口,作为预留 API。

## 支持矩阵

| 视图 | 自动列识别 | 数据规模上限 | 静态导出 | 重跑 SQL | 适合 |
|---|---|---|---|---|---|
| 图表(7 种) | 数值列嗅探 | 50 / 200 行 | PNG(2× HiDPI) | 否 | 一次看清量级 / 趋势 / 占比 |
| 透视表 | 第一/二/三列 | 取决于浏览器内存 | 复制为 CSV | 否 | 双轴交叉聚合 |
| 地理散点 | `lat / lng / x / y` 别名 | 无上限 | 否 | 否 | 经纬度直绘 |
| 时间轴 | `at$ / time / date / created` 后缀 | 无上限 | 否 | 否 | 事件流 + 分类着色 |
| 树形 | `id / parent_id / name` | 无上限 | 否 | 否 | 自引用 FK 层级 |
| 行历史 | 表名 `*_history / *_audit` 启发 | 200 行(SQL LIMIT) | 否 | ✓(查 audit 表) | 单行版本追溯 |
| 数据血缘 | — | 历史 500 条 | 否 | 否 | 列读写关系(启发) |

## 触发方式一览

| 视图 | 入口 | 备注 |
|---|---|---|
| 图表 | 结果工具栏 `📊 图表` | 直接打开柱图默认 |
| 透视 / 树形 / 地理 / 时间轴 | 结果工具栏 `📐 视图 → 弹出菜单` | 同 modal 共用 `altView` 状态 |
| 行历史 | 通过 `rowHistOpen.value = { conn, table, pk }` 触发 | 当前预留,等右键菜单接入 |
| 数据血缘 | 通过 `lineageOpen.value = { conn, table, column }` 触发 | 当前预留,等右键菜单接入 |

所有 modal 关闭后回到原网格,不会丢失分页 / 排序状态 — 它们只是在网格之上叠加了一层"放大镜",不替代结果集本身。

## 选视图的小决策树

要看**量级 / 排名 / 趋势 / 占比**?→ 图表
- 量级 vs 时间 → 折线 / 面积
- 分类排名 → 柱图
- 占比 → 饼 / 环形
- 多维度 → 雷达

要看**双轴交叉**?(例如"渠道 × 月份")→ 透视

数据带 **`(lat, lng)`** → 地理散点

数据带 **时间列**:
- 时序值连续(每天的 DAU)→ 折线
- 离散事件(部署、上线、告警)→ 时间轴

数据**自引用 FK** → 树形

要看**某一行历史变化** → 行历史

要找**这列谁读、谁写** → 数据血缘(启发式,谨慎使用)

至此结果集层面的所有替代视图都覆盖了。如果你的数据形态不在以上任何一种,90% 的情况下 SQL 改写一下就能塞进某个视图 — 实在没办法,回网格用复制功能贴到 Excel / Numbers / Notion 接续处理。

要看 SQL 本身的运行情况(慢日志、Explain、索引推荐),翻 [高级与工程化](./advanced.md);要导出导入数据,翻 [数据迁移](./databases.md)。
