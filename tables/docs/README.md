<!-- 从面板仓库 docs/modules/tables/README.md 搬来（2026-11-12 表格拆成插件）。文中的路径相对插件目录 tables/；搬过来的文件位置不变。和以前不一样的地方见下面「拆成插件后」。 -->

# tables：表格页（游戏配置表管理）

- 状态：documented
- 职责：按项目设置的表格目录浏览、搜索、查看、在线修改 xlsx / CSV 表格；表头、枚举等结构信息存在表格之外
- 源码：`web/index.tsx`、`server/index.ts`、`server/tables/`、`server/actions.ts`、`server/review.ts`、`shared/tables.ts`、`shared/table-*.ts`、`web/src/pages/TablesPage.tsx`、`web/src/components/tables/`
- 入口：`web/index.tsx`、`server/index.ts`
- 关键词：表格、枚举扫描、表头配置、新建表格、配置表、表格目录、绝对路径、目录选择器、xlsx、CSV、表头、枚举、引用、结构文件、内容搜索、原地保存、检查、AI 分析表格风格、版本差异、一格的历史、提交、冲突合并、跨项目对比、table.edit
- 更新：2026-11-12（表头改成按配置的行数组、新建表格）

设计稿在项目共享目录 `designs/表格管理与在线编辑-设计稿.md`。硬约束：**表格文件只在用户保存改动时原地改单元格，结构信息一律不写进表格**。

## 拆成插件后

- 面板接口 6 的扩展点（面板 ADR 0059 第 12 条）：整页 `pages`（`keep: true`，打开过就一直挂着，`Page` 的 `active` 说明是不是显示着）、项目设置的「表格」页（`projectSections`）、设置 →「组件」里的表格编辑器示例（`specimens`）、`table.*` 面板动作（`ServerPlugin.actions`，`server/actions.ts`）、评审里的 xlsx 差异（`ServerPlugin.textify` 的 `diff`，`server/review.ts` + `shared/review-tables.ts`）。
- 地址：页面 `#/plugin/tables/tables/<项目 id>`（面板把旧的 `#/tables/<项目>` 转过来）；接口挂在 `/api/plugins/tables/api/tables/…`（`web/src/lib/tables-api.ts` 的 `BASE`，动作里的 `API`）。
- 项目设置存在 `project.plugins.tables`（`shared/tables.ts` 的 `tablesOf`）：面板的数据迁移 0005 把原来的 `project.tables` 挪了过来。结构文件和保存前的备份还在原来的位置（项目目录 `.agentpanel/tables/` 或数据目录 `tables/<项目 id>/`），插件删了也照样留着。
- 「AI 分析表格风格」不再走面板配置助手：服务端 `/analyze-prompt` 读样本拼提示词（带面板的回复语言规则），网页用面板开放的 `runPromptInProject` 开分析对话，回复用 `extractJson` + `resolveTablesProposal` 解析。
- 文件预览里的表格（`SheetTable`、`SheetHeaderBar`、表头识别 `shared/sheet-header.ts`、格子差异 `shared/sheet-diff.ts` 和后台线程 `web/src/lib/sheet-diff-async.ts`、`server/xlsx.ts`、`shared/csv.ts`）留在面板，插件经开放模块用同一份。
- 类名一律带前缀 `tb:`（`web/index.css`）；`sheet-*` 这些是面板 `sheet-table.css` 的类，不加前缀。
- 在线演示不装插件，演示里没有表格页；原来的界面检查分片 14-tables 跟着去掉了，改动后用面板「链接本机目录」装 `dist/tables` 手动过一遍。
- 性能基准：`scripts/bench.ts`（跑法写在文件开头；默认 5000 个文件、一张 1 万行 × 80 列的大表，超过目标就失败）。

## 入口

| 文件                                                       | 做什么                                                                                        |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `shared/tables.ts`                                         | 项目设置里的 `TablesConfig`、表格页的数据结构、结构文件 `TableSchema`、通配和表头优先级       |
| `shared/csv.ts`                                            | CSV 的读、写回（保持分隔符 / 换行 / BOM / 结尾换行）                                          |
| `server/tables/files.ts`                                   | 列表格文件、解析（按 mtime + 大小缓存）、锁文件检查、路径越界检查                             |
| `server/tables/search.ts`、`shared/table-search.ts`        | 跨表搜索（`/search`）：「字段名:值」、区分大小写 / 整格 / 正则，匹配规则和替换共用            |
| `server/tables/bulk-replace.ts`                            | 跨表批量替换（`/replace`）：预览时试一遍保存、列出拒绝原因，勾选后逐个文件原地保存            |
| `server/tables/schema-store.ts`                            | 结构文件读写：`.agentpanel/tables/` 或数据目录 `tables/<项目 id>/`，拆成 4 个 json            |
| `server/tables/routes.ts`                                  | `/api/plugins/tables/api/tables/:id`（列表）、`/probe`、`/file`、`/search`、`/schema`         |
| `web/src/lib/tables-api.ts`                                | 页面调接口                                                                                    |
| `web/src/lib/tables-nav.ts`                                | 侧栏「表格」入口打开哪个项目（上次看的 / 第一个设了表格目录的）                               |
| `web/src/pages/TablesPage.tsx`                             | 表格页：左边文件树 + 名字 / 内容搜索，右边文件页签 + 工作表 + 表头栏 + 表格                   |
| `web/src/components/tables/`                               | `TableTree`、`TableHits`、`TableTabs`、`TableView`                                            |
| `web/src/components/projects/ProjectTablesSection.tsx`     | 项目设置的「表格」页；目录列表是 `projects/DirList.tsx`（设置 → 组件里有样例）                |
| `server/tables/xlsx-write.ts`、`zip.ts`、`write.ts`        | 保存：xlsx 原地改单元格（其余 zip 条目逐字节照抄）、CSV 保持格式、备份、锁 / 改动 / P4 检查   |
| `shared/table-edit.ts`、`components/tables/table-edits.ts` | 改动的表示（行操作 + 格子）、撤销重做、剪贴板；页面和服务端共用同一份 applyRowOps / setCells  |
| `shared/table-struct.ts`                                   | 结构化：每列是什么（类型、枚举、引用、范围、repeated）、下拉选项、按结构检查、整本检查        |
| `server/tables/check.ts`                                   | 全项目检查（`/check`），引用的表从磁盘读                                                      |
| `shared/tables-assist.ts`、`server/tables/sample.ts`       | AI 分析表格风格：样本（`/sample`）、提示词、结果校验、按勾选并进结构文件                      |
| `shared/sheet-diff.ts`                                     | 格子级差异（版本差异、跨项目对比共用）、只看变化的折叠、跨项目「拷到另一边」                  |
| `server/tables/history.ts`                                 | 版本记录（`/history`：git log / p4 filelog / svn log）、取某一版（`/at`：show / print / cat） |
| `server/tables/compare.ts`                                 | 跨项目对比（`/compare?other=`）：按相对路径配对，比解析出来的格子                             |
| `shared/table-agent.ts`、`server/actions.ts`               | 给 Agent 的动作 `table.list / sample / query / schema / edit / propose / check`      |
| `shared/table-describe.ts`                                 | `table.schema` 的列结构：类型、数组分隔符、枚举值、引用、范围和校验规则                       |

