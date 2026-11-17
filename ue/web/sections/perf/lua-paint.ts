import { luaColor } from './lua-trace.ts'

/**
 * 时间轴上 Lua 块的填充（Lua 性能 Insights 化设计 5.2）：Lua 函数是 luaColor 的蓝紫色；
 * C 函数在更浅的底色上叠一层斜纹，和 Lua 函数一眼分开（只靠深浅在小块上不好认）。
 * 斜纹做成 canvas 图案，按颜色缓存：一屏几千个块不用每块重建。
 */
const cache = new Map<string, CanvasPattern | string>()

export function luaFill(g: CanvasRenderingContext2D, name: string, dark: boolean, c?: boolean) {
  const base = luaColor(name, dark, c)
  if (!c) return base
  const key = `${base}|${dark}`
  const hit = cache.get(key)
  if (hit) return hit
  const tile = document.createElement('canvas')
  tile.width = 6
  tile.height = 6
  const t = tile.getContext('2d')
  if (!t) return base
  t.fillStyle = base
  t.fillRect(0, 0, 6, 6)
  t.strokeStyle = dark ? 'rgba(255,255,255,.16)' : 'rgba(40,40,120,.16)'
  t.lineWidth = 1.5
  t.beginPath()
  // 两段斜线拼成连续的 45° 斜纹
  t.moveTo(-1, 7)
  t.lineTo(7, -1)
  t.moveTo(-1, 1)
  t.lineTo(1, -1)
  t.moveTo(5, 7)
  t.lineTo(7, 5)
  t.stroke()
  const p = g.createPattern(tile, 'repeat') ?? base
  if (cache.size > 200) cache.clear()
  cache.set(key, p)
  return p
}
