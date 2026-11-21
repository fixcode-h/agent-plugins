import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { UeProject } from '../../types.ts'

/**
 * Lua 脚本根和 require 路径 ⇄ 文件：和 Lua 编译设置、跳转索引同一个脚本目录（默认 Content/Script）。
 * 不按某种 UnLua 的约定猜搜索路径（二次开发版可能改过），require 路径就是相对脚本根、点分隔、去掉 .lua。
 */
export const luaRoot = (p: Pick<UeProject, 'root' | 'luaBuild'>) =>
  path.resolve(p.root, p.luaBuild?.scriptDir || 'Content/Script')

const slash = (s: string) => s.replace(/\\/g, '/')

/**
 * Game.UI.GuidePanel → <脚本根>/Game/UI/GuidePanel.lua；也认直接给的相对路径（UI/Guide/GuidePanel.lua）
 * 和斜杠开头的 require 路径（`/Module/A/B`，有的框架这样 require，用户 2026-11-21）：开头的 / 是相对脚本根，不是盘符根
 */
export function moduleFile(root: string, mod: string) {
  const m = mod.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  const rel = /\.lua$/i.test(m) ? m : `${m.replace(/\./g, '/')}.lua`
  const abs = path.resolve(root, rel)
  const r = path.relative(root, abs)
  if (!r || r.startsWith('..') || path.isAbsolute(r)) throw new Error(`Lua 模块不在脚本根里：${mod}`)
  return abs
}

/** 文件 → require 路径 */
export const moduleName = (root: string, abs: string) =>
  slash(path.relative(root, abs))
    .replace(/\.lua$/i, '')
    .replace(/\//g, '.')

export const relToRoot = (root: string, abs: string) => slash(path.relative(root, abs))

export async function readLua(abs: string) {
  return (await readFile(abs, 'utf8')).replace(/^﻿/, '')
}

/** 一个文件夹（及子文件夹）下的 .lua，最多 limit 个（接口库文件夹不会更大；防止配成整个脚本根卡住） */
export async function listLua(dir: string, limit = 2000): Promise<string[]> {
  const out: string[] = []
  const walk = async (d: string) => {
    if (out.length >= limit) return
    const entries = await readdir(d, { withFileTypes: true }).catch(() => [])
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const f = path.join(d, e.name)
      if (e.isDirectory()) await walk(f)
      else if (/\.lua$/i.test(e.name) && out.length < limit) out.push(f)
    }
  }
  if ((await stat(dir).catch(() => undefined))?.isDirectory()) await walk(dir)
  return out
}