## 表格目录

- 设置里一个目录一行（`DirList`，「添加表格目录」弹出本机目录选择器），多层子目录都会找。选到项目目录里的文件夹写成相对路径，项目目录外的（比如策划单独的表格仓库）写绝对路径。
- 文件路径：项目目录里的是相对项目目录的路径；项目目录外的是正斜杠的绝对路径。`safeRel` 只放行相对路径（不带 `..`）和落在某个「项目目录外的表格目录」里的绝对路径；磁盘路径一律用 `tableFull`（`path.resolve`），不要再 `path.join(dir, f.path)`。
- 项目目录外的表格：版本命令在文件所在目录跑（`vcsPath`）；跨项目对比按「目录名/目录里的路径」配对（`pairKey`），两边真实路径在 `TablePair.left / right`；备份路径去掉盘符冒号。
- 设置页改目录时 `POST /probe` 按还没保存的配置（含没保存的项目目录）找一遍，每行下面显示实际找的完整路径和找到几个表格，路径填错一眼能看出来。

## 表格页的显示

- 文件树（`TableTree`）：文件夹默认折叠，只画展开了的；只有一个顶层目录时它默认展开，打开的文件所在的目录自动展开；顶层开头一串单个子目录并成一个节点。一个项目最多列 20000 个文件。
- 表格（`SheetTable`，`fill` + `widthKey`）：数据画不满时接着画空行空列；列名右边线拖动改列宽（记在 localStorage `sheet-colw:<项目>:<文件#工作表>`，双击恢复）；数据区隔行底色 `--c-grid-stripe`；表头每种行一个颜色。
- 版本差异、跨项目对比：差异在后台线程算（`web/src/lib/sheet-diff-async.ts` + `sheet-diff.worker.ts`，小表直接算），`SheetDiffView` 自己带滚动区、只画看得见的行、固定列宽。

## 表头从哪来

**表头只按配置，不按内容猜**（用户 2026-11-12 定）。配置在 `shared/table-header.ts`：表头是一个「行」的数组 `HeaderRule = { start, rows: [{ kind, label?, values? }] }`，
数组里每一项对应表格表头的一行，从第 `start` 行往下排，能加、删、挪；`kind` 是 6 种角色之一（决定底色和用途：字段名行当列标题、类型行定参数类型……），
`label` 是这行的名字，`values` 是这行能填什么（通用枚举名或 `@types`），表头格子改的时候下拉、填错标红。

`schemaHeader`：`style.exceptions` 里第一条命中的（`exceptionHits`：通配命中、写了 `sheet` 时工作表也对得上、通配空着的不生效）> 项目表头 `style.header`。
返回 `{ rule, source }`，`headerOf` 换成面板组件认的 `TableHeader`（`SheetHeader` + 每行的 `values`），配置的起点超出这张表时当没有表头。没配置（`rows` 空）就整张表当数据，状态栏提示去配置。

- 项目设置 → 表格「表头」：项目表头 + 按文件指定的几条，都用 `HeaderRowsEditor`（设置 → 组件里有示例）。
- 表格页「调整表头」（`TableHeaderSetup`，通过 `SheetHeaderBar` 的 `setup` 换掉面板自带的）：「只改这张表」写一条只管这个工作表的按文件指定（放最前面）；「改项目的表头 / 改这条按文件指定」直接改它现在用的那份；单独设过的能「改回按项目设置」。
- 文件弹窗（不在表格页）不属于哪个项目的配置，仍是面板的自动识别 + 浏览器 localStorage。
- 旧格式（几套 `style.headers` 按内容挑、按种类的 `roleEnums`、单表覆盖 `files.json`）在 `readSchema` 入口由 `table-schema-upgrade.ts` 换成新的：第一套当项目表头，其余几套变成通配空着的按文件指定（不丢，用户填上通配才生效），`files.json` 的每条变成只管那个工作表的按文件指定、排最前；下次保存写新格式并删掉 `files.json`。不放进 zod：结构文件跟着项目提交，同事用旧版写的随时会再出现。

结构文件在页面里只留一份（`web/src/lib/table-schema.ts`）：项目设置的「表头」「通用枚举」「校验」「AI 分析」和表格页共用，谁保存都先重读最新的再改（`saveTableSchema`），其它地方跟着更新；设置表单用 `useSchemaDraft`，没改过的跟着新内容走，改了一半的留着。
AI 分析的结果（`TablesDraft`）里的表头和结构文件同一个格式：AI 自己读样本表的开头几行，总结出项目表头（每行 kind / label / values）和按文件指定的几条；不认识的 kind 改成「其它」并把原词留作行名，还按旧格式（roles、几套 headers、roleEnums）回答的也换过来，不整份作废。还没应用的结果存在浏览器 localStorage，刷新后还能接着应用。

## 结构化（枚举、引用、检查）

