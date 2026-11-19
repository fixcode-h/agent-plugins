// UE 插件的构建钩子（scripts/build.mjs 在通用步骤之后调用 extra(out)）：
// 把 UE 端插件 UELink 的源码（bridge/UELink，UEKit 插件库里 UELink 发布版的副本）原样放进包里：
// 安装时和公共库的最新版取高的复制进项目（server/install.ts），断网也能装。
// 再把测试步骤「蓝图编译」的脚本（server/bp-check/cli.ts）单独打成 bin/bp-compile.mjs：它由 Agent 的 shell 或面板直接用 node 跑，
// 不在面板进程里，所以不能放进 server/index.js。
import { cpSync } from 'node:fs'
import { build } from 'esbuild'
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
  await build({
    entryPoints: [path.join(HERE, 'server', 'bp-check', 'cli.ts')],
    outfile: path.join(out, 'bin', 'bp-compile.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'warning',
  })
  console.log('ue：打出了蓝图编译脚本 bin/bp-compile.mjs')
}
