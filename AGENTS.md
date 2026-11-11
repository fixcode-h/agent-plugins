# agent-plugins · 开发约定

给在这个仓库里工作的 AI 编码助手和开发者看。`CLAUDE.md` 只引用本文件。

- 每个子目录是一个 [Agent 面板](https://github.com/fixcode-h/agent-panel) 插件的源码，插件的约定见 README.md 和面板的 ADR 0059（`docs/adr/0059-plugin-system.md`）。
- 插件只通过 `sdk/` 里的接口和面板打交道，不 import 面板源码。`sdk/` 是面板 `server/plugins/sdk.ts`、`web/src/plugins/sdk.ts`、`web/src/index.css` 主题块的副本，面板改了要同步。
- 面板插件接口 4 起，插件可以直接 import 面板开放的模块（清单 `sdk/host-modules.json`，面板 `shared/plugins/host-modules.json` 的副本）：插件目录照面板源码布局放文件（`web/src/…`、`server/…`、`shared/…`，`@/`、`@shared/` 别名和面板一致），插件里没有的文件构建时接到面板的那一份（`scripts/build.mjs` 的 `panelModules`）。清单外的模块不能用，要用先在面板加进清单。这样的插件清单里 `api` 写 4。
- 网页部分的 Tailwind 类名一律带插件自己的前缀（`index.css` 里 `prefix(…)`，例如 `bl:flex`）：不带前缀时插件样式里的 `.flex-col` 会盖掉面板的 `md:flex-row`，面板整页布局乱掉。
- 界面文案用 `t('中文原文')`，英文写进插件的 `locales/en.json`（`npm run check` 查漏翻）；发给 Agent 的提示词、注释不翻译。注释用中文，写「为什么」。
- 上游代码的副本（如 `blender/dsh/`）只改接入的地方，改动记在旁边的 `VENDORED.md`。
- 凭据不进仓库。临时文件放 `.tmp/` 或系统临时目录。
- 提交前：`npm run check && npm run build`，用面板「链接本机目录」装 `dist/<id>` 试一遍；改了版本号就同时改 `plugin.json` 和 `plugins.json`。