- 列是什么由 `columnInfos` 算：类型行的字（`uint32`、枚举类型名……）+ 修饰行（`repeated`）+ 结构文件 `columns.json` 里按「路径#\*#字段名」记的覆盖（枚举、引用、最小 / 最大、也允许的值）。
- 枚举值 = 结构文件里手写 / 页面新增的 + 枚举表里按名字列取的（`source`，多个枚举放一张表时按 `match` 筛）；页面上加枚举值（「枚举」弹窗）只写结构文件。表格里枚举 / 引用格只能从下拉里选（`EnumPicker`：格子不能打字，下拉顶上的搜索框只筛选，搜不到回车不写东西；一格多值的 `ListEditor` 有选项时同样只能选），不能在格子里打字新增枚举值。
- 检查（`checkSheet`）：类型、枚举（名字和值都算）、引用（被引用的表读到了才查）、范围、主键重复；空格子不查。表格页标红和左栏「检查」、服务端 `/check` 都用它。
- 列结构面板列出这一列在表头里的每一行（`ColInfo.head`）；结构文件 `columns` 里的 `type` 覆盖类型行（表头写错、没写时用），表格不改。
- 通用枚举：结构文件 `enums.json` 就是整个项目共用的枚举库，项目设置 → 表格「通用枚举」和表格页「枚举」管的是同一份。
- 项目级表头：见上面「表头从哪来」。
- 新建表格：表格页左栏「新建」（`NewTableDialog`）选表格目录、文件名（.xlsx / .csv / .tsv），每一列按项目表头的每一行填（每格都能手填，也能从建议里选：限定了取值的行按限定的、类型行认类型式，填了不认得的标红；修饰、导出端照前一列）。每一列还能设列结构（枚举、引用、范围、必填……，和表格页「列结构」同一个 `ColumnFields`），新建后按字段名写进 `columns`；`newTableIssues` 查文件名、工作表名、字段名空 / 重复。服务端 `POST /create`（`server/tables/create.ts`）只写在设置的表格目录里、不覆盖已有文件（`wx`），xlsx 是从头拼的最小工作簿（共享字符串、表头冻结），之后照常原地改格子。
- AI 分析：页面先取 `/sample`——**只是挑出来的几张表的清单**（按目录轮着挑，最多 8 张），放进 `subject.sample` 交给配置助手（`kind: 'tables'`）；CLI 再用面板动作 `table.sample`（`/sample?path=`：一张表的表头 + 前 3 行数据 + 这张表里类型名出现过的值，最多 6000 字）一张一张看。提示词只放清单，不会超过任务提示词 20000 字的上限；多轮对话太长时只留最近的。在项目里开分析对话（记成 `run`）；结果写在回复末尾的 `tables-style` 代码块（`TABLES_STYLE_LANG`），面板（2026-11-14 起，`WebPlugin.reports`）在分析窗口右侧功能面板画「表格设置」（`TablesAnalysisReport`），逐项勾选后 `applyAnalysis` → `applyTablesDraft` 写进结构文件；应用过的回复按消息 id 记在本机，再打开显示「已应用」。同一份结果也暂存在页面模块里，项目设置 → 表格「AI 分析」照样能勾选应用（旧面板只有这条路）。勾选列表是共用的 `DraftReview`（`TablesDraftReview.tsx`，设置 → 组件里有示例）。

## 枚举扫描（2026-11-14）

用户定：枚举定义在表格的某个页签（用户项目的 `EnumType`：A 列只在每组第一行写枚举名、B 成员名、C 值，没有表头）、C++ 或 Lua 里时，按规则一键扫描，打开时自动刷新。设计稿在项目共享目录 `designs/表格枚举扫描-设计稿.md`，一期（1.3.0）做了表格里的写法；二到四期（1.4.0）加了 C++ / Lua / 正则 / 自定义命令、AI 总结规则、盯着改动、改名提示。

- 规则：结构文件 `enum-scans.json`（`TableSchema.scans`，`shared/table-enum-scan.ts` 的 `EnumScan`）。写法 `block` 分组块 / `rows` 每行写枚举名 / `sheets` 一页一个枚举；列写 Excel 列号或字段名，全写列号时不按项目表头跳行、从第 1 行扫；`rename` 去前缀、加前缀、手动对照；`auto` 是 `open`（打开时）、`watch`（盯着改动）或 `off`。一条写坏了只丢那一条。
- 结果：`enum-scan-results.json`（按规则 id：时间、源文件的修改时间和大小、扫出的枚举、提醒、错误），只在扫描时写（`server/tables/enum-scan-store.ts`）。`readSchema` 并进对应枚举的 `scanned`（只读，规则顺序靠前的赢）；`writeSchema` 去掉 `scanned`，只靠扫描才有的枚举不进 `enums.json`。`enumOptions` 扫描的排前面，手写同名的不重复。
- 执行（`server/tables/enum-scan.ts`）：`POST /enum-scan`（`ids` 手动；`auto` 只扫 `open` 的规则且源文件修改时间 / 大小变了的，`file` 时只看用到它的规则）、`POST /enum-scan/try`（试跑不写）、`GET /enum-scan`（每条上次的情况）。同一个结构文件目录排队跑；失败时旧结果留着、记下错误，照实报给页面。
- 页面：项目设置 → 表格 → 枚举的「枚举扫描」（`ProjectTablesScans`、`EnumScanRow`、`EnumScanDialog`、`ScanPreview`；设置 → 组件里有示例）；表格页 `useEnumAutoScan` 进页面时请求一次、规则用到的文件打开 / 保存 / 重新载入（修改时间变了）时再请求，有变化重读结构文件并提示变了什么；枚举对话框里扫描的成员只读显示。
- 代码类写法（`shared/table-enum-scan-code.ts`，轻量词法扫描，不是完整语法分析）：`cpp` 认 UENUM / enum class / enum / `namespace EFoo { enum Type }`，自增、`1 << 3` 这类表达式、UMETA 的 DisplayName / ToolTip（没有退到注释）、跳过 Hidden 和 `_MAX` / `Count` 哨兵，`#if` 里的成员记提醒；`lua` 认 `EFoo = { A = 1 }`（local、`M.EFoo`），可按变量名正则、总表（`container`）、成员是表时取字段；`regex` 两个正则（块带 `name` / `body` 组，成员带 `name`、可选 `value` / `desc`）；`command` 跑项目里的脚本，标准输出 `{"enums":{…}}`，没写 `files` 时不自动跑。文件通配在 `server/tables/enum-scan-files.ts`（只往写死的目录里找，跳过 .git / Intermediate / Binaries 等，超过 5000 个文件或 50MB 直接报错让用户写窄），按文件的修改时间和大小缓存每个文件的结果。
- AI 总结规则（`shared/table-enum-scan-ai.ts`、`web/src/components/tables/EnumScanAi.tsx`）：用户指一个示例文件（可带页签、枚举名、说明），在项目里开分析对话；CLI 用面板动作 `table.enum_scan_peek`（看页签原始行，带列号）和 `table.enum_scan_try`（试跑规则，不收 command）调到对上，最后回复里给 ```enum-scan 代码块。AI 只写声明式规则、不写脚本，扫描本身不调模型。结果记在页面模块里，项目设置 → 表格 → 枚举顶上「查看并保存」打开规则弹窗并自动试跑；已有规则旁边有「让 AI 调整」，把现在的规则和上次的提醒 / 错误一起带上。
- 盯着改动（`server/tables/enum-scan-watch.ts`）：插件启动时、保存结构文件后按 `watch` 规则的通配起始目录开 `fs.watch` recursive，事件停 1.5 秒后按修改时间比、变了才扫，结果经推送 `enum-scan` 事件给所有页面（`listenEnumScanPush`），页面重读结构文件并提示。
- 改名：`diffScan` 按值（再按位置）把去掉的和新加的成员配成 `renames`，项目设置 → 表格 → 枚举顶上提示，用户确认后用 `EnumRenameDialog` 替换表格里的旧值（会改表格文件，不悄悄做）。

## 类型和存储样式（2026-11-13）

用户定：同一个值有「存储样式」（表格文件里实际写的字，例如 FVector 存成 `1#2#3`，模板 `{X}#{Y}#{Z}`）和「显示样式」（表格页里看到的 `(X=1,Y=2,Z=3)`）。表格文件不因此改动，只有在弹窗里改了值才按存储样式拼回去写进格子。

