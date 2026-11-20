/**
 * 带了批量写法（paths / items / select）但这个动作批量不了时的报错：纯函数，单测直接跑（no-batch.test.ts）。
 * 按 ADR 0067 第 5 节写清下一步怎么调：哪些 action 能批量、只想按条件列出资源时改用 ue_find kind=asset select。
 * Agent 常把 select 当成一个「查找」动作（ue_asset action=select），以前一律回「不支持批量，逐个调」，
 * 它不知道该换哪个工具，所以没有这个 action 时单独说清楚
 */

/** 只想按条件找资源时的调法：和批量的 select 同一套写法 */
const FIND_HINT =
  '只想按条件列出资源路径用 ue_find kind=asset select={...}（写法和这里的 select 一样：path、class、parent、name / exclude 通配符），结果分页返回'

/**
 * @param batchable 这个工具能批量的 action（registry 里登记的）；空数组表示整个工具能批量、不分 action
 * @param actions 这个工具所有的 action（工具定义里的 enum）；不给就不判断「没有这个 action」
 */
export function noBatchMessage(tool: string, action: unknown, batchable: string[], actions?: string[]) {
  const act = typeof action === 'string' ? action : ''
  const can = batchable.length ? `能批量的 action：${batchable.join(' / ')}` : ''
  if (actions && !actions.includes(act)) {
    const head = act ? `${tool} 没有 action=${act}` : `${tool} 要给 action`
    const sel = act === 'select' ? '：select 不是动作，是批量时按条件选资源的参数，要和能批量的 action 一起用' : ''
    return `${head}${sel}（${can || `可选：${actions.join(' / ')}`}）。${FIND_HINT}。`
  }
  const one = `${tool}${act ? ` action=${act}` : ''} 批量不了（paths / items / select）：逐个调，每次给 path`
  return `${one}${can ? `；${can}` : ''}。要先找出有哪些资源：${FIND_HINT}。`
}
