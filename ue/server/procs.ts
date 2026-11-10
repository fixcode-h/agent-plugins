import path from 'node:path'
import type { BuildBlocker, UeProject } from './types.ts'
import { run, t } from './util.ts'

/**
 * 编译前查有没有开着的编辑器（只在 Windows 查）。
 *
 * 为什么要查：编辑器开着且启用了 Live Coding 时，UnrealBuildTool 看到 Live Coding 的互斥量就直接拒绝编译，
 * 只报一句 "Unable to build while Live Coding is active"。这个互斥量按编辑器可执行文件的路径命名，
 * 所以同一个引擎的任何编辑器（哪怕开的是别的项目、或者 -game 跑游戏）都会挡住；
 * 关掉 Live Coding 硬编也不行，编辑器占着模块的 DLL，链接会写不进去。
 * Live Coding 只有 Windows 有，其他平台不查。
 */
export const LIVE_CODING_BLOCK = /Unable to build while Live Coding is active/i

interface Proc {
  ProcessId: number
  ExecutablePath?: string | null
  CommandLine?: string | null
}

const norm = (p: string) => path.win32.normalize(p).toLowerCase()

/** 命令行里的 .uproject：双击 .uproject 或从启动器打开时都带着 */
function projectOf(cmd: string) {
  const m = /"([^"]+?\.uproject)"|(\S+?\.uproject)/i.exec(cmd)
  return m ? (m[1] ?? m[2] ?? '') : ''
}

/** 命令行第一段就是可执行文件（拿不到 ExecutablePath 时用，比如别的用户或提权起的进程） */
function exeOf(cmd: string) {
  const m = /^\s*(?:"([^"]+)"|(\S+))/.exec(cmd)
  return m ? (m[1] ?? m[2] ?? '') : ''
}

/**
 * 这个引擎的编辑器进程（UnrealEditor.exe，不含 -Cmd 的命令行版：它不开 Live Coding）。
 * 查不了（没有 PowerShell、超时）时返回 error，调用方照常编译，把原因写进输出。
 */
export async function editorBlockers(p: UeProject): Promise<{ list: BuildBlocker[]; error?: string }> {
  if (process.platform !== 'win32' || !p.engine.dir) return { list: [] }
  const r = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      // 不用双引号（经过 Windows 命令行转义容易被 PowerShell 拆坏）；输出改 UTF-8，免得中文路径在 GBK 控制台下乱码对不上
      "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter 'Name=''UnrealEditor.exe''' | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress",
    ],
    { timeout: 20000 },
  )
  if (r.code !== 0) return { list: [], error: (r.err || r.out).trim() || `exit ${r.code}` }
  let procs: Proc[] = []
  try {
    const parsed = r.out.trim() ? (JSON.parse(r.out) as Proc | Proc[]) : []
    procs = Array.isArray(parsed) ? parsed : [parsed]
  } catch (e) {
    return { list: [], error: (e as Error).message }
  }
  const bin = norm(path.win32.join(p.engine.dir, 'Engine', 'Binaries')) + '\\'
  const mine = norm(p.uproject)
  return {
    list: procs
      .filter((x) => {
        const exe = x.ExecutablePath || exeOf(x.CommandLine ?? '')
        return exe && norm(exe).startsWith(bin)
      })
      .map((x) => {
        const proj = projectOf(x.CommandLine ?? '')
        return {
          pid: x.ProcessId,
          project: proj,
          same: !!proj && norm(proj) === mine,
          game: /(^|\s)-game\b/i.test(x.CommandLine ?? ''),
        }
      }),
  }
}

/** 写进编译输出的说明：哪些进程挡着、怎么办 */
export function blockerLines(list: BuildBlocker[]) {
  const who = list
    .map((b) =>
      t('{kind} PID {pid}（{project}）', {
        kind: b.game ? t('游戏') : t('编辑器'),
        pid: b.pid,
        project: b.project ? (b.same ? t('本项目') : b.project) : t('项目未知'),
      }),
    )
    .join('、')
  return [
    t('这个引擎的编辑器还开着：{who}', { who: who || t('未知进程') }),
    t('编辑器启用 Live Coding 时引擎拒绝在外面编译，就算关了 Live Coding，编辑器也占着插件的 DLL，编出来写不进去。'),
    t('先保存并关掉编辑器再编译；只改了已加载模块的代码时，也可以在编辑器里按 Ctrl+Alt+F11 用 Live Coding 编。'),
  ]
}
