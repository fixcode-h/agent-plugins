/**
 * 跑 p4 / svn / git：都走面板的版本管理入口（面板开放模块 server/vcs/run、server/exec/git，面板 ADR 0073）。
 * 以前插件自己 execFile：不设 PWD（Mac / Linux 上 p4 按 PWD 找 .p4config，会连到面板启动目录的 client 上）、
 * 不进面板的限流和计数、git 也绕开了面板唯一的 git 入口。
 * 返回形状照旧（code / out / err），调用方不用改判断。面板模块在用到时才加载：只测纯逻辑的单测（node --test）不用拉起面板
 */
export interface VcsOut {
  code: number
  out: string
  err: string
}

export async function vcsCmd(
  cmd: 'p4' | 'svn' | 'git',
  args: string[],
  opts: { cwd: string; timeout?: number },
): Promise<VcsOut> {
  if (cmd === 'git') {
    const { gitRun } = await import('@panel/server/exec/git')
    const r = await gitRun(opts.cwd, args, { timeoutMs: opts.timeout ?? 15000 })
    return { code: r.spawnError ? -1 : (r.code ?? -1), out: r.stdout, err: r.spawnError || r.stderr }
  }
  const { vcsExec, vcsWhy } = await import('@panel/server/vcs/run')
  const r = await vcsExec(cmd, args, opts.cwd, { timeoutMs: opts.timeout ?? 15000 })
  const err = r.spawnError || r.timedOut || r.tooLarge ? vcsWhy(cmd, args, r) : r.stderr
  return { code: r.ok ? 0 : r.code || -1, out: r.stdout.toString('utf8'), err }
}
