# UI 设计插件

用对话设计游戏界面和网页：AI 改控件树、加图片和动画，出整屏原画、按原画抠切图和还原，标注、版本和导出（UE 控件树、React 网页、ZIP）。原来是面板自带的「设计」模式，2026-11 拆成插件，做法参考 Blender 插件的「模型设计」。

## 组成

- **设计模式**：侧栏的设计页里多一项「UI 设计 · 界面·原画·切图」，侧栏列 UI 项目和设计稿，右边是设计页（画布、层级、属性、动画、图片、标注、对话）。
- **服务端**（`server/index.ts`）：设计稿的读写、出图、导出、无头截图；设计稿存在面板数据目录的 `plugin-data/ui-design/designs/`。第一次启用时把旧版面板的 `designs/` 搬过来（搬不动就复制一份，旧目录里留 `MOVED.txt`）。
- **Agent 工具**：MCP 服务 `design`，29 个工具（看控件树、改控件、加图、动画、截图对比……），只在设计稿的对话里提供。
- **无头截图页**：`#/pbare/ui-design/capture/<设计稿>`，服务端用无头浏览器打开它截图、比对还原效果。

风格库、本机出图（ComfyUI）和浏览器扩展还在面板里，插件直接用。

## 代码布局（插件接口 4）

插件照面板源码的布局放文件：`web/src/…`、`server/…`、`shared/…`，`@/`、`@shared/` 别名和面板一样。插件里没有的模块（对话组件、`invokeCli`、出图、无头浏览器……）构建时接到面板开放的那一份（清单 `sdk/host-modules.json`），所以这些代码和在面板里时几乎一字不差。和面板不一样的地方：

- `web/index.tsx`：插件入口，登记设计模式和无头截图页。
- `web/src/plugin/nav.tsx`：面板路由 `#/pdesign/ui/<设计稿>/<子页>` 和原来设计页用的 `design/<设计稿>/<子页>` 互相转换，设计页代码不用改。
- `web/src/lib/api.ts`：`/designs` 请求转到插件自己的接口 `/api/plugins/ui-design/api/designs`。
- `web/src/lib/design-store.ts`：设计稿列表的状态，原来放在面板的全局数据里。
- `web/src/lib/data.ts`：转出面板的 `@/lib/data`，导航类型里补回 `design` 页（面板删掉自带的设计后没有了），实际地址由 `nav.tsx` 换算。
- 类名一律带前缀 `ud:`（`web/index.css` 的 `prefix(ud)`）；面板自定义的几个工具类（`panel`、`frost-card`……）在 `web/index.css` 里抄了一份。

## 文档

- `docs/design-module.md`：模块文档（数据流、关键文件、原画还原各期、回归记录），从面板仓库搬来。
- `docs/umg-export.md`：导出给 UE 的控件树格式。
- `docs/lessons/`：踩过的坑；`docs/bugs/`：用户报过的 Bug。
- 面板这边留下的（设计模式的外壳、ComfyUI 工作流页、风格库、浏览器扩展）见面板仓库的 `docs/modules/design/README.md`。

## 开发

```bash
npm run panel                  # 准备 .panel：旁边有 ../agent-panel 就链过去，没有就克隆面板 dev 分支并装依赖
npx tsc --noEmit -p ui-design  # 类型检查（npm run typecheck 也会跑）
npm test                       # 单测，插件里没有的模块从 .panel 取
node scripts/build.mjs ui-design
```

需要面板插件接口 4（面板 dev 分支已有）。在面板「设置 → 插件 → 链接本机目录」选 `dist/ui-design` 试用。
