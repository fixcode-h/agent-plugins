import type { LuaFnStore } from '../../../../shared/gt-script/luafn/schema.ts'

/**
 * 离线校验（编辑器没开时的 ue_gametest action=validate）的扩展点：一种检查一个文件，注册进 checks/index.ts 的表。
 * 主流程（validate.ts）只遍历注册表，不按检查名写分支（用户 2026-11-18：模块化、方便扩展）。
 * 错误码照 GameTest 脚本协议第 12 节，和 UE 的 gt.validate 同一套，Agent 不用分两种读法。
 */
export interface Issue {
  /** 步骤 id（有的话） */
  id?: string
  /** 步骤在脚本里的位置（steps.3.do.0） */
  path: string
  code: string
  message: string
  level: 'error' | 'warning'
}

export interface StepRef {
  step: Record<string, unknown>
  path: string
  /** 在守护里（guards.N.do…） */
  inGuard: boolean
}

export interface CheckEnv {
  doc: Record<string, unknown>
  /** 深度优先列出的全部步骤（含块里、守护里的） */
  steps: StepRef[]
  /** 场景根（绝对路径）；校验临时脚本时也有，用来找 call 的目标、_api.json */
  scenarioRoot: string
  /** 这份脚本相对场景根的路径（临时脚本为空）：查 call 成环用 */
  self: string
  /** Lua 脚本根（绝对路径） */
  luaRoot: string
  /** 读场景根里的另一份脚本（call 的目标），读不到为 undefined；结果有缓存 */
  loadScript: (rel: string) => Promise<Record<string, unknown> | undefined>
  /** 场景根 _api.json（读不到是空对象） */
  api: () => Promise<Record<string, unknown>>
  /** GameTest 的 Lua 函数库（AgentPanel/UE/gametest-lua.json）；单测、样例校验不给时当空的 */
  luaFns?: () => Promise<LuaFnStore>
}

export interface Check {
  name: string
  /** 说明这项检查查什么（列给 Agent 看 checked 时用） */
  summary: string
  run: (env: CheckEnv) => Issue[] | Promise<Issue[]>
}

export const issue = (
  s: StepRef | undefined,
  code: string,
  message: string,
  level: Issue['level'] = 'error',
): Issue => ({
  ...(s && typeof s.step.id === 'string' ? { id: s.step.id } : {}),
  path: s?.path ?? '',
  code,
  message,
  level,
})
