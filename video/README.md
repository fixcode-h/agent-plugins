# 视频截帧插件

把视频拖进对话输入框就能截帧：播放器里手动截、按画面变化 / 录屏 / 均匀自动截，选段、标注、去重、看前后变化，用 FFmpeg 或 ComfyUI 做画面增强，发送时换成选好的帧图片（Agent 收不了视频）。Agent 也能自己调 `video_frames` 从视频里截帧来看。原来是面板自带的功能，2026-11 拆成插件，做法参考 UI 设计插件。

## 组成

- **输入框附件**（`web/index.tsx`，面板插件接口 6 的 `attachmentIntakes`）：视频作为卡片留在输入框、只引用原路径，点卡片打开截帧弹窗（`web/src/components/video/VideoFramesDialog.tsx`），选好的帧记在卡片上，发送时换成帧图片。
- **服务端**（`server/index.ts`）：截帧、FFmpeg 下载、增强的接口挂在 `/api/plugins/video/api/video/`；数据在面板数据目录的 `video/`（FFmpeg 和设置）、`video-frames/`（截帧记录），和面板自带时同一个位置。
- **Agent 工具**：MCP 服务 `video`，工具 `video_frames`，只在用户在聊的对话里提供，帧写进这个对话自己的 attachments/ 目录。
- 画面增强用面板的 ComfyUI（`server/comfy`，开放模块），ComfyUI 本身留在面板里。

## 代码布局

照面板源码的布局放文件（`web/src/…`、`server/…`、`shared/…`），插件里没有的模块构建时接到面板开放的那一份（清单 `sdk/host-modules.json`）。和面板里时不一样的地方：

- `web/index.tsx`：插件入口，登记输入框认领视频。
- `web/src/lib/video-api.ts`：请求改到插件自己的接口。
- 类名一律带前缀 `vd:`（`web/index.css` 的 `prefix(vd)`）。

## 文档

- `docs/README.md`：模块文档（截帧弹窗、自动截帧、增强、标注、Agent 工具），从面板仓库搬来。
- `docs/bugs/`：用户报过的 Bug。

## 开发

```bash
npm run panel              # 准备 .panel
npx tsc --noEmit -p video  # 类型检查（npm run typecheck 也会跑）
npm test                   # 单测（frames.test.ts 要本机有 ffmpeg，没有就跳过）
node scripts/build.mjs video
```
