# Blender 插件

Agent 面板的 Blender 插件：一比一接入 [dsh-blender-plugin](https://github.com/sixtysevenlf/dsh-blender-plugin) 的建模能力，
再加上面板原来的 Blender 能力（技能、角色、工作流和模型设计页）。

## 提供什么

- **Blender 工具**（MCP 服务 `blender`）：`blender_session`（会话、写权限、快照回滚、体检）、`blender_op`（228 个建模算子）、
  `blender_py`（在 GUI 会话里执行 Python）、`blender_see`（看视口）、`blender_run`（无头作业和渲染排队）、`blender_inspect`（只读检查）。
  驱动的是用户自己开着的 Blender：在 Blender 里装上 DSH Blender Bridge 扩展（插件页上能下载），在 N 面板里点连接。
- **模型设计**（MCP 服务 `blender-model`）：设计模式下多一类「模型设计」，每个模型对话在后台开一个 Blender，
  Agent 用 `blender_python` / `blender_scene` 建模，对话右栏的「模型」页签实时预览（three.js 读导出的 glb）。
- **技能**：`blender-modeling`（上游）、`blender`（无头脚本、体检、多视角截图、UE 导出）、`blender-model-animation-workflow`。
- **角色和工作流**：「Blender 建模」角色、「Blender 建模与动画」工作流。打开插件时建出来，关掉或删除时没改过、没人用的副本删掉（先备份）。

哪些对话挂 Blender 工具：模型设计对话、用到上面技能的角色，或者参数里选了「所有对话」。

## 参数

在面板「设置 → 插件 → Blender」里改，对应上游的环境变量：

| 参数                     | 环境变量                      | 默认                    |
| ------------------------ | ----------------------------- | ----------------------- |
| Blender 可执行文件       | `DSH_BLENDER_EXE`             | 自动查找                |
| 工作目录                 | `DSH_BLENDER_WORKDIR`         | 自动                    |
| Gateway 端口             | `DSH_BLENDER_GATEWAY_PORT`    | 39877                   |
| 虚拟 GUI                 | `DSH_BLENDER_VIRTUAL_GUI`     | 按系统                  |
| 虚拟 GUI 实例上限        | `DSH_BLENDER_VIRTUAL_GUI_MAX` | 4                       |
| 无头作业等待窗口         | `DSH_HEADLESS_WAIT_MS`        | 100 秒                  |
| 写权限租约               | `DSH_BLENDER_LEASE_TTL_MS`    | 10 分钟                 |
| 哪些对话挂 Blender 工具  | —                             | 模型设计和 Blender 角色 |
| 打开插件时就启动 Gateway | —                             | 开                      |

改了前七项插件会重启（Gateway 子进程按新的环境变量起）。

## 目录

```
plugin.json        清单
server/            服务端入口（dsh 宿主适配、模型设计的后台 Blender 和桥接脚本 bridge/bridge.py）
web/               网页入口（模型设计弹窗、3D 预览页签、插件页状态面板）和样式
locales/en.json    英文文案
skills/art/        三个技能
dsh/               dsh-blender-plugin 副本，改动见 dsh/VENDORED.md
build.mjs          构建钩子：转译 dsh、复制 Python 资产和 Blender 扩展
```

模型设计的场景存在插件数据目录 `plugin-data/blender/models/<对话>/`，删除插件时一起删；面板旧版本存在数据目录 `models/` 下的场景照样能打开。
