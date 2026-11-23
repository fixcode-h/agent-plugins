import path from 'node:path'

/** 跑一次 p4（util.ts 的 run 的形状），单测换成假的 */
export type P4Exec = (args: string[]) => Promise<{ code: number; out: string; err: string }>

/** 不归这个 client 管的文件（不在视图里、不在工作区根下）：跳过，不算出错 */
const NOT_OURS = /not in client view|not under client's root|is not under client/i
/** fstat 对还没进库的文件报的：保存后 add */
const NOT_IN_DEPOT = /no such file|not on client/i
/** 没法合并的文件类型（p4 的 headType：binary、binary+l、ubinary、apple、resource） */
const UNMERGEABLE = /binary|apple|resource/i

const norm = (p: string) => {
  const s = path.resolve(p).replace(/\\/g, '/')
  return process.platform === 'win32' ? s.toLowerCase() : s
}

/**
 * 保存前要签出哪些、保存后要 add 哪些（P4 项目）。
 * 以前只签出只读的文件：client 设了 allwrite、或文件被手动去掉过只读时，保存照样成功，改动却不在任何 changelist 里，
 * 提交时漏掉（用户 2026-11-23 报「改了资源不进默认 Changelist」）。现在先问 P4：在库里、还没打开的 edit 进 default；
 * 库里没有的（或库里已删除的）保存后 add；已经在当前 client 某个 pending 里的留在原处
 */
export async function p4SavePlan(
  exec: P4Exec,
  files: string[],
): Promise<{ edit: string[]; add: string[]; stale: P4Stale[]; error?: string }> {
  if (!files.length) return { edit: [], add: [], stale: [] }
  const st = await exec(['-ztag', 'fstat', '-T', 'clientFile,headAction,headType,headRev,haveRev,action', ...files])
  // -ztag 的记录：同一个 key 再出现时开始下一条（描述里可能有空行，不按空行分）
  const list: Record<string, string>[] = []
  let cur: Record<string, string> | null = null
  for (const line of st.out.split(/\r?\n/)) {
    const m = /^\.\.\. (\S+)(?: (.*))?$/.exec(line)
    if (!m) continue
    if (!cur || m[1] in cur) list.push((cur = {}))
    cur[m[1]] = m[2] ?? ''
  }
  const recs = new Map(list.filter((r) => r.clientFile).map((r) => [norm(r.clientFile), r]))
  const errLines = st.err.split(/\r?\n/).filter((l) => l.trim())
  const real = errLines.filter((l) => !NOT_OURS.test(l) && !NOT_IN_DEPOT.test(l))
  if (!recs.size && real.length) return { edit: [], add: [], stale: [], error: real.join('；') }
  const edit: string[] = []
  const add: string[] = []
  const stale: P4Stale[] = []
  for (const f of files) {
    const r = recs.get(norm(f))
    if (r) {
      if (r.action) continue
      if (/delete/.test(r.headAction ?? '')) add.push(f)
      else {
        edit.push(f)
        // 没法合并的资源本地版本落后：改完再更新只能丢掉一边，先问用户（用户 2026-11-23 定；代码文件不看远端）
        const have = Number(r.haveRev || 0)
        const head = Number(r.headRev || 0)
        if (UNMERGEABLE.test(r.headType ?? '') && have < head) stale.push({ file: f, have, head })
      }
      continue
    }
    const line = errLines.find((l) => norm(l.split(' - ')[0] ?? '') === norm(f))
    if (!line || !NOT_OURS.test(line)) add.push(f)
  }
  return { edit, add, stale }
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
