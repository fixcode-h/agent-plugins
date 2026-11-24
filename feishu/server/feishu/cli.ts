import { exitReason, runProcess } from '../exec/process.ts'
import { t } from '../../shared/i18n.ts'

/**
 * 跑本机的 lark-cli（飞书官方 CLI）：外部进程只走面板的统一入口 runProcess（Windows 上 npm 装的 .cmd 垫片由它处理）。
 * 参数按数组交给进程、不过 shell；身份固定 --as user（用户本人的飞书权限）。
 *
 * 输出契约（lark-cli README「JSON Output Contract」）：成功 stdout `{"ok":true,"data":…}`、退出码 0；
 * 失败 stderr `{"ok":false,"error":{type,code,message,hint}}`、退出码非 0。按 ok 和退出码判断，不看 code
 */

export interface LarkError {
  type?: string
  code?: number
  message: string
  hint?: string
}

export interface LarkResult {
  ok: boolean
  data?: unknown
  error?: LarkError
}

export interface LarkRun {
  /** 可执行文件：设置里填的路径，留空用 PATH 上的 lark-cli */
  bin: string
  args: string[]
  stdin?: string
  /** 工作目录：插件数据目录里这个对话的缓存目录（lark-cli 写文件、读相对路径都落在这里，不碰项目） */
  cwd: string
  signal?: AbortSignal
  timeoutMs?: number
}

/** 不带身份参数的命令：版本、登录状态这类 */
const NO_IDENTITY = new Set(['--version', 'auth', 'config', 'doctor'])

const parse = (s: string): Record<string, unknown> | undefined => {
  const text = s.trim()
  if (!text.startsWith('{')) return undefined
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

export async function runLark(o: LarkRun): Promise<LarkResult> {
  const args = NO_IDENTITY.has(o.args[0] ?? '') ? o.args : [...o.args, '--as', 'user']
  const lines: string[] = []
  const r = await runProcess({
    command: o.bin || 'lark-cli',
    args,
    cwd: o.cwd,
    env: process.env,
    stdin: o.stdin ?? '',
    signal: o.signal,
    timeoutMs: o.timeoutMs ?? 120_000,
    onLine: (l) => lines.push(l),
  })
  const stdout = lines.join('\n')
  if (r.spawnError)
    return {
      ok: false,
      error: {
        type: 'not_installed',
        message: t('没找到 lark-cli（{bin}）：{why}', { bin: o.bin || 'lark-cli', why: r.spawnError }),
        hint: t('先在终端装好并登录：npx @larksuite/cli@latest install，然后 lark-cli auth login'),
      },
    }
  if (r.killed)
    return {
      ok: false,
      error: { type: r.killed, message: r.killed === 'timeout' ? t('lark-cli 超时没有返回') : t('调用被取消') },
    }
  const out = parse(stdout)
  if (r.code === 0 && out?.ok !== false) return { ok: true, data: out ? (out.data ?? out) : stdout }
  const err = parse(r.stderr) ?? out
  const e = (err?.error ?? {}) as Partial<LarkError>
  return {
    ok: false,
    error: {
      type: e.type,
      code: e.code,
      message: e.message || r.stderr.trim().slice(-600) || exitReason(r) || t('lark-cli 执行失败'),
      hint: e.hint,
    },
  }
}

/** lark-cli 的版本（设置页检测用）：取不到返回空串 */
export async function larkVersion(bin: string, cwd: string) {
  const lines: string[] = []
  const r = await runProcess({
    command: bin || 'lark-cli',
    args: ['--version'],
    cwd,
    env: process.env,
    timeoutMs: 15_000,
    onLine: (l) => lines.push(l),
  })
  return r.code === 0 ? lines.join(' ').trim() : ''
}
