# 表格插件

游戏配置表这类 xlsx / CSV 表格的管理：按项目设置的目录浏览、搜索、筛选，在线改单元格（只改格子的值，文件仍是原来的 Excel / WPS 格式），表头、枚举、引用、取值范围这些结构信息存在表格之外；版本差异、一格的历史、提交和冲突合并、跨项目对比、导表脚本、AI 分析表格风格。Agent 能用 `table.*` 面板动作按主键查改，评审里的表格改动按格子比。原来是面板自带的表格页，2026-11 拆成插件，做法参考 UI 设计和视频插件。

## 组成

- **整页**（`web/index.tsx`，`pages`，`keep: true`）：图标栏的「表格」，打开过就一直挂着，切走只藏起来（打开的表、没保存的改动、滚动位置都留着）。地址 `#/plugin/tables/tables/<项目 id>`，面板把旧地址 `#/tables/<项目>` 转过来。
- **项目设置的「表格」页**（`projectSections`）：表格目录、表头、枚举、校验、导表、AI 分析；目录这些设置存在 `project.plugins.tables`，跟项目设置一起保存。
- **设置 →「组件」里的示例**（`specimens`）：枚举下拉、列表编辑、检查结果栏。
- **服务端**（`server/index.ts`）：表格页的接口挂在 `/api/plugins/tables/api/tables/`；`table.*` 面板动作（`server/actions.ts`）；评审里 `.xlsx` / `.xlsm` 的差异（`server/review.ts`，`textify.diff`）。
- **数据**：结构文件在项目目录 `.agentpanel/tables/` 或数据目录 `tables/<项目 id>/`，保存前的备份在数据目录里，和面板自带时同一个位置；插件删了也照样留着。

## 代码布局

照面板源码的布局放文件（`web/src/…`、`server/…`、`shared/…`），插件里没有的模块构建时接到面板开放的那一份（清单 `sdk/host-modules.json`）。文件预览里的表格（`SheetTable`、表头识别、格子差异和它的后台线程、xlsx / CSV 解析）留在面板，插件用同一份。和面板里时不一样的地方：

- `web/index.tsx`：插件入口；`web/src/lib/tables-api.ts` 请求改到插件自己的接口；`web/src/lib/tables-nav.ts` 的 `tablesRoute`、`TABLES_SECTION` 是新的地址和设置页名。
- `shared/tables.ts` 的 `tablesOf`：从项目上取表格设置（`project.plugins.tables`）。
- 「AI 分析表格风格」：服务端 `/analyze-prompt` 出提示词，网页用面板的 `runPromptInProject` 开对话。
- 类名一律带前缀 `tb:`（`web/index.css` 的 `prefix(tb)`）；`sheet-*` 是面板 `sheet-table.css` 的类，不加前缀。

## 文档

模块说明和 Bug 记录在 [docs/](docs/README.md)。性能基准 `scripts/bench.ts`（跑法写在文件开头）。
