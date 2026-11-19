/**
 * 写后编译钩子（hook.ts）要的两样记录，都是插件进程里的运行时状态，面板重启后丢了无妨（最多多编一次）：
 * - 这个对话里哪些蓝图编译过、结果是什么：ue_compile、带编译的 ue_blueprint edit 之后记下，没带编译的 edit 清掉，
 *   保存后已经编译通过、之后没再改过的不再编一遍；
 * - 这个对话刚用 ue_save 写到磁盘的包：钩子在 ue_save 之后取走，编译其中的蓝图。
 * 只认包名（/Game/X/BP_Hero），资源路径带的 .BP_Hero 去掉
 */

const MAX_TASKS = 200

/** 对话 id → 包名 → 最近一次编译通过没有 */
const compiled = new Map<string, Map<string, boolean>>() // 运行时：钩子跳过重复编译用，丢了最多多编一次
/** 对话 id → 刚保存的包（项目 id 一起记，钩子按它找项目） */
const saved = new Map<string, { projectId: string; packages: string[] }>() // 运行时：ue_save 到钩子之间的交接

export const packageName = (p: unknown) => String(p ?? '').split('.')[0]

/** Map 只留最近的 MAX_TASKS 个对话：对话结束不会通知插件，按插入顺序丢最老的 */
function trim<V>(m: Map<string, V>) {
  while (m.size > MAX_TASKS) m.delete(m.keys().next().value as string)
}

/** 编译过一次：ok 是 ok / warnings；没带编译的修改传 undefined，表示改过、还没编 */
export function noteCompile(taskId: string, pkg: string, ok: boolean | undefined) {
  if (!taskId || !pkg.startsWith('/')) return
  let m = compiled.get(taskId)
  if (!m) {
    m = new Map()
    compiled.set(taskId, m)
    trim(compiled)
  }
  if (ok === undefined) m.delete(pkg)
  else m.set(pkg, ok)
}

/** 这个对话里编译通过、之后没再改过 */
export const compiledOk = (taskId: string, pkg: string) => compiled.get(taskId)?.get(pkg) === true

export function noteSaved(taskId: string, projectId: string, packages: string[]) {
  if (!taskId || !packages.length) return
  const prev = saved.get(taskId)
  const all = prev?.projectId === projectId ? [...prev.packages, ...packages] : packages
  saved.set(taskId, { projectId, packages: [...new Set(all)] })
  trim(saved)
}

/** 钩子取走刚保存的包（取一次就清掉，同一次保存不会编两遍） */
export function takeSaved(taskId: string) {
  const v = saved.get(taskId)
  saved.delete(taskId)
  return v
}
