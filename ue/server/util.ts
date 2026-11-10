import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { McpResult, PluginServerContext } from '../../sdk/server.ts'

/** 插件上下文（activate 时设一次）：各模块用 c() 取数据目录、参数、文案 */
let current: PluginServerContext | undefined
export function setCtx(ctx: PluginServerContext) {
  current = ctx
}
export function c(): PluginServerContext {
  if (!current) throw new Error('UE 插件还没有激活')
  return current
}
export const t = (zh: string, vars?: Record<string, string | number>) => c().t(zh, vars)

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')) as T
  } catch {
    return fallback
  }
}

/** 先写临时文件再改名：写到一半进程退出也不会留下半个 JSON */
export async function writeJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n')
  await rename(tmp, file)
}

/** 跑一个命令拿输出：不经过 shell，超时按失败算 */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeout?: number } = {},
): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, timeout: opts.timeout ?? 15000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (e, out, err) => {
        const code = e ? (typeof (e as { code?: unknown }).code === 'number' ? (e as { code: number }).code : -1) : 0
        resolve({ code, out: String(out ?? ''), err: String(err ?? (e ? e.message : '')) })
      },
    )
  })
}

/** 进程还在不在（Windows 上 kill(pid, 0) 同样可用） */
export function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // 没权限发信号说明进程在（别的用户的进程）
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export const exists = (p: string) => !!p && existsSync(p)
export const now = () => new Date().toISOString()
export const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** 只有一段文字的 MCP 结果 */
export const mcpText = (text: string, isError = false): McpResult => ({
  content: [{ type: 'text', text }],
  ...(isError ? { isError: true } : {}),
})

/** 给 Agent 的结果限长：超长的截断并说明怎么取全量 */
export function clip(s: string, max = 12000) {
  if (s.length <= max) return s
  return `${s.slice(0, max)}\n…（还有 ${s.length - max} 个字符没列出：缩小范围，或按属性路径单独取）`
}

/** 通配：* 匹配任意字符，不区分大小写，整句匹配 */
export function wildcard(pattern: string, s: string) {
  const re = new RegExp(
    '^' +
      pattern
        .trim()
        .split('*')
        .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*') +
      '$',
    'i',
  )
  return re.test(s.trim())
}
