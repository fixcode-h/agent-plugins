/**
 * Lua 字段路径（网页和 Agent 工具共用，不依赖 node）：Inventory.Items[3]、package.loaded["Game.Core"]、_G.GameSystemManager。
 * 桥接收的是拆好的键数组（字符串 / 数字），这里负责字符串 ⇄ 键数组；开头的 _G 是全局表本身，去掉
 */
export type LuaKey = string | number

export function parseLuaPath(s: string): LuaKey[] {
  const src = s.trim()
  const keys: LuaKey[] = []
  let i = 0
  const err = (msg: string) => new Error(`Lua 路径「${src}」第 ${i + 1} 个字符：${msg}`)
  while (i < src.length) {
    const ch = src[i]
    if (ch === '.') {
      i++
      continue
    }
    if (ch === '[') {
      const rest = src.slice(i + 1)
      const q = rest.match(/^\s*(["'])((?:\\.|(?!\1).)*)\1\s*\]/)
      if (q) {
        keys.push(q[2].replace(/\\(.)/g, '$1'))
        i += 1 + q[0].length
        continue
      }
      const n = rest.match(/^\s*(-?\d+(?:\.\d+)?)\s*\]/)
      if (n) {
        keys.push(Number(n[1]))
        i += 1 + n[0].length
        continue
      }
      throw err('[ ] 里只能写数字或带引号的字符串')
    }
    const m = src.slice(i).match(/^[A-Za-z_][\w]*/)
    if (!m) throw err('这里应该是名字、. 或 [')
    keys.push(m[0])
    i += m[0].length
  }
  if (keys[0] === '_G') keys.shift()
  return keys
}

export function formatLuaPath(keys: LuaKey[]): string {
  let out = ''
  for (const k of keys) {
    if (typeof k === 'number') out += `[${k}]`
    else if (/^[A-Za-z_]\w*$/.test(k)) out += out ? `.${k}` : k
    else out += `[${JSON.stringify(k)}]`
  }
  return out
}
