// 构建插件包：node scripts/build.mjs [插件目录...]，不写就构建所有带 plugin.json 的子目录。
// 产物：dist/<id>/（解开的包，开发时可以在面板「链接本机目录」直接装）和 dist/<id>-<版本>.zip（发到 Release 的附件）。
//
// 包的布局（面板 ADR 0059）：plugin.json、server/index.js（服务端入口，依赖打进去）、web/index.js + web/index.css、
// locales/en.json、skills/<分类>/<名字>/，再加插件自己的构建钩子（<插件>/build.mjs 的 extra）放进去的资源。
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

/**
 * 面板开放的模块（面板插件接口 4，清单 sdk/host-modules.json 是面板 shared/plugins/host-modules.json 的副本）：
 * 插件目录照面板的源码布局放文件（web/src/…、server/…、shared/…）时，import 先找插件自己的文件，
 * 插件里没有、清单里开放了的接到面板挂在全局上的那一份（网页 globalThis.__agentPanel.modules，服务端 __agentPanelServer.modules），
 * 和面板共用同一份状态。@/ 是插件的 web/src/，@shared/ 是插件的 shared/，和面板的别名一致，搬过来的代码不用改 import。
 * 都没有时构建直接报错：多半是面板没开放这个模块，要先在面板加进清单。
 */
const HOST_MODULES = JSON.parse(readFileSync(path.join(ROOT, 'sdk', 'host-modules.json'), 'utf8'))
const EXTS = ['', '.ts', '.tsx', '.js', '.mjs', '.json', '/index.ts', '/index.tsx', '/index.js']
const findLocal = (p) => EXTS.map((e) => p + e).find((f) => existsSync(f) && !statSync(f).isDirectory())

function panelModules(dir, side) {
  const allowed = new Set(HOST_MODULES[side])
  // 要和面板共用同一份实例的第三方包（zod：面板开放模块里的 schema 要能和插件自己的拼在一起）
  const packages = new Set(HOST_MODULES[`${side}Packages`] ?? [])
  const global = side === 'web' ? '__agentPanel' : '__agentPanelServer'
  return {
    name: 'agent-panel-modules',
    setup(b) {
      b.onResolve({ filter: /.*/ }, (a) =>
        a.namespace === 'file' && packages.has(a.path) ? { path: a.path, namespace: `agent-panel-${side}` } : undefined,
      )
      // @panel/<面板源码路径>：一定取面板那一份（插件自己有同名文件、要在上面包一层时用，例如插件的 web/src/lib/api.ts）
      b.onResolve({ filter: /^@panel\// }, (a) => {
        const key = a.path.slice(7).replace(/\.(tsx?|m?js)$/, '')
        return allowed.has(key)
          ? { path: key, namespace: `agent-panel-${side}` }
          : { errors: [{ text: `面板没有开放 ${key}（sdk/host-modules.json 的 ${side}）` }] }
      })
      b.onResolve({ filter: /^(@\/|@shared\/|\.)/ }, (a) => {
        if (a.namespace !== 'file') return undefined
        const abs = a.path.startsWith('@/')
          ? path.join(dir, 'web', 'src', a.path.slice(2))
          : a.path.startsWith('@shared/')
            ? path.join(dir, 'shared', a.path.slice(8))
            : path.resolve(a.resolveDir, a.path)
        // 插件里有这个文件：别名指到这个文件；相对路径（含 TS 惯用的 ./x.js 指 x.ts）交回 esbuild 照常解析
        const local = findLocal(abs) ?? (/\.m?js$/.test(abs) ? findLocal(abs.replace(/\.m?js$/, '')) : undefined)
        if (local) return a.path.startsWith('.') ? undefined : { path: local }
        const rel = path.relative(dir, abs)
        // 插件目录外、或者连目录都不像面板布局的相对路径：交回 esbuild，按它自己的报错来
        if (rel.startsWith('..') || path.isAbsolute(rel)) return undefined
        const key = rel
          .split(path.sep)
          .join('/')
          .replace(/\.(tsx?|m?js)$/, '')
        if (!allowed.has(key))
          return {
            errors: [{ text: `插件里没有 ${a.path}，面板也没有开放 ${key}（sdk/host-modules.json 的 ${side}）` }],
          }
        return { path: key, namespace: `agent-panel-${side}` }
      })
      b.onLoad({ filter: /.*/, namespace: `agent-panel-${side}` }, (a) => ({
        // 用取值器转发：面板模块里后来才赋值的导出（let）也能取到最新的
        contents: `const m = globalThis.${global}?.modules?.[${JSON.stringify(a.path)}]
if (!m) throw new Error('面板没有开放模块 ${a.path}：要插件接口 4 及以上的面板')
const o = { __esModule: true }
for (const k of Object.keys(m)) Object.defineProperty(o, k, { enumerable: true, get: () => m[k] })
module.exports = o`,
        loader: 'js',
      }))
    },
  }
}

