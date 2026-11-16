import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { editorBlockers } from '../procs.ts'
import type { UeProject } from '../types.ts'
import { t } from '../util.ts'
import { vsDebugState } from '../vs-debug/state.ts'
import { launchProgress } from './track.ts'
import { vsForegroundWhy } from './vs-foreground.ts'

/**
 * 起后台编辑器前的把关（用户 2026-11-15：编辑器开着却报「后台编辑器启动后退出了（退出码 1）」）：
 * 编辑器刚点了启动、还没加载到写名片（30–90 秒），这段时间里读资源会被当成「编辑器没开」去起后台编辑器，
 * 两个进程同时打开同一个项目，后台那个常常直接退出。这里先看面板自己有没有在跟一次启动、系统里有没有这个项目的编辑器进程，
 * 有就不起，告诉用户等编辑器就绪
 */
export async function editorStartingWhy(
  p: UeProject,
  opt: { procs?: boolean; bgPid?: number } = {},
): Promise<string | undefined> {
  const lp = launchProgress(p.id)
  if (lp?.status === 'running')
    return t('编辑器正在启动（PID {pid}），等它加载完再读；资源读写会走编辑器，不另起后台编辑器', { pid: lp.pid })
  // VS 里按了启动调试（经 UEToVS 或用户自己按 F5）：先编译再起 UE，这段时间面板跟不到进程，只能问 VS（用户 2026-11-16）
  const vs = vsForegroundWhy((await vsDebugState(p).catch(() => undefined))?.status, opt.bgPid)
  if (vs) return vs
  if (opt.procs === false) return undefined
  // 用户自己从 UE 或 IDE 打开的编辑器面板跟不到启动，只能看进程（只在 Windows 上查得到）
  const r = await editorBlockers(p).catch(() => undefined)
  const same = r?.list.find((x) => x.same && !x.game)
  if (same)
    return t(
      '这个项目的编辑器已经开着（PID {pid}），但还没连上 UELink：等它加载完；一直连不上就到「UE 插件」看 UELink 是否装好并编译过',
      { pid: same.pid },
    )
  return undefined
}

/**
 * 后台编辑器退出时从它的日志里找原因：取启动后改过的最新日志，挑最后几条 Error / Fatal，
 * 认得出的（模块没编译、项目被占用）换成一句该怎么办
 */
export async function backgroundExitWhy(p: UeProject, since: number): Promise<string> {
  const dir = path.join(p.root, 'Saved', 'Logs')
  let newest: { file: string; at: number } | undefined
  for (const n of await readdir(dir).catch(() => [] as string[])) {
    if (!n.endsWith('.log')) continue
    const st = await stat(path.join(dir, n)).catch(() => null)
    if (st && st.mtimeMs >= since - 2000 && (!newest || st.mtimeMs > newest.at))
      newest = { file: path.join(dir, n), at: st.mtimeMs }
  }
  if (!newest) return ''
  const text = await readFile(newest.file, 'utf8').catch(() => '')
  if (
    /modules are missing or built with a different engine|could not be found|failed to load because module/i.test(text)
  )
    return t('项目里有 C++ 模块（常见是刚更新的 UELink）还没编译：在 IDE 里完整编译项目后再试')
  const errs = text
    .split(/\r?\n/)
    .filter((l) => /\b(Error|Fatal)\b/.test(l))
    .slice(-3)
    .map((l) =>
      l
        .replace(/^\[[^\]]*\]\[\s*\d+\]/, '')
        .trim()
        .slice(0, 300),
    )
  return errs.length ? `${errs.join('\n')}\n（${path.basename(newest.file)}）` : ''
}
