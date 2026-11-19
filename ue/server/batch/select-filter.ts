/** select 的面板侧筛选和逐个列出的上限：纯函数，不依赖面板模块，单测直接跑（targets.test.ts） */

/**
 * paths / items 逐个列出的默认上限（用户 2026-11-19 定 20，设置「批量时逐个列出的上限」可改）：
 * 再多就是 Agent 把一长串资源名塞进一次调用，输入又长又容易漏，超过时这次调用直接拦下，让它改用 select（select 不限个数）
 */
export const DEFAULT_LIST_MAX = 20

/** 字符串或字符串数组都认 */
export function list(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? [v] : []
  return arr.map((x) => String(x).trim()).filter(Boolean)
}

/** 和 UELink 的 FString::MatchesWildcard 一样：* 任意串、? 一个字符，不分大小写 */
export function wildcard(subject: string, pattern: string) {
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${re}$`, 'i').test(subject)
}

/** 面板这边的同一套筛选（旧 UELink 不认 paths / name / exclude）：带 / 的模式比对包路径，否则比对资源名 */
export function keep(
  x: { path?: string; name?: string; package?: string },
  dirs: string[],
  name: string[],
  exclude: string[],
) {
  const pkg = String(x.package ?? String(x.path ?? '').replace(/\.[^/]*$/, ''))
  const short = String(x.name ?? pkg.split('/').pop() ?? '')
  const hit = (p: string) => wildcard(p.includes('/') ? pkg : short, p)
  const lower = pkg.toLowerCase()
  if (dirs.length && !dirs.some((d) => lower.startsWith(d.replace(/\/+$/, '').toLowerCase() + '/'))) return false
  if (exclude.some(hit)) return false
  return !name.length || name.some(hit)
}

/** 逐个列出的超过上限时的报错（没超过回 undefined）；max 不合法时用默认值 */
export function tooMany(n: number, key: string, max: number) {
  const cap = Number.isFinite(max) && max >= 1 ? Math.floor(max) : DEFAULT_LIST_MAX
  if (n <= cap) return undefined
  return `没有执行：${key} 逐个列出最多 ${cap} 个（UE 插件设置「批量时逐个列出的上限」），给了 ${n} 个。改用 select 按条件选，不限个数：path 目录或目录数组、class 资源类型、parent 父类、name / exclude 名字通配符（如 name:"*_Boss"）、prefix、tags，例 select={path:"/Game/Enemies", class:"Blueprint", parent:"BP_EnemyBase"}；每项参数各不相同时把 items 写成 JSON 文件，用 itemsFile 传路径；拿不准选中了哪些先 dryRun=true 看清单`
}

/** 解析 itemsFile 的内容：JSON 数组、{items: [...]} 或一行一个 JSON 对象；每项要有 path。出错回原因 */
export function itemsFromJson(text: string): Record<string, unknown>[] | string {
  const src = text.replace(/^\uFEFF/, '').trim()
  if (!src) return '文件是空的'
  let data: unknown
  try {
    data = JSON.parse(src)
  } catch {
    try {
      data = src
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l))
    } catch (e) {
      return `不是 JSON（数组、{items: [...]} 或一行一个对象）：${(e as Error).message}`
    }
  }
  const arr = Array.isArray(data) ? data : (data as { items?: unknown })?.items
  if (!Array.isArray(arr) || !arr.length) return '没有找到 items 数组，或者是空的'
  const bad = arr.findIndex((x) => !x || typeof x !== 'object' || typeof (x as { path?: unknown }).path !== 'string')
  if (bad >= 0) return `第 ${bad + 1} 项没有 path（每项写成 {"path": "/Game/...", ...这一项的参数}）`
  return arr as Record<string, unknown>[]
}
