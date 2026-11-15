# wraps/：包装配方

Agent 面板「从 GitHub 链接包装…」（面板 ADR 0068）用的社区配方：把一个没有 `plugin.json` 的开源仓库包装成标准插件包。
面板包装某个仓库时先找这里的 `<owner>__<repo>.json`，有就按配方来（预览右上角写「社区配方 · 插件市场审核过」），没有才用识别器自动识别。

- 文件名：`<owner>__<repo>.json`，`repo` 字段要和文件名对上。
- 格式：面板 `shared/plugins/wrap/recipe.ts` 的 `WrapRecipe`（zod）。只能写声明式的字段：技能 / 命令 / 角色从哪来、复制哪些路径、排除哪些、安装动作（白名单：`npm-ci`、`npm-package`、`uv-tool`、`release-asset`、`npm-run`）、MCP、环境变量、PATH、插件参数、托管进程、网页页面。不能写脚本。
- 环境变量不能写凭据（`*_API_KEY`、`*_TOKEN` 这类）和面板 / CLI 自己的变量，要用户填的写成插件参数，值用 `{config.<key>}` 引用。
- 生效范围：只有技能和环境变量的写 `global`；带 MCP、托管进程或 PATH 的写 `project`。
- 审核：合进来之前看一遍上游仓库要装进包的那几个目录（技能的提示词、会跑的脚本），确认没有提示注入和外传；上游改了结构（配方里的目录没了）面板会停下来提示，跟着改配方。
- 检查：`npm run check` 跑 `scripts/check-wraps.mjs`，拦文件名、必填字段、路径越界、凭据变量、不在白名单的安装动作这些常见写错；完整格式面板安装时按 `WrapRecipe` 再查。

| 配方 | 上游 | 包成什么 |
| --- | --- | --- |
| `tt-a1i__archify.json` | [tt-a1i/archify](https://github.com/tt-a1i/archify)（Apache-2.0） | 纯技能插件：`archify/` 装成技能（示例目录不进包），Chrome 路径交给 `ARCHIFY_CHROME`，关掉上游自己的更新提醒 |