- 类型表：结构文件 `types.json`（`shared/table-types.ts`）。kind 是 struct（字段 + `store` / `show` 模板，`{字段名}` 占位）、alias（指向一个类型式）、int / uint / float / bool / string（范围、正则）。别名不分大小写都认。UE 5.4 常用类型的预设在 `table-types-ue.ts`，项目设置 → 表格 → 类型里「导入 UE 常用类型」只加没有的，同名的不动。
- 容器：`TArray<T>` / `T[]` / `list<T>`、`TSet<T>`、`TMap<K,V>` 是内置的，写法在 `style.formats`（数组存储的分隔符仍是 `style.listSep`，列结构的 `sep` 照样能改；第二层数组用 `listStore.inner`；映射一对的模板 `{K}` `{V}`）。
- `table-codec.ts`：类型式 → 类型树（按结构文件对象缓存）；`parseStore` 按存储样式拆（认括号和双引号，所以 UE 写法嵌套也拆得开）、`formatStore` 拼回、`formatShow` 拼显示的字。只有结构体、映射和套着它们的数组算「按类型拆的列」（`ColInfo.typed`），纯基础类型的数组照旧走 `list` + 分隔符。
- 检查：拆不开算类型不对；拆开后每个叶子按字段的类型、范围、枚举、引用查，原因带位置（「第 2 项 · Count：不能小于 1」）。集合重复、映射键重复也算。
- 表格里显示：`cell-display.ts` 给面板 SheetTable 的 `display`，按列缓存；双击 / 回车打开 `TypedValueDialog`（`TypedValueForm` 按类型树逐项填，颜色带拾色器，底下能直接改存储的原文）。一行的表单里有「逐项编辑」按钮。
- AI 分析时按格子实际的写法总结 `types` 和 `formats`，逐项勾选后写进去。

## 校验规则

- 列结构里的规则（`TableColumn`）：`pattern` 正则（整格匹配，数组列逐项，`patternRe` 缓存编好的正则，写错的不查）、`required` 必填、`requiredWhen` 条件必填（同一行另一列是某些值时必填）。必填类是行内检查，和格子检查一起按行缓存。
- 组合唯一：`style.uniques`（通配 + 至少两个字段名，项目设置 → 表格「校验」），`checkSheet` 的 `uniques` 参数由 `uniquesFor(schema, file)` 给；重复记在这组第一列上。
- 保存前检查：`style.saveCheck`（warn 默认 / block / off），保存确认里列出改到的行里不合规的格子，block 时保存按钮不可点。
- 检查结果导出：左栏「检查」的「导出」重新查一遍（`/check?all=1`，每张表列全部），存成带 BOM 的 CSV。
- 枚举值改名：枚举对话框保存时 `findEnumRenames`（同一位置名字变了、旧名字不在新列表里）找出改名，问要不要替换所有表里的旧值；`POST /enum-rename` 先预览每个文件几格，确认后逐个文件走 `saveTable`（只改格子、备份、P4 先签出），失败的列出原因。

## 版本差异、跨项目对比