/**
 * 插件样式的类名必须带插件自己的前缀（面板 ADR 0059 风险一节）：插件样式表在面板之后加载，不带前缀的 .flex-col
 * 会盖掉面板的 md:flex-row，打开插件后面板整页布局乱掉（试装时出过）。以前只靠约定，这里在构建时拦：
 * index.css 要用 prefix(<前缀>)，产物里的类选择器只能是 <前缀>:…（Tailwind 工具类）或 <前缀>-…（插件自己写的类）；
 * dark 是面板主题的类（sdk/theme.css 用它判断深色），放行
 */
const UNPREFIXED_OK = new Set(['dark'])
function checkCssPrefix(id, src, built) {
  const m = /prefix\(([a-z][a-z0-9]*)\)/.exec(readFileSync(src, 'utf8'))
  if (!m)
    throw new Error(`${id}：web/index.css 的 tailwindcss/theme.css 要写 prefix(<前缀>)，不然插件的类会盖掉面板的同名类`)
  const pre = m[1]
  // 去掉注释、字符串和 url()：里面的「github.com」这类不是选择器
  const css = readFileSync(built, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/url\([^)]*\)/g, '')
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '')
  const bad = new Set()
  // 只看选择器（{ 前面的部分），属性值里的小数（.5rem）不算
  for (const sel of css.match(/[^{}]+(?=\{)/g) ?? [])
    for (const [, cls] of sel.matchAll(/\.((?:\\.|[\w-])+)/g)) {
      const name = cls.replace(/\\(.)/g, '$1')
      if (/^\d/.test(name) || UNPREFIXED_OK.has(name)) continue
      if (!name.startsWith(`${pre}:`) && !name.startsWith(`${pre}-`)) bad.add(name)
    }
  if (bad.size)
    throw new Error(
      `${id}：样式里有不带前缀 ${pre} 的类（${[...bad].slice(0, 10).join('、')}）。Tailwind 类写成 ${pre}:flex，自己写的类以 ${pre}- 开头`,
    )
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
      plugins: [panelModules(dir, 'server')],
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
      // 从面板搬过来的代码里有 import.meta.env（面板是 Vite 构建的）：插件只跑在正式版面板里，按正式版的值定死
      define: { 'import.meta.env': JSON.stringify({ MODE: 'production', DEV: false, PROD: true, VITE_DEMO: '' }) },
      plugins: [panelReact, panelModules(dir, 'web')],
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
  if (manifest.css) checkCssPrefix(manifest.id, path.join(dir, 'web', 'index.css'), path.join(out, manifest.css))
  const hook = path.join(dir, 'build.mjs')
  if (existsSync(hook)) await (await import(pathToFileURL(hook).href)).extra(out)

  for (const k of ['server', 'web', 'css'])
    if (manifest[k] && !existsSync(path.join(out, manifest[k])))
      throw new Error(`${manifest.id}：构建后缺少 ${manifest[k]}`)

  const zip = path.join(DIST, `${manifest.id}-${manifest.version}.zip`)
  const data = zipDir(out)
  writeFileSync(zip, data)
  // 校验文件和包一起发到 Release：面板下载后核对（面板 server/plugins/github.ts 的 verifySha），格式同 sha256sum
  writeFileSync(`${zip}.sha256`, `${createHash('sha256').update(data).digest('hex')}  ${path.basename(zip)}\n`)
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
