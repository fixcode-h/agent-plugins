// UE 插件的构建钩子（scripts/build.mjs 在通用步骤之后调用 extra(out)）：
// 把 UE 端插件 UELink 的源码（bridge/UELink，公共库 fixcode-h/UELink 发布版的副本）原样放进包里：
// 安装时和公共库的最新版取高的复制进项目（server/install.ts），断网也能装。
import { cpSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export async function extra(out) {
  cpSync(path.join(HERE, 'bridge', 'UELink'), path.join(out, 'bridge', 'UELink'), {
    recursive: true,
    // 本地在 UE 里编过的产物不进包
    filter: (f) => !/[\\/](Binaries|Intermediate)([\\/]|$)/.test(f),
  })
  console.log('ue：带上了 UELink 源码 bridge/UELink')
}