- `diffSheet`：列按字段名对齐（没字段名按位置）；行有唯一主键（`style.key`）时按主键对齐，否则按整行内容做 LCS（太大时退成贪心），同一段里删了又加的配成「改」。表头行另外比（`headerChanged`）。
- 版本差异「本地改动」= 基准版（git `HEAD` / p4 `#have` / svn `BASE`）↔ 页面上现在的内容（含没保存的），改过的行能还原成旧值（一次普通编辑）；点一个提交 = 它的上一版 ↔ 它。那一版里还没有这个文件时当空表。
- 切换到某一版（`server/tables/checkout.ts`，`POST /checkout`）：`rawAt` 取那一版的原始字节（git show / p4 print / svn cat），整个替换本地文件。不动版本控制状态（不 checkout、不 p4 sync），切完就是一处本地改动；替换前和保存一样查只读、Excel / WPS 占用、备份、P4 只读先 `p4 edit`。页面上没保存的改动作废。
- 任意两版对比：版本弹窗里「和哪一版比」可以选最近一次提交、上一版或列表里任意一版。
- 一格的历史（`shared/table-blame.ts` + `server/tables/cell-history.ts`，`GET /cell-history`）：服务端沿版本记录取每一版（并发 3），按主键（没设用第一列有字段名的）找同一行、按字段名找同一列，值和更早一版不同的提交列出来。不把几十版整表传给页面。
- 提交（`server/tables/vcs-ops.ts`，`POST /vcs-submit`）：只提交这一个文件。git `commit -- <文件>`（只到本地仓库，不推送，暂存区别的文件不动）；p4 没打开的先 `reconcile -e -a` 再 `submit -d`；svn 新文件先 `add` 再 `commit`。有冲突、没改动、项目只读都拒绝。
- 冲突三方合并（`shared/table-merge.ts`，`POST /merge-start`、`/vcs-resolve`）：base / theirs 从 git 暂存区 `:1` `:3`、p4 `fstat -Or` 的 resolveBase/From、svn `info --xml` 的 prev-base-file / cur-base-file 取；ours 是工作区文件——CSV 冲突时 git/svn 往里写了冲突标记，先备份再换成干净的 ours（git `:2`、svn `.mine`），页面重新载入。合并在页面上算：按主键对齐行、按字段名对齐列，一边改的自动合、两边改成不同才让用户挑；结果作为一次改动（`replaceIn`，行操作 + 格子）放进表格，用户看过走正常保存，再「标记已解决」（git add / p4 resolve -ay / svn resolve --accept working）。不直接写盘，保存那条路的读回校验照样生效。对方新加的工作表合不了，只提示。
- 跨项目对比：差异方向是 右(旧) → 左(新)。拷行只往右拷：`copyRows` 生成右边文件的行操作 + 格子，先按**右边项目**的结构 `checkTouched`，有问题列出来让用户决定，再走右边项目的原地保存。

- 跨项目批量同步（`server/tables/sync.ts` + `shared/table-sync.ts`，`POST /sync`）：对比窗口「批量同步…」勾文件，整文件（字节原样拷，右边没有就新建，走 `replace.ts` 和切换版本同一套：占用检查、P4 edit、备份、临时文件改名）或只同步一列（右边结构的主键对行，只改已有行，走 `saveTable`）。先 `apply:false` 预览每个文件（差几格 / 改几格 / 右边少几行），再写；每个文件单独成败、原因列出来。右边项目只读拒绝。
- 对比报告：对比窗口「导出清单」（文件和状态）、一对文件的「导出差异」（工作表、变化、主键、字段、右边旧值、左边新值），都是带 BOM 的 CSV（`compare-report.ts`）。

## 左栏

- 收藏、最近打开（`use-table-marks.ts`）：按项目记在本机存储（个人习惯，不进项目），文件没了就不列。文件树右键「收藏 / 取消收藏」「复制路径」「在文件管理器中显示」（`POST /reveal` → `server/open.ts` 的 `revealItem`）。
- 名字搜索认拼音首字母（`shared/pinyin.ts`）：不带字库，用 `Intl.Collator('zh-Hans-CN-u-co-pinyin')` 按声母分界字定字母；环境没有中文排序数据时自动退回只按原文匹配。每个路径的首字母算一次缓存。
- 左栏宽度（`ListPane` 的 `resizeKey`）、底部检查结果高度（`ResizeHandle side="top"`）可拖，记在本机，双击恢复默认。

## 导入导出

- 「导表」菜单下面：这张工作表存成 CSV（含表头原样）、数据行存成 JSON（键是字段名，数字 / 布尔按列类型转，数组列拆成数组，备注列不要）。纯前端，`shared/table-io.ts`。
- 从 CSV 粘贴导入：第一行一半以上是字段名就按名字对列，否则按位置；有主键时可选「主键已有的更新」，新主键追加到末尾。结果是一次改动（插行 + 格子，一次撤销），看过再保存。

## 编辑效率

