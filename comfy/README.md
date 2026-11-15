# ComfyUI 工作流插件

管理本机 ComfyUI 的工作流：按游戏 / 网页 / 图片处理分组的列表、节点图画布和节点参数、试生成、模板商店、工作流链，AI 生成和优化工作流，导入导出 ComfyUI。原来是面板自带的「ComfyUI 工作流」页，2026-11-15 搬成插件（面板复查报告 C3），做法参考表格和视频插件。

## 组成

- **整页**（`web/index.tsx`，`pages`）：图标栏的「ComfyUI 工作流」。地址 `#/plugin/comfy/comfy/<game|web>/<工作流 id>`，面板把旧地址 `#/comfy/<分类>/<工作流>` 转过来。
- 只有网页部分，没有服务端入口：工作流的增删改、模板商店、工作流链、试生成都走面板的 `/api/local-image`（`server/comfy.ts`、`server/comfy-templates.ts`），网页经面板开放的 `web/src/lib/api` 调。

## 留在面板的

生图服务是 UI 设计（出图）和视频截帧（画质增强）的底座，所以没搬，这两个插件不依赖本插件：

- 装 ComfyUI、下模型、跑工作流的服务端和设置 →「本机生图」（`LocalImageSection`）；
- `shared/local-image`、`shared/comfy-chain`、`shared/comfy-templates`、`shared/comfy-layout`；
- 节点图 `ComfyGraphView`、运行队列 `ComfyQueuePanel`、ComfyUI 网页弹窗 `ComfyWeb`（UI 设计也用，开放模块）。

UI 设计插件里「游戏 / 网页工作流管理」要打开这里的页面，所以 UI 设计的清单 `requires` 写了 `comfy`，装 UI 设计时面板会把它一起装上（面板插件接口 10）。

## 代码布局

照面板源码的布局放文件，插件里没有的模块构建时接到面板开放的那一份（清单 `sdk/host-modules.json`）。和面板里时不一样的地方：

- `web/src/pages/ComfyPage.tsx` 从插件整页的 `path` 读分类和工作流 id，换页用 `web/src/lib/comfy-nav.ts` 的 `comfyRoute`；
- 类名一律带前缀 `cf:`（`web/index.css` 的 `prefix(cf)`）；`panel`、`thin-scroll` 这类面板自己的类和 xyflow 的 `nodrag` 不加前缀。

## 还没有的

面板时代的界面检查（节点图适应、模板商店、工作流链，`scripts/ui/04-design.mjs`、`08-misc.mjs`）随页面搬走后，插件这边还没有对应的界面检查。
