// 构建插件包：node scripts/build.mjs [插件目录...]，不写就构建所有带 plugin.json 的子目录。
// 产物：dist/<id>/（解开的包，开发时可以在面板「链接本机目录」直接装）和 dist/<id>-<版本>.zip（发到 Release 的附件）。
//
// 包的布局（面板 ADR 0059）：plugin.json、server/index.js（服务端入口，依赖打进去）、web/index.js + web/index.css、
// locales/en.json、skills/<分类>/<名字>/，再加插件自己的构建钩子（<插件>/build.mjs 的 extra）放进去的资源。
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { zipDir } from './zip.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')

/**
 * 网页入口和面板共用一份 React：react、react/jsx-runtime、react-dom 换成读 globalThis.__agentPanel 的 CommonJS 模块，
 * esbuild 会把 import { useState } from 'react' 这类具名导入接到它上面
 */
const SHARED = {
  react: 'React',
  'react/jsx-runtime': 'jsxRuntime',
  'react/jsx-dev-runtime': 'jsxRuntime',
  'react-dom': 'ReactDOM',
}
const panelReact = {
  name: 'agent-panel-react',
  setup(b) {
    b.onResolve({ filter: /^react(-dom)?(\/jsx-(dev-)?runtime)?$/ }, (a) => ({
      path: a.path,
      namespace: 'agent-panel',
    }))
    b.onLoad({ filter: /.*/, namespace: 'agent-panel' }, (a) => ({
      contents: `const p = globalThis.__agentPanel; if (!p) throw new Error('需要在 Agent 面板里加载'); module.exports = p.${SHARED[a.path]}`,
      loader: 'js',
    }))
  },
}

function pluginDirs(args) {
  if (args.length) return args.map((a) => path.resolve(ROOT, a))
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(ROOT, e.name, 'plugin.json')))
    .map((e) => path.join(ROOT, e.name))
}

async function buildPlugin(dir) {
  const manifest = JSON.parse(readFileSync(path.join(dir, 'plugin.json'), 'utf8'))
  const out = path.join(DIST, manifest.id)
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  writeFileSync(path.join(out, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n')
  for (const sub of ['locales', 'skills'])
    if (existsSync(path.join(dir, sub))) cpSync(path.join(dir, sub), path.join(out, sub), { recursive: true })
  for (const f of ['LICENSE', 'README.md'])
    if (existsSync(path.join(dir, f))) cpSync(path.join(dir, f), path.join(out, f))

  if (manifest.server) {
    await build({
      entryPoints: [path.join(dir, 'server', 'index.ts')],
      outfile: path.join(out, manifest.server),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      // 打进来的 CommonJS 依赖可能用 require：给 ESM 产物补一个
      banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
      logLevel: 'warning',
    })
  }
  if (manifest.web) {
    await build({
      entryPoints: [path.join(dir, 'web', 'index.tsx')],
      outfile: path.join(out, manifest.web),
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      jsx: 'automatic',
      minify: true,
      plugins: [panelReact],
      logLevel: 'warning',
    })
  }
  if (manifest.css) {
    execFileSync(
      process.execPath,
      [
        path.join(ROOT, 'node_modules', '@tailwindcss', 'cli', 'dist', 'index.mjs'),
        '-i',
        path.join(dir, 'web', 'index.css'),
        '-o',
        path.join(out, manifest.css),
        '--minify',
      ],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
    )
  }
  const hook = path.join(dir, 'build.mjs')
  if (existsSync(hook)) await (await import(pathToFileURL(hook).href)).extra(out)

  for (const k of ['server', 'web', 'css'])
    if (manifest[k] && !existsSync(path.join(out, manifest[k])))
      throw new Error(`${manifest.id}：构建后缺少 ${manifest[k]}`)

  const zip = path.join(DIST, `${manifest.id}-${manifest.version}.zip`)
  writeFileSync(zip, zipDir(out))
  console.log(`${manifest.id} ${manifest.version} → ${path.relative(ROOT, zip)}`)
  return { manifest, zip }
}

const built = []
for (const dir of pluginDirs(process.argv.slice(2))) built.push(await buildPlugin(dir))
// 给 Release 工作流用：每个插件的 id、版本、包名
writeFileSync(
  path.join(DIST, 'built.json'),
  JSON.stringify(
    built.map((b) => ({ id: b.manifest.id, version: b.manifest.version, asset: path.basename(b.zip) })),
    null,
    2,
  ),
)