- 新增行（行号右键插入、工具栏 +）主键列自动填「最大的整数 + 1」（`nextKey`，`shared/table-tools.ts`）；「复制这一行插到下方」同样重新编号。插行和填格子是一次撤销（`rowOpWithCells`）。
- Ctrl+D 向下填充（复制选中区第一行），Ctrl+Shift+D 按序列（前两行的差，只有一行数字时 +1）；改格子时 Ctrl+Enter 把值填进选中的每一格。
- 查找替换（Ctrl+H、工具栏「替换」）：范围是选中区域 / 当前列 / 整张表，只算筛选后看得见的数据行，跳过表头和隐藏的列；实时预览，「全部替换」一次撤销。
- 列名右键冻结到某列、隐藏列（`use-col-layout.ts`，按「项目:文件#工作表」记在 localStorage，表格文件不动）。冻结列在列虚拟化之外一直画，`sticky` 钉在行号列右边，底色换成不透明色（`sheet-frozen`）。
- 格子右键（整个表格只挂一个菜单，`CellMenu`）：引用列跳到被引用表的那一行（`findRefTarget`），被引用的表可以查「谁引用了这一行」（`findBackRefs`：结构文件里 ref 指向这张表的列，数组列按分隔符拆开整项比）。
- 快捷键（`grid-keys.ts`，由 `use-grid-edit.tsx` 调）：Ctrl+方向键跳到这一段数据的边缘、Ctrl+Home / End、Shift+空格 / Ctrl+空格选整行整列、PageUp / PageDown 按实际行高（`rowH`，跟着紧凑 / 宽松和设置）和数据区高度翻一屏、Ctrl+Shift+= 在上方插行（选中几行插几行，主键依次编号，`shared/table-rows.ts`）、Ctrl+- 删选中的行（`rowOpsIn` 一次撤销；选的是整列时拒绝）、Alt+↑ / ↓ 把选中的连续几行上移下移。F1 / Ctrl+/ 打开共用的快捷键一览（`web/src/components/tables/shortcuts.ts` 的「表格」组，经 `ShortcutsHelp` 的 `first` 排最前；全局的 `?` 在格子里是打字，`useShortcuts` 跳过已经 `preventDefault` 的键）。
- 整行整列：点行号选整行、点列名选整列（`SheetEditing.onRowDown / onColDown`），Shift 点击扩大、按住拖动多选。选区多一个 `whole`：整行时列铺满，整列时只铺满数据行（表头不跟着被清空、批量改）；当前格停在看得见的格子上，不把表格滚走。右键行号时点在选区里就按选中的几行出菜单（`RowMenu.tsx`：插 N 行、上移下移、删 N 行）。
- 拖动（`use-drag-select.ts`）：拖格子、行号、列名、填充柄都走这一份。每帧按鼠标坐标问浏览器是哪一格（`grid-dom.ts`，不用自己按行高列宽算，冻结列、隐藏列、筛选都不用管）；拖到数据区边上按离边的距离加速滚（按时间算，高刷新率屏幕不会更快）。只认整格露出来的格子，否则 SheetTable 会为了让当前格露全一下子滚半屏。
- 移动行只改格子（几行内容轮换，`moveRowsCells`），不做行操作：xlsx 的行样式、公式表的结构都不动，外面改过文件时也能按「只改格子」保存。筛选或排序后看到的相邻两行在表里不一定挨着，这时拒绝并提示先清掉。
- 填充柄（`grid-fill-drag.ts`，规律在 `shared/table-fill.ts`）：选区右下角的小方块（大小在设置 → 组件 → 数据表格的「填充柄大小」），往下 / 上 / 右 / 左拖，看离选区哪个方向更远。规律照 Excel：两格以上数字按步长递增、一格数字复制、结尾带数字的文字往后数（保留补的 0），按住 Ctrl 复制和递增对调；拖的时候选区跟着变大、鼠标旁提示最远那格的值，松手一次提交（一次撤销）。往下往上只填数据行，筛掉的行、隐藏的列不填。
- 读屏：能聚焦的表格容器是 `role="grid"`（`boxProps`：行列总数、多选、只读），`aria-activedescendant` 指向当前格（SheetTable 只给当前格加 id）；SheetTable 在编辑模式下是 `rowgroup`，格子是 `gridcell` 带 `aria-colindex`，行号是 `rowheader`。
- 查找条（Ctrl+F，`TableFindBar`）：只查筛选后显示的行和没隐藏的列，打字防抖 120ms，最多 5000 处；可以只查当前列。Ctrl+G 跳转：先按主键找，找不到再当行号。
- 编辑栏（工具栏「查看」里开关，`TableEditBar`，localStorage `table-edit-bar`）：看全、修改长文本，右边是这一列的规则（`ruleText`）。
- 快速筛选（`TableQuickFilter`）：只看不合规 / 改过的 / 引用缺失 / 空着的必填，几个一起是「或」，只过滤行号数组；当前的筛选、排序、快速筛选能存成视图（localStorage `table-views:<项目>:<文件#工作表>`）。
- 引用列「ID · 名称」（localStorage `table-ref-names`）：只改显示（`SheetEditing.display`），名称取被引用表同一行里像名字的列（`refOptions` 的 desc）。
- 检查结果（`ProblemsBar`）按「列 + 种类」分组（`shared/table-problems.ts`；种类是 `Problem.rule`，同一列「引用的表里没有 X / Y」算一组）。每组批量修：超出范围改成边界值、改成「也允许」的值、清空（必填 / 主键不给），先预览再一次放进表格；或让 AI 修这一组。滚动条右边一条 canvas 标出不合规、改过、查找命中的位置（`ScrollMarks`，按像素合并，点一下跳到最近的一处）。
- 内容搜索结果（`TableHits`）每条带字段名（服务端 `searchTables` 按结构文件的表头算，`sheetFieldNames`，只在这张表有命中时算一次），按文件分组、组头吸顶能折叠，上下键在结果里走、表格跟着跳。
- 跨表搜索的选项（`TableSearchOptions`，开关记在 localStorage `agent-panel.tables.search-flags`）：区分大小写、整格（数组列 `1001;1002` 里某一项整项相同也算，分隔符用项目的 `listSep`）、正则，和表格里的查找替换同一套（`findRe`）。查询写成「字段名:值」（冒号前像字段名才算：字母 / 汉字 / 下划线开头、没有空格；全角冒号也认）只在叫这个名字的列（不分大小写）的数据行里找；没有哪张表有这个字段时按整串再找一遍并提示（`fieldMissing`），所以 `12:30`、`http://…` 这类值照样能找。命中位置由服务端给（`TableHit.at`），正则、长格子都能准确高亮。
- 跨表批量替换（`ReplaceAllDialog` → `POST /replace`，`server/tables/bulk-replace.ts`）：`apply:false` 预览每个文件改几格、前 5 处改前改后、替换后有几处不合规；预览时对每个文件跑一遍 `prepareSave`（保存前的全部检查，不写），会被拒绝的标出原因、不能勾，页面上有没保存改动的文件也不能勾。`apply:true` 只写勾选的文件，带预览时的修改时间，对不上（预览之后被改过）就不写这个文件；改了查找、替换或开关后要重新预览才能替换。只改数据行，表头不动。拒绝的情况：项目只读（整个请求）；老 .xls、表格太大只读了一部分、正被 Excel / WPS 打开、预览后被改过、公式格或少见写法（原地改写做不了）、读回比对不上、「保存前检查」是「不让保存」且替换后不合规（单个文件）。每个文件写之前备份。
- 行高三档（工具栏「查看」→ 行高，localStorage `table-density`）：紧凑 22、标准跟着设置、宽松 32，通过 `SheetTable` 的 `rowHeight` 传。双击列边线按看得见的 200 行 + 表头量宽（`fitWidth`），不扫整列。
- 导表输出在表格页底部的「输出」面板（`TableOutput.tsx`），不再是弹窗：每次执行一个 `ExportRun` 一直挂着（切去看别的一次只是藏起来，不会停），留最近 20 次；关面板才停掉在跑的。
- 版本差异、跨项目对比：改过的格子只显示新值，悬停看旧 / 新；摘要里「改 / 加 / 删」能点，只看那一种行（`DiffOnly`）。
- 打开表格还在读时画骨架（`TableSkeleton`）；没有项目设表格目录时是引导卡（`TablesSetupCard`），一键打开项目设置 → 表格。
- 项目设置 →「表格」分子页：目录 · 表头 · 枚举 · 校验 · 导表 · AI 分析；底下写这一页跟着「确认」还是单独存。有没处理的 AI 分析结果时「AI 分析」上有红点（`useTablesAnalysisPending`）。
- 格子右键「统计这一列」（`ColumnStatsDialog`，`shared/table-stats.ts`）：空值、唯一值、出现最多的 10 个值、最小最大，超过 5 万行只看前面的标「抽样」；按数据建议范围 / int32 / 枚举 / 必填，点「设上」写进结构文件，设过的不再建议。不用 AI。
- 「批量修改…」（`BatchEditDialog`，`shared/table-batch.ts`）：对选中的格子加减乘除、前后缀、正则替换、按序列重新编号，实时预览每格改成什么，一次撤销。右键选区外的格子会先选中它。
- 「让 AI 改这一片…」（`AiRegionDialog`，提示词 `editRegionPrompt`）：只把选中的行列交给 AI，结果仍走 `table.propose` 先看差异。
- 提交时「按改动生成说明」（`diff-side.ts` 的 `submitSummary` → `shared/table-summary.ts`）：和上一次提交比，写成「C_Item：改 3 格（Name ×2、Level ×1），加 1 行」。还有不合规时按「保存前检查」提醒或拦下提交。
- 导表脚本可勾「保存后自动导这张表」（`TableExport.onSave`）：表格页保存后对这张表跑一次，输出进底部面板。输出里的 `文件:行:列`、`Sheet!A1` 能点，跳到对应的表和格子（`outputLocs`）。
- 外部改动：打开着的表都盯着（`server/tables/watch.ts`，2026-11-12 从每 4 秒请求 `/stat` 的轮询换掉）：页面每次连上面板的推送（插件接口 7 的 `host.events.onConnect`，含断线重连）用 `POST /watch` 把这个项目里打开着的文件和打开时的修改时间整份登记一遍；服务端 `fs.watch` 盯文件所在的目录（Excel / WPS 先写临时文件再改名的保存方式盯文件会盯丢），事件停 300ms 后看修改时间，变了才经 `ctx.pages.push('file-changed')` 推给登记了的页面，同一次只推一次；自己保存后 `saw` 记下新时间不推；页面断开时面板回调 `onClose` 清掉登记，没人盯的目录关掉 watcher（最多 256 个目录）。页面收到后：变了且没有没保存的改动就直接重新载入（正看着的才提示）；有改动时表格上方提示，可以载入新内容并把改过的格子按位置写回（只改格子、没插删行时）、丢掉改动、或先不管（保存时仍有修改时间检查）；页面藏起来时先记着、切回来再处理，正在保存时等忙完再对一次修改时间。
- xlsx 还原显示：合并单元格、批注、超链接、整行底色、隐藏的工作表由面板读出、面板的 SheetTable 画（见面板 `docs/modules/web/ui-kit.md`）；表格页把它们按没保存的插删行挪位置（`shared/table-look.ts`），表内链接（`Sheet2!A1`）切表并选中那一格。

