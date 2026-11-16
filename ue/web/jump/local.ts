import { SquareTerminal, Wand2, type LucideIcon } from 'lucide-react'
import type { GmStore } from '../../server/types.ts'
import type { GmItem } from '../sections/Gm.tsx'
import { t } from '../host.ts'
import { setPending } from '../pending.ts'

/**
 * 跳转弹窗里「本页已有的列表里匹配」（设计稿 designs/UE插件优化与扩展-设计稿.md 三.2）：只在网页里已经有的列表里筛，
 * 打字不发请求（用户 2026-11-10 定的「搜索点按钮才搜」，怕拖慢 UE）。GM 页取过的 gm.list、控制台收藏都在这里；
 * Lua GM、Lua 模块这类列表由各自的页面用 registerJumpSource 挂进来
 */

/** UE GM 列表，按进程号缓存（GM 页取一次，这里直接用） */
export const gmCache = new Map<number, GmItem[]>()

export interface JumpEnv {
  pid?: number
  /** 打开弹窗时读的 GM 收藏（本机文件，不经过 UE） */
  store?: GmStore
  go: (section: string, sub?: string) => void
}

export interface LocalHit {
  key: string
  icon: LucideIcon
  label: string
  /** 名字后面的灰字：参数、文件路径 */
  detail?: string
  /** 行尾的来源：「GM · 背包」「控制台收藏」 */
  hint?: string
  /** Ctrl+回车 发给对话时的文字 */
  chat: string
  run: () => void
}

export interface JumpSource {
  id: string
  match: (q: string, env: JumpEnv) => LocalHit[]
}

const sources: JumpSource[] = []

/** 别的页面（Lua GM、Lua 模块）把自己已经取到的列表挂进跳转；同一个 id 再挂一次就替换 */
export function registerJumpSource(s: JumpSource) {
  const i = sources.findIndex((x) => x.id === s.id)
  if (i >= 0) sources[i] = s
  else sources.push(s)
}

const PER_SOURCE = 5
const has = (s: string, q: string) => s.toLowerCase().includes(q)

const go = (env: JumpEnv, section: string, text: string) => () => {
  setPending(section, text)
  env.go(section)
}

registerJumpSource({
  id: 'gm',
  match: (q, env) =>
    (env.pid ? (gmCache.get(env.pid) ?? []) : [])
      .filter((g) => has(g.name, q))
      .slice(0, PER_SOURCE)
      .map((g) => ({
        key: `gm:${g.name}`,
        icon: Wand2,
        label: g.name,
        detail: g.params
          .filter((p) => !p.out)
          .map((p) => p.name)
          .join(', '),
        hint: g.category ? `GM · ${g.category}` : 'GM',
        chat: `GM ${g.name}`,
        run: go(env, 'gm', g.name),
      })),
})

registerJumpSource({
  id: 'console-fav',
  match: (q, env) =>
    (env.store?.favConsole ?? [])
      .filter((c) => has(c, q))
      .slice(0, PER_SOURCE)
      .map((c) => ({
        key: `con:${c}`,
        icon: SquareTerminal,
        label: c,
        hint: t('控制台收藏'),
        chat: c,
        run: go(env, 'console', c),
      })),
})

/** 所有来源的匹配结果，按登记顺序；空查询不列（空的时候弹窗显示用法提示） */
export function matchLocal(q: string, env: JumpEnv): LocalHit[] {
  const s = q.trim().toLowerCase()
  if (!s) return []
  return sources.flatMap((src) => {
    try {
      return src.match(s, env)
    } catch {
      // 某个页面挂进来的匹配出错不影响别的来源，也不挡住跳转
      return []
    }
  })
}
