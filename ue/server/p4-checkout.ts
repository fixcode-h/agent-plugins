import path from 'node:path'

/**
 * 保存 UE 资源前后的 P4 签出：规则在面板（开放模块 server/vcs/p4-plan，Agent 改文件的钩子、表格保存用同一份，面板 ADR 0073）。
 * 在库里、还没打开的保存前 edit 进 default（不论只不只读）；库里没有的、库里已删除的保存后 add；已在某个 pending 里的留在原处；
 * 没法合并的资源本地落后时列进 stale，由调用方先问用户。面板模块用到时才加载：gameFileOf 的单测不用拉起面板
 */
export async function p4SavePlan(root: string, files: string[]) {
  const [{ p4WritePlan }, { p4Runner }] = await Promise.all([
    import('@panel/server/vcs/p4-plan'),
    import('@panel/server/p4-split'),
  ])
  return p4WritePlan(p4Runner(root), files)
}

/** 保存前签出：返回出错原因（没有就是成功） */
export async function p4EditFiles(root: string, files: string[]) {
  const [{ p4Open }, { p4Runner }] = await Promise.all([
    import('@panel/server/vcs/p4-plan'),
    import('@panel/server/p4-split'),
  ])
  return p4Open(p4Runner(root), 'edit', files)
}

/** 本地版本落后于 P4 最新版的资源 */
export interface P4Stale {
  file: string
  have: number
  head: number
}

/** /Game/UI/WBP_Bag → <项目>/Content/UI/WBP_Bag.uasset（关卡是 .umap）；插件、引擎里的包不管 */
export function gameFileOf(root: string, pkg: string, exists: (f: string) => boolean) {
  if (!pkg.startsWith('/Game/')) return undefined
  const base = path.join(root, 'Content', ...pkg.slice('/Game/'.length).split('.')[0].split('/'))
  return ['.uasset', '.umap'].map((x) => base + x).find(exists)
}
