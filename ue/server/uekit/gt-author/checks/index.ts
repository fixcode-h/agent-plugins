import { actions } from './actions.ts'
import { apis } from './apis.ts'
import { calls } from './calls.ts'
import { exprs } from './exprs.ts'
import { ids } from './ids.ts'
import { lua } from './lua.ts'
import { notes } from './notes.ts'
import { refs } from './refs.ts'
import { shape } from './shape.ts'
import { unsupported } from './unsupported.ts'
import type { Check } from './types.ts'
import { vars } from './vars.ts'

/**
 * 离线校验的检查表：加一种检查就加一个文件、在这里注册一行。
 * panelOnly：编辑器开着时也要跑的（UE 的 gt.validate 看不到面板这边的东西：Lua 文件、_api.json 的 lua 段）
 */
const table: { check: Check; panelOnly?: boolean }[] = [
  { check: shape },
  { check: ids },
  { check: refs },
  { check: actions },
  { check: calls },
  { check: vars },
  { check: exprs },
  { check: apis },
  { check: unsupported },
  { check: lua, panelOnly: true },
  // UE 的 gt.validate 不查 title / note（面板这边的约定），编辑器开着时也要跑
  { check: notes, panelOnly: true },
]

export function registerCheck(check: Check, panelOnly = false) {
  table.push({ check, panelOnly })
}

export const offlineChecks = () => table.map((x) => x.check)
export const panelOnlyChecks = () => table.filter((x) => x.panelOnly).map((x) => x.check)
