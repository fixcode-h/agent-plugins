# bridge/UELink：UE 端插件的副本

`UELink/` 是 UEKit 插件库 [fixcode-h/UEKit](https://github.com/fixcode-h/UEKit) 里 UELink 发布版源码包的原样副本，版本和 sha256 记在 `uelink.json`。（2.1.0 及以前发在已删除的 fixcode-h/UELink 仓库，2.2 起发在 UEKit，标签 `UELink-v<版本>`。）

- **不在这里改 C++**：改动去 UEKit 仓库的 `plugins/UELink` 做、发版，再用 `node ue/scripts/sync-uelink.mjs [版本]` 换过来（不写版本取最新正式版；会按发布清单校验 sha256）。
- 插件包带着这份副本，断网、内网也能装；联网时安装会和公共库的最新正式版比，取高的（`server/uelink.ts`、`server/install.ts`）。
- 原来的 `bridge/AgentPanelBridge` 已经合进 UELink（2.0.0），不再维护。
