import type { McpResult } from '../../sdk/server.ts'
import { clip } from './util.ts'

/**
 * 给 Agent 的数据结果统一走这里：紧凑 JSON（不缩进，一个 text 块）+ MCP 的 structuredContent（同一个对象）。
 * 为什么：脚本式调用（Pi 的 codemode、Claude Code 的代码模式）要直接取字段，缩进只是给人看的、白占 token
 * （对话里面板会再展开成缩进的显示）；超长时按列表截短并写进 clipped，不能把 JSON 从中间切断——切断的 JSON 脚本解析不了。
 * Claude Code 有 structuredContent 时只把它交给模型、不看 content（2.1.329 实测），所以追加的提示也要写进对象（withTip）。
 */

/** 默认上限和原来的 clip 一样（读结构的工具最多 12000 字，面板插件结果上限也是 12000） */
export const JSON_MAX = 12000

const CLIP_HINT =
  '列表太长只列了前面一部分（clipped 里写了哪些列表、列了几个、一共几个）：缩小范围（filter、query、limit / offset、按属性路径单独取），或用 file=true 写成文件只回路径（ue_get、ue_asset export 支持）'

type Holder = Record<string, unknown> | unknown[]
interface Found {
  holder: Holder
  key: string | number
  arr: unknown[]
  path: string
  size: number
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** 找出序列化后最大的、还能再截的列表（只看两项以上的） */
function largestList(root: unknown): Found | undefined {
  let best: Found | undefined
  const walk = (v: unknown, holder: Holder | undefined, key: string | number, path: string) => {
    if (Array.isArray(v)) {
      if (holder && v.length > 1) {
        const size = JSON.stringify(v).length
        if (!best || size > best.size) best = { holder, key, arr: v, path, size }
      }
      v.forEach((x, i) => walk(x, v, i, `${path}[${i}]`))
    } else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) walk(x, v, k, path ? `${path}.${k}` : k)
    }
  }
  // 顶层就是数组时也能截：先包一层，截完再拆
  walk(root, undefined, '', '')
  return best
}

/**
 * 把数据截到 max 字以内：一次次挑最大的列表按比例截短，记下原来多少个。截不动（单个超长字符串）返回 undefined，
 * 调用方退回按文字截断
 */
export function fitJson(data: unknown, max = JSON_MAX, hint = CLIP_HINT): unknown {
  if (JSON.stringify(data).length <= max) return data
  // 顶层是数组：包成 { items }，截短的信息才有地方写
  const root: Record<string, unknown> = isObj(data) ? structuredClone(data) : { items: structuredClone(data) }
  const totals = new Map<string, { shown: number; total: number }>()
  // 留出 clipped 说明本身的位置
  const budget = max - hint.length - 400
  for (let i = 0; i < 60; i++) {
    const len = JSON.stringify(root).length
    if (len <= budget) break
    const f = largestList(root)
    if (!f) break
    const keep = Math.max(1, Math.min(f.arr.length - 1, Math.floor(f.arr.length * (1 - (len - budget) / f.size))))
    const was = totals.get(f.path)
    totals.set(f.path, { shown: keep, total: was?.total ?? f.arr.length })
    ;(f.holder as Record<string | number, unknown>)[f.key] = f.arr.slice(0, keep)
  }
  // 截短后有的列表又被外层列表截掉了：只报还在的
  const lists = [...totals].map(([path, n]) => ({ path, ...n }))
  const out = { ...root, clipped: { lists, hint } }
  return JSON.stringify(out).length <= max ? out : undefined
}

/** 数据结果：对象带 structuredContent；字符串照旧是文字（超长按文字截断）。hint 是截短时告诉 Agent 怎么缩小范围的话 */
export function jsonResult(data: unknown, max = JSON_MAX, hint?: string): McpResult {
  if (typeof data === 'string') return { content: [{ type: 'text', text: clip(data, max) }] }
  const fitted = fitJson(data, max, hint || undefined)
  if (fitted === undefined) return { content: [{ type: 'text', text: clip(JSON.stringify(data), max) }] }
  const text = JSON.stringify(fitted)
  return { content: [{ type: 'text', text }], ...(isObj(fitted) && { structuredContent: fitted }) }
}

/**
 * 给结果追加一句提示（批量提醒、AssetForge 提醒）：有结构化结果时写进它的 tips 并重写文字，
 * 否则照旧追加一个 text 块。只追加文字块的话 Claude Code 看不到（它只看 structuredContent）
 */
export function withTip(r: McpResult, tip: string): McpResult {
  const sc = r.structuredContent
  if (!sc) return { ...r, content: [...r.content, { type: 'text', text: tip.trim() }] }
  const tips = Array.isArray(sc.tips) ? [...(sc.tips as unknown[]), tip.trim()] : [tip.trim()]
  const next = { ...sc, tips }
  return { ...r, content: [{ type: 'text', text: JSON.stringify(next) }], structuredContent: next }
}
