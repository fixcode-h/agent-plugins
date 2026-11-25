import type { LayerProp } from '../../../shared/uasset/inherit.ts'
import { rowsOf } from '../../../shared/uasset/snap.ts'
import { learnColumns, normRow } from '../../../shared/uasset/table-defaults.ts'
import { cardReady, rpc, type Card } from '../../instances.ts'
import type { UeProject } from '../../types.ts'
import { loadAsset } from '../read.ts'
import { nativeToFetch, putNative } from './native-cache.ts'

/**
 * 编辑器开着时在后台补 C++ 默认值（native-cache.ts）：离线读时缺的、记下超过一天的，一个一个问编辑器。
 * 每个项目同时只跑一轮、两轮之间至少隔一分钟，一轮最多问 PER_RUN 个，不和用户自己的操作抢编辑器。
 * 网页、Agent 每次发给编辑器的操作都会顺手调一次（ops.ts），不另起定时器。
 */

const PER_RUN = 40
const GAP_MS = 60_000
const lastRun = new Map<string, number>() // 模块状态：只是限流，重启后重来
const running = new Set<string>()

/** 编辑器 props 给的一条属性里只留离线要用的：可不可改、为什么不能改是编辑器当时的情况，离线一律只读 */
function keep(p: Record<string, unknown>): LayerProp {
  const { readOnly: _r, readOnlyWhy: _w, ...rest } = p
  return rest as LayerProp
}

/** 一条待补的：对象路径用 props 读；「行结构@表」把这张表在编辑器里读一遍，和文件里的行对出各列默认值 */
async function fetchOne(project: UeProject, card: Card, want: string) {
  const [key, table] = want.split('@')
  if (!table) {
    const res = (await rpc(card, 'props', { path: key, maxChars: 0, load: false }, 15000)) as {
      props?: Record<string, unknown>[]
    }
    await putNative(project.id, key, { at: Date.now(), props: (res.props ?? []).map(keep) })
    return
  }
  const online = (await rpc(card, 'datatable', { path: table, limit: 1000 }, 30000)) as Parameters<
    typeof learnColumns
  >[0] & { dirty?: boolean }
  // 编辑器里这张表有没保存的改动：和文件对不上，推出来的「默认值」不可信，等保存后下轮再补
  if (online.dirty) return
  const a = (await loadAsset(project, table)).asset
  const file = new Map((rowsOf(a.main) ?? []).map((r) => [String(r.Name), normRow(r)]))
  const cols = learnColumns(online, file)
  // 格子太长被编辑器截成摘要的列：挑一行文件里没写这一列的，用 datatable.row 取全
  for (const c of cols.filter((x) => !x.has).slice(0, 10)) {
    const row = [...file].find(([, r]) => !(c.name in r))?.[0]
    if (!row) continue
    const res = (await rpc(card, 'datatable.row', { path: table, row, filter: c.name }, 15000)) as {
      props?: { name: string; value: unknown }[]
    }
    const p = res.props?.find((x) => x.name === c.name)
    if (p) Object.assign(c, { value: p.value, has: true })
  }
  await putNative(project.id, key, { at: Date.now(), columns: cols })
}

/** 返回这一轮（单测等它跑完）；调用方不用等 */
export function primeNativeDefaults(project: UeProject, card: Card, now = Date.now()): Promise<void> {
  if (card.kind !== 'editor' || !cardReady(card) || running.has(project.id)) return Promise.resolve()
  if (now - (lastRun.get(project.id) ?? 0) < GAP_MS) return Promise.resolve()
  lastRun.set(project.id, now)
  running.add(project.id)
  return (async () => {
    try {
      for (const want of await nativeToFetch(project.id, PER_RUN)) {
        try {
          await fetchOne(project, card, want)
        } catch (e) {
          // 编辑器说找不到：这个路径本来就没有（父类默认对象下面没这个子对象），记下别再问；别的错（编辑器忙、断了）下轮再试
          if (/找不到对象|not found/i.test((e as Error).message))
            await putNative(project.id, want.split('@')[0], { at: Date.now(), missing: true })
          else break
        }
      }
    } catch {
      // 读缓存文件失败之类：下轮再试，不影响用户的操作
    } finally {
      running.delete(project.id)
    }
  })()
}
