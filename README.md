# Agent 面板插件

[Agent 面板](https://github.com/fixcode-h/agent-panel) 的插件仓库，也是面板默认的插件市场：面板「设置 → 插件」读这里的 `plugins.json`，
按里面写的 Release 附件下载插件包安装。

| 插件                  | 说明                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [Blender](blender/)   | 一比一接入 dsh-blender-plugin：GUI 会话里执行 Python、看视口、228 个建模算子、无头作业；附带模型设计页                         |
| [UE](ue/)             | 按项目连接运行中的 UE 5.4+：控制台、GM、找 Actor、读改运行时属性、DataTable 和资源（编辑器没开也能读）、日志；带 UE 端桥接插件 |
| [UI 设计](ui-design/) | 用对话设计游戏界面和网页：控件树、原画、切图和还原、标注、版本、导出；原来是面板自带的「设计」模式                             |

## 插件是什么

插件是一个自包含的包（面板 ADR 0059），装在面板数据目录的 `plugins/<id>/`，删掉不影响面板：

- `plugin.json`：清单。名字、版本、参数（在插件页上生成表单）、技能触发说明、角色、工作流、MCP 服务名、工具显示名、入口；
- `server/index.js`：服务端入口，默认导出 `activate(ctx)`，返回插件接口（`fetch`）、每轮对话挂哪些 MCP 工具（`tools`）、参数变化（`onConfig`）、状态和停止；
- `web/index.js`、`web/index.css`：网页入口，默认导出 `activate(host)`，返回设计模式、对话右栏页签、插件页状态面板；
- `skills/<分类>/<名字>/`、`locales/en.json` 和插件自己的资源。

接口的类型在 `sdk/`（面板 `server/plugins/sdk.ts`、`web/src/plugins/sdk.ts` 的副本）。网页部分和面板共用 React：
构建时把 `react` 系的 import 换成面板放在 `globalThis.__agentPanel` 上的那一份；样式只出用到的 Tailwind 工具类，颜色用面板的主题变量（`sdk/theme.css`）。
类名要带插件自己的前缀（Blender 插件是 `bl:`，写成 `bl:flex`、`bl:md:flex-row`）：插件样式表在面板之后加载，不带前缀的同名类会盖掉面板的响应式类，把面板的布局弄乱。构建时会检查：`index.css` 要写 `prefix(<前缀>)`，产物里的类只能是 `<前缀>:…` 或插件自己写的 `<前缀>-…`，不然构建失败。

## 开发

```bash
npm install
npm run check                 # 类型检查、漏翻检查、plugins.json 和各插件对得上；有 .panel 时再核对 sdk/ 副本和面板一致
npm run build                 # 所有插件 → dist/<id>/ 和 dist/<id>-<版本>.zip
npm run build -- blender      # 只构建一个
npm run panel                 # 准备 .panel（面板源码）：ui-design 这类照面板源码布局放文件的插件，类型检查和单测要用
npm test                      # 这类插件的单测
```

在面板「设置 → 插件 → 其他来源」里选「链接本机目录」，填 `dist/<id>` 就能直接试；改完重新构建，在插件页关掉再打开即可。
也可以把 `dist/<id>-<版本>.zip` 用「从压缩包安装」装上。

## 发布

推到 `main` 后 GitHub Actions（`.github/workflows/release.yml`）检查、构建，每个插件的包发到 Release：标签 `<id>-v<版本>`，附件 `<id>-<版本>.zip` 和校验文件 `<id>-<版本>.zip.sha256`（面板下载后核对，对不上不装）。
同一版本号的 Release 已经有了时不覆盖：内容一样就跳过，内容变了只出警告，要发布就升版本号。
要让用户收到新版本，同时改插件的 `plugin.json` 和根上 `plugins.json` 里的版本号（`npm run check` 会核对）。

## 新增插件

1. 新建 `<id>/`，写 `plugin.json`（`id` 和目录名一致，`api` 写面板的插件接口版本），按需要加 `server/index.ts`、`web/index.tsx`、`web/index.css`、`skills/`、`locales/en.json`；
2. 有特别的资源要放进包里，写 `<id>/build.mjs` 导出 `extra(out)`；
3. 在 `plugins.json` 里加一项；
4. `npm run check && npm run build`，链接 `dist/<id>` 到面板试装、试删除（删除后面板要照常工作）。

界面文案用 `t('中文原文')`，英文写进 `locales/en.json`；发给 Agent 的提示词不翻译。