## 导表脚本

项目设置 → 表格「导表脚本」写进 `TablesConfig.exports`（`shared/table-export.ts`）：名字、命令、执行目录、最长分钟数。命令里的占位 `{file}` `{files}` `{rel}` `{name}` `{folder}` `{project}` 执行时才换成真实路径（`fillCommand`）：按设置里选的命令行环境加引号（sh / cmd / PowerShell），已经写在引号里的只转义会打断引号的字符；WSL 下盘符路径换成 `/mnt/<盘>/`。有 `{files}` 时所有表一次传进去，没有时每张表执行一次，一条失败后面的不跑。
入口：表格页工具栏「导表」（当前这张表）和文件树右键（文件或整个文件夹）。`POST /export` 用 NDJSON 一行一个 `ExportEvent` 边跑边推（`Cache-Control: no-transform` 避开压缩攒包），页面断开就停掉命令；窗口里按帧批量刷新，每条命令只留最后 3000 行。导表读磁盘上的文件，有没保存的改动时窗口顶上提醒。

## Agent 改表格

动作在 `server/actions.ts`（ADR 0011：能力只加进动作表，不加新的 MCP 工具）。`table.list` 的 `name` 只按路径过滤（不分大小写、空格隔开的词都要含），不读表格内容；**不给 Agent 按内容跨表找的动作**（2026-11-14 去掉 `table.search`）：表格不做预处理，跨表读全部内容太慢，`/search` 只留给表格页左栏的「内容」搜索和全部替换。`table.schema` 用 `describeSheet` 列出每一列的类型、数组分隔符、枚举能填的值（最多 80 个）、引用、范围和校验规则，枚举表、被引用的表经 `/file` 读。`table.edit` 按主键或 Excel 行号改格子、末尾加行、删行，换成和表格页一样的「行操作 + 格子」走 `/save`；写之前 `checkTouched`，不合规就不写并把原因交给模型（`force: true` 只在用户明确要求时用）。

## AI（表格页工具栏「AI」）

- 照着描述加几行、让 AI 修这张表的不合规：在项目里开一个分析对话（`createAnalysisTask` + AI 窗口），提示词在 `shared/table-ai.ts`，要求 Agent 用 `table.propose`。
- `table.propose`（`server/app-actions/tables.ts`）：参数同 `table.edit`，同样 `planEdit` + `checkTouched`，不合规拦下交给模型；通过后不写文件，`POST /proposal` 存进内存（`server/tables/proposals.ts`，每个文件只留最新一份，重启就没）。
- 表格页打开文件、AI 对话结束时取 `GET /proposal`：上方提示条「看差异」按表头和主键出差异，「放进表格」用 `replaceIn` 成为一次改动（还要用户保存），然后 `DELETE /proposal`。提出之后文件 mtime 变了或页面上有没保存的改动时不让放（行号对不上）。状态只看工具调用存下的提议，不读模型回复的文字。
- 解释一列 / 这张表：只读提示词，结果就在 AI 窗口的对话里。

