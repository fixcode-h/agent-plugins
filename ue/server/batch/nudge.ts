import type { McpResult } from '../../../sdk/server.ts'
import { batchEntry } from './registry.ts'
import { isBatch } from './targets.ts'

/**
 * 逐个调的提醒：Agent 对多个资源做同一件事时常常一个资源调一次（甚至并行发十几次），对话里刷出一串一样的行。
 * 同一个对话里两分钟内第 3 次对不同资源单独调同一个能批量的工具动作时，在结果末尾提醒一次改用 paths / select
 * （同一个键十分钟内只提醒一次，不刷屏）。只看工具调用的参数，不看回复文字
 */

const WINDOW_MS = 120000
const QUIET_MS = 600000
const recent = new Map<string, { at: number; paths: Set<string> }>()
const warned = new Map<string, number>()

/** 动作和属性一样才算「同一件事」：ue_set 改同一个 prop、ue_blueprint 同一个 action */
function sameKey(task: string, tool: string, a: Record<string, unknown>) {
  return [task, tool, a.action ?? '', a.prop ?? '', a.lua ?? ''].join('|')
}

export function batchNudge(task: string | undefined, tool: string, a: Record<string, unknown>, r: McpResult) {
  if (!task || r.isError || isBatch(a) || typeof a.path !== 'string' || !batchEntry(tool, a.action)) return r
  const key = sameKey(task, tool, a)
  const now = Date.now()
  let rec = recent.get(key)
  if (!rec || now - rec.at > WINDOW_MS) rec = { at: now, paths: new Set() }
  rec.at = now
  rec.paths.add(a.path)
  recent.set(key, rec)
  if (recent.size > 200) recent.delete(recent.keys().next().value as string)
  if (rec.paths.size < 3 || now - (warned.get(key) ?? 0) < QUIET_MS) return r
  warned.set(key, now)
  const what = a.action ? `${tool} action=${a.action}` : tool
  const hint =
    `\n\n提示：你已经对 ${rec.paths.size} 个资源逐个调 ${what} 做同一件事。剩下的请合成一次调用：` +
    `select 按目录 / 类 / 父类 / 名字通配符选（关卡 Actor 用 select.kind=actor），不超过 20 个时也可以 paths=[所有路径]，其余参数照旧。` +
    `一次调用在 UE 里是一个作业：先整批演练、失败可整批撤回，对话里也只显示一条。不要再逐个调或并行发多次。`
  return { ...r, content: [...r.content, { type: 'text' as const, text: hint }] }
}
