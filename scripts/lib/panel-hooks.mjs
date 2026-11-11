// 单测用的模块解析钩子（scripts/test.mjs 注册）：照面板源码布局放文件的插件（插件接口 4），
// 插件目录里没有的文件去 .panel（面板源码）的同一位置找，和构建时 scripts/build.mjs 的 panelModules 一个规则；
// 第三方包插件没装的也从 .panel/node_modules 取。TypeScript 本身交给面板装的 tsx 处理。
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

let plugin = ''
let panel = ''
export function initialize(data) {
  plugin = path.resolve(data.plugin)
  panel = path.resolve(data.panel)
}

const EXTS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
const firstFile = (base) => EXTS.map((e) => base + e).find((f) => existsSync(f) && !f.endsWith('/'))

/** 插件里的 @/、@shared/ 别名和相对路径算成插件内的相对位置，插件里没有就换到 .panel 的同一位置 */
function fallback(spec, parentURL) {
  if (!parentURL?.startsWith('file:')) return
  const parent = fileURLToPath(parentURL)
  const inPlugin = parent.startsWith(plugin + path.sep)
  let rel
  if (spec.startsWith('@/')) rel = path.join('web/src', spec.slice(2))
  else if (spec.startsWith('@shared/')) rel = path.join('shared', spec.slice(8))
  else if (spec.startsWith('@panel/')) return firstFile(path.join(panel, spec.slice(7)))
  else if (spec.startsWith('.') && inPlugin) rel = path.relative(plugin, path.resolve(path.dirname(parent), spec))
  if (rel === undefined) return
  // 面板模块里的别名也一样：插件有同名文件用插件的（和构建一致），没有用面板的
  return firstFile(path.join(plugin, rel)) ?? firstFile(path.join(panel, rel))
}

export async function resolve(spec, context, next) {
  const hit = fallback(spec, context.parentURL)
  if (hit) return next(pathToFileURL(hit).href, context)
  try {
    return await next(spec, context)
  } catch (e) {
    if (e?.code !== 'ERR_MODULE_NOT_FOUND' || spec.startsWith('.') || spec.startsWith('/')) throw e
    // 插件没装的第三方包用面板装的
    return next(spec, { ...context, parentURL: pathToFileURL(path.join(panel, 'package.json')).href })
  }
}