## 增删列

- 改动除了「行操作 + 格子」还有「列操作」（`shared/table-edit.ts` 的 `ColOp`、`SheetEdit.cols`）：先做行操作、再做列操作，格子的行列号是都做完以后的；行列操作互不影响。页面和服务端共用 `applyOps` / `applyColOps`，保存后照样重新解析逐格比对。
- 入口：列名右键、格子右键「在左边 / 右边插入一列…」「删除 X 列」（选中几列时删选中的），工具栏「插入一列」。插列弹窗（`ColumnInsertDialog`）顺便填表头每一行（修饰、导出端照左边那列预填，类型行有下拉建议，字段名查重），还能给已有的数据行填默认值（只填有内容的行）。删列先确认，说清几格有内容。
- xlsx 写入（`server/tables/xlsx-write.ts` + `xlsx-shift.ts`）：每格的列号跟着挪（没写 `r` 的格子补上），`<cols>` 的列宽 / 隐藏 / 样式区间跟着挪（插在区间里面时区间变宽，和 Excel 一样），挪过的行去掉 `spans`，`<dimension>` 重算。新插的列里的格子照同一行左边那格的样式（表头行还是表头底色），类型按值判断。
- 插删以后本机按列号记的东西跟着挪（`col-shift.ts`）：隐藏的列、冻结、拖过的列宽、列筛选和排序；撤销重做时反着挪。

### 插删行列的拒绝规则（xlsx）

位置写在里面、挪了行列不会自己跟着变的东西，这里不去改写（改错了比拒绝更糟），表里有就**不能在中间插删行列**，提示用户去 Excel / WPS 做（`shiftBlocked`）：

| 有这些就拒绝                                                | 为什么                         |
| ----------------------------------------------------------- | ------------------------------ |
| 公式（这张表里的任何 `<f>`）                                | 公式里的 A1、B2:C9 不会跟着挪  |
| 别的工作表的公式、图表的数据区、数据透视表的来源指到这张表  | 同上，跨表引用                 |
| 合并单元格、数据验证、条件格式（含 `extLst` 里的 x14 写法） | 都按「A1:C3」记范围            |
| 超链接、表格对象、自动筛选                                  | 同上                           |
| 批注、图片 / 图表                                           | 按格子位置锚定，挪了会挂错格子 |
| 名称定义（workbook 里的 `definedName`）                     | 名称里写的是位置               |

- **追加在最后一行 / 最后一列后面总可以**（加字段最常见），「最后」按文件里实际用到的最后一列算（带样式的空格子也算）。删列只要碰到原文件就有的列就算「中间」。
- 页面在插列、删列前先问服务端（`GET /shift-check?path=`，返回每张表的原因和最后一列），不能时插列弹窗只给「加在最后」、删列确认框直接说明原因；真正把关的是保存时的同一套规则。
- 插删行原来的规则（公式、合并单元格、条件格式、数据验证、超链接、表格对象、名称定义）并进了这一套，补上了跨表引用、自动筛选、批注、图片。
- CSV 没有这些，随便插删。

## 草稿（没保存的改动）

- 改动停手 400ms、页面藏起来或关掉时，把「行列操作 + 改了的格子（带改之前的值）」存进浏览器 IndexedDB（库 `agent-panel-tables`，按「项目 id + 文件路径」一份，`table-drafts.ts`）；保存、撤销到底、丢掉改动、关页签时删掉。表格文件一个字节不动。超过 30 天的打开表格页时清掉。
- 进表格页时有草稿就提醒一句，文件树上带点；打开文件时表格上方提示（`DraftBar`）：
  - 文件没变（修改时间、大小都对得上）：原样恢复，一步能撤销；
  - 文件在外面改过、草稿只改了格子：每格比「文件里现在的值」和「草稿记的改之前的值」，没动过的直接放回，两边都改了的算冲突，可以看明细、选冲突时用文件的还是我的；
  - 文件改过、草稿插删过行列：位置对不上，只给「仍按原位置恢复」并提醒核对，或丢掉。
- 还没决定恢复还是丢掉之前，这份草稿不会被覆盖。

## 一行的表单

- 工具栏「一行的表单」或格子右键「在表单里看这一行」打开右边的抽屉（`RowForm`，宽度可拖、记在本机）：竖着列出当前格所在那一行的每个字段——字段名、列字母、类型标签、表头注释行当说明、不合规的原因。
- 枚举、引用列给下拉建议（能自由填），引用列旁边能跳过去；长文本自动用多行输入框（Ctrl+回车提交）。离开输入框或回车就写进表格，和在格子里改一样能撤销。
- 跟着表格的当前格走；Alt+↑↓ 或按钮按表格现在的显示顺序（筛选、排序后）切行；能按字段名、说明筛，或只看有值的字段。
- 设置 → 组件里有示例（`RowFormSpecimen`），跟着「输入框」「弹出菜单」的微调走。

## 大表

- 表格页按 `TABLE_XLSX`（`server/tables/files.ts`）读 xlsx：单张表 200 万格、整本 400 万格（面板 `readXlsx` 的 `limits` 参数）；文件弹窗还是面板默认的 20 万 / 60 万。超过上限的表只读前面一部分并整份只读。解析、保存前后读回比对都用同一个上限（`readTableXlsx`）。
- 保存大表：原表的格子取解析缓存（不再解析一遍），写完把读回比对时的解析结果放进缓存（`primeTable`），重新打开不再解析。1 万行 × 80 列的 xlsx 改一格保存约 3 秒（性能基准 `xlsxSave`）。
- 性能基准 `scripts/bench.ts` 含一本 1 万行 × 80 列的 xlsx（`bigBook`）：读、改一格保存、跨表搜索（冷 / 热 / 按字段）、一列 1 万格的跨表替换（预览 / 写）。

## 不支持的

- 老的 `.xls` / `.et`：只列出、标「只读」，不解析（npm 上的 SheetJS 0.18.5 有已知漏洞，不引入）。
