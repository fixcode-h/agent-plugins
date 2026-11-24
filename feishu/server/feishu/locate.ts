import { findCommand, type CommandFrom } from '../exec/find-command.ts'

/**
 * 找本机的 lark-cli（用户 2026-11-24：Windows 上面板报「找不到命令 lark-cli」，终端里却能跑）。
 * 设置里填了就用填的（命令名或完整路径）；留空自动找：面板的 findCommand 依次看 PATH、Windows 注册表里新加的 PATH、
 * npm 全局目录（官方文档的安装方式 npm install -g @larksuite/cli / npx @larksuite/cli install 装在这里）、常见安装目录。
 * 插件自己的拦截垫片（bin/lark-cli）和真命令同名，找的时候跳过那个目录
 */

export interface LarkBin {
  path: string
  /** config：设置里填的；其余是自动找到的位置 */
  from: 'config' | CommandFrom
}

/** 找到的缓存一分钟，没找到的十秒（用户刚装上就能用，不用重启面板） */
const HIT_MS = 60_000
const MISS_MS = 10_000
// 模块状态：缓存，设置变了或过期就重找
let cache: { key: string; at: number; v: LarkBin | undefined } | undefined

export async function locateLark(configured: string, shimDir: string, force = false): Promise<LarkBin | undefined> {
  const key = `${configured}\n${shimDir}`
  if (!force && cache && cache.key === key && Date.now() - cache.at < (cache.v ? HIT_MS : MISS_MS)) return cache.v
  const hit = configured
    ? await findCommand(configured, { exclude: [shimDir] })
    : await findCommand('lark-cli', { exclude: [shimDir] })
  const v = hit ? { path: hit.path, from: configured ? ('config' as const) : hit.from } : undefined
  cache = { key, at: Date.now(), v }
  return v
}
