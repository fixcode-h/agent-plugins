// UE 插件的构建钩子（scripts/build.mjs 在通用步骤之后调用 extra(out)）：
// 把 UE 端桥接插件的源码（bridge/AgentPanelBridge，C++）原样放进包里，安装到项目时从包里复制（server/install.ts）。
import { cpSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export async function extra(out) {
  cpSync(path.join(HERE, 'bridge', 'AgentPanelBridge'), path.join(out, 'bridge', 'AgentPanelBridge'), {
    recursive: true,
    // 本地在 UE 里编过的产物不进包
    filter: (f) => !/[\\/](Binaries|Intermediate)([\\/]|$)/.test(f),
  })
  console.log('ue：带上了桥接插件源码 bridge/AgentPanelBridge')
}
