import type { Target } from '../../../server/types.ts'
import { op, ppost } from '../../api.ts'
import { luaCall } from '../../../server/lua-gm/call.ts'
import { cppLine, type GmEntry } from './data.ts'

export interface RunOut {
  ok: boolean
  lines: string[]
  error?: string
  /** 实际执行的：Lua 代码或控制台写法 */
  code: string
}

/** 执行一条 GM：Lua 走 lua-gm/run（服务端按扫描结果拼代码，和预览同一个 luaCall），C++ 走 gm.run，控制台命令走 console（自定义 GM 见 custom/run-custom.ts） */
export async function runEntry(projectId: string, e: GmEntry, args: string[], target?: Target): Promise<RunOut> {
  let code = ''
  try {
    if (e.src === 'console') {
      code = e.name
      const r = await ppost<{ output?: string[] }>(projectId, 'console', { command: e.name, target })
      return { ok: true, lines: r.output ?? [], code }
    }
    if (e.src === 'lua') {
      code = e.lua ? luaCall(e.lua, args) : e.name
      const r = await ppost<{ output?: string[]; results?: { v?: unknown }[]; code?: string }>(
        projectId,
        'lua-gm/run',
        {
          name: e.name,
          args,
          target,
        },
      )
      const ret = (r.results ?? []).map((x) => (typeof x.v === 'string' ? x.v : JSON.stringify(x.v))).filter(Boolean)
      return {
        ok: true,
        lines: [...(r.output ?? []), ...(ret.length ? [`→ ${ret.join(', ')}`] : [])],
        code: r.code ?? code,
      }
    }
    code = cppLine(e.name, args)
    const r = await op<{ output?: string[] }>(
      projectId,
      'gm.run',
      { name: e.name, owner: e.library ? e.owner : '', args },
      target,
    )
    return { ok: true, lines: r.output ?? [], code }
  } catch (err) {
    return { ok: false, lines: [], error: (err as Error).message, code }
  }
}

/** 预览「会执行」：参数不对时给出原因而不是抛错 */
export function preview(e: GmEntry, args: string[]): { code: string; error?: string } {
  if (e.src === 'console') return { code: e.name }
  if (e.src !== 'lua' || !e.lua) return { code: cppLine(e.name, args) }
  try {
    return { code: luaCall(e.lua, args) }
  } catch (err) {
    return { code: '', error: (err as Error).message }
  }
}

export interface MacroStepResult {
  step: number
  ok: boolean
  output?: string[]
  error?: string
}

/** 执行一个宏（服务端按步骤跑，任何一步失败就停）：宏编辑页的「执行全部」和左栏右键「执行」都走这里 */
export const runMacro = (projectId: string, id: string, target?: Target) =>
  ppost<{ ok: boolean; failedAt?: number; steps: MacroStepResult[] }>(projectId, 'macro', { id, target })
