# dsh-blender-plugin 副本

这里是 [dsh-blender-plugin](https://github.com/sixtysevenlf/dsh-blender-plugin)（BSD-3-Clause，见 `LICENSE`）3.1.0-alpha.1 的副本，
Blender 插件用它一比一提供建模能力：6 个模型工具（`blender_session` / `op` / `py` / `see` / `run` / `inspect`）、34 族 228 个算子、
Gateway 后端和 Blender 端扩展 DSH Blender Bridge（`extension/`）。

## 带了什么

- `src/`：宿主层（工具定义、生命周期、Gateway 进程控制），构建成 `lib/`；
- `runtime/`：Gateway 和运行时（TypeScript 构建成 `lib/runtime/`，Python 资产 `runtime/py/` 原样带上）；
- `extension/`：Blender 扩展的源码和安装包 `dsh_blender_bridge.zip`；
- `docs/`、`README.md`、`CHANGELOG.md`、`LICENSE`、`dsh-blender.config.example.json`。

不带上游给 DSH 宿主用的入口和依赖（cordis、schemastery、TUI 注册）、测试和构建产物。

## 改了什么

面板不是 DSH 宿主，只改了接入的地方，工具的参数、说明、执行和回执文字都没动：

| 文件                         | 改动                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/panel-entry.ts`         | 新增。面板加载宿主层的唯一入口，只转出注册工具、生命周期、Gateway 进程控制要用的函数                     |
| `src/host/dsh-tools-shim.ts` | 新增。代替 `@deepseek-ai/dsh-tools` 的 `defineTool`：原样返回工具定义，交给面板转成 MCP 工具             |
| `src/contracts/tool.ts`      | `defineTool` 改从上面的 shim 取；设了 `DSH_PANEL_HOST` 时不去解析 schemastery（面板自己把参数转成 JSON Schema） |
| `package.json`               | 换成只有名字、版本和 `"type": "module"` 的最小版本：上游按它认包根，`lib/*.js` 按它当 ESM 加载          |

## 升级上游

1. 用上游新版本的 `src/`、`runtime/`、`extension/`、文档覆盖这里，保留上表里的改动（新增的两个文件、`tool.ts` 里标了「Agent 面板改动」的两处）；
2. `package.json` 和 `../plugin.json`、`../../plugins.json` 的版本号改成上游的版本；
3. `node blender/build.mjs` 转译一遍，确认没有新的外部依赖（`grep -rn "from '@" src runtime`），再 `npm run build` 出包试装。
