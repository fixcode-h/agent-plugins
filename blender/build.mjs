// Blender 插件的构建钩子（scripts/build.mjs 在通用步骤之后调用 extra(out)）：
// 1. dsh-blender-plugin 副本（dsh/）逐文件转译，布局和上游 `npm run build` 一致：
//    src/**/*.ts → dsh/lib/**/*.js（宿主层，服务端加载 dsh/lib/panel-entry.js），
//    runtime/**/*.ts → dsh/lib/runtime/**/*.js（Gateway 子进程 lib/runtime/gateway.js 和它起的探针子进程）。
//    不打成一个文件：上游按 import.meta.url 推包根、按 lib/runtime/*.js 的路径起子进程。
// 2. 运行时的 Python 资产（dsh/runtime/py/）、package.json（上游按它认包根，type: module 让 lib/*.js 按 ESM 加载）、
//    许可证、Blender 扩展的安装包原样复制。
// 3. 模型设计的桥接脚本 server/bridge/bridge.py。
import { cpSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DSH = path.join(HERE, 'dsh')

function walk(dir, test, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name)
    if (e.isDirectory()) walk(f, test, out)
    else if (test(e.name)) out.push(f)
  }
  return out
}
const isTs = (n) => /\.ts$/.test(n) && !/\.(d|test)\.ts$/.test(n)

/** 转译 dsh 到 outRoot/lib，返回转了多少个文件 */
export async function buildDsh(outRoot) {
  let n = 0
  for (const [src, out] of [
    [path.join(DSH, 'src'), path.join(outRoot, 'lib')],
    [path.join(DSH, 'runtime'), path.join(outRoot, 'lib', 'runtime')],
  ]) {
    const files = walk(src, isTs)
    mkdirSync(out, { recursive: true })
    await build({
      entryPoints: files,
      outdir: out,
      outbase: src,
      bundle: false,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'warning',
    })
    n += files.length
  }
  return n
}

export async function extra(out) {
  const dsh = path.join(out, 'dsh')
  const n = await buildDsh(dsh)
  cpSync(path.join(DSH, 'runtime', 'py'), path.join(dsh, 'runtime', 'py'), {
    recursive: true,
    filter: (f) => !/__pycache__|\.pyc$/.test(f),
  })
  for (const f of ['package.json', 'LICENSE', 'README.md', 'dsh-blender.config.example.json'])
    cpSync(path.join(DSH, f), path.join(dsh, f))
  mkdirSync(path.join(dsh, 'extension'), { recursive: true })
  for (const f of ['dsh_blender_bridge.zip', 'LICENSE', 'NOTICE'])
    cpSync(path.join(DSH, 'extension', f), path.join(dsh, 'extension', f))
  mkdirSync(path.join(out, 'server', 'bridge'), { recursive: true })
  cpSync(path.join(HERE, 'server', 'bridge', 'bridge.py'), path.join(out, 'server', 'bridge', 'bridge.py'))
  console.log(`blender：dsh-blender-plugin 转译了 ${n} 个文件`)
}

// 只转译 dsh 到源码目录（本地调试上游代码用）：node blender/build.mjs
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(`转译了 ${await buildDsh(DSH)} 个文件`)
