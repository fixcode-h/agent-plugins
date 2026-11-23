import { open, stat } from 'node:fs/promises'

/**
 * Lua 类的父类，不连 UE 从源码读（用户 2026-11-21：Lua 类不用编辑器启动）。
 * 只看文件开头 16KB：继承关系都写在模块开头。认三种写法：
 * - `---@class A : B`（EmmyLua 注解，B 可能是类名也可能是模块名，由调用方对到模块）
 * - `UnLua.Class("Parent.Module")` / `Class("Parent.Module")`
 * - `Class(require("Parent.Module"))` / `Class(require "Parent.Module")`，以及先 `local Base = require "X"` 再 `Class(Base)`
 * 二次开发的 UnLua 写法可能不同（不按官方 UnLua 假设）：认不出的当没有父类，排在顶层。
 */

const HEAD = 16 * 1024

export interface LuaHead {
  /** ---@class 声明的类名（没有时空） */
  cls?: string
  /** 父类：模块名（点分隔）或注解里的类名 */
  parent?: string
}

const norm = (m: string) => m.replace(/[\\/]/g, '.').replace(/\.lua$/i, '')

/** 纯逻辑（单测用） */
export function parseLuaHead(text: string): LuaHead {
  const out: LuaHead = {}
  const ann = /---\s*@class\s+([\w.]+)\s*(?::\s*([\w.]+))?/.exec(text)
  if (ann) {
    out.cls = ann[1]
    if (ann[2]) out.parent = ann[2]
  }
  const direct = /\bClass\s*\(\s*["']([^"']+)["']/.exec(text)
  if (direct) return { ...out, parent: norm(direct[1]) }
  const req = /\bClass\s*\(\s*require\s*\(?\s*["']([^"']+)["']/.exec(text)
  if (req) return { ...out, parent: norm(req[1]) }
  const byVar = /\bClass\s*\(\s*([A-Za-z_]\w*)\s*[,)]/.exec(text)
  if (byVar) {
    const local = new RegExp(`local\\s+${byVar[1]}\\s*=\\s*require\\s*\\(?\\s*["']([^"']+)["']`).exec(text)
    if (local) return { ...out, parent: norm(local[1]) }
  }
  return out
}

const cache = new Map<string, { key: string; head: LuaHead }>()

/** 读一个 .lua 的开头（按修改时间缓存） */
export async function readLuaHead(file: string): Promise<LuaHead> {
  const st = await stat(file).catch(() => undefined)
  if (!st?.isFile()) return {}
  const key = `${st.mtimeMs}:${st.size}`
  const hit = cache.get(file)
  if (hit?.key === key) return hit.head
  let head: LuaHead = {}
  const fh = await open(file, 'r').catch(() => undefined)
  if (fh) {
    try {
      const buf = Buffer.alloc(Math.min(st.size, HEAD))
      await fh.read(buf, 0, buf.length, 0)
      head = parseLuaHead(buf.toString('utf8'))
    } finally {
      await fh.close()
    }
  }
  cache.set(file, { key, head })
  return head
}
