import type { HookInput, HookOutput } from '../../sdk/server.ts'
import { projectForRun } from './registry.ts'

/**
 * 编译通过后问一次「要不要写 GameTest 测试脚本」（用户 2026-11-23）：UE 项目的验证默认到编译为止，引擎的
 * Automation RunTests 不跑（面板守卫拦）；要看功能在游戏里是否正常，改写 GameTest 脚本，写之前先弹卡问用户。
 * 只写在提示词里时实跑 4 次模型一次都没问（编译过了就收尾），所以在这一轮要结束时拦一次，让它用提问工具问。
 * 判断只看工具调用（不读模型回复的文字）：这个对话跑过 UE 编译、没问过用户、也没用过 ue_gametest，才拦，每个对话只拦一次
 */

interface Seen {
  built: boolean
  offered: boolean
  nudged: boolean
}

// 模块状态：运行时，对话 id → 这个对话里看到的工具调用；面板重启后清空（最多再问一次，可以接受）
const seen = new Map<string, Seen>()
const MAX = 500

const UE_BUILD =
  /(^|[\s"'\\/&|;(])(Build\.(bat|sh|command)|RunUAT\.(bat|sh)|UnrealBuildTool(\.exe|\.dll)?)(?=$|[\s"'])/i
const ASK = /ask_user|AskUserQuestion|request_user_input/i

function stateOf(id: string) {
  let s = seen.get(id)
  if (!s) {
    if (seen.size >= MAX) seen.delete(seen.keys().next().value!)
    seen.set(id, (s = { built: false, offered: false, nudged: false }))
  }
  return s
}

/** 工具后：记下跑没跑过 UE 编译、问没问过用户、用没用过 ue_gametest */
export function gtOfferTrack(input: HookInput): HookOutput | undefined {
  const tool = input.tool
  if (!tool) return undefined
  const s = stateOf(input.task.id)
  const name = `${tool.panel ?? ''} ${tool.name}`
  if (ASK.test(name) || /ue_gametest/.test(name)) s.offered = true
  const cmd = String(tool.input.command ?? '')
  if ((tool.kind === 'shell' || tool.panel === 'run_background') && UE_BUILD.test(cmd) && !tool.result?.failed)
    s.built = true
  return undefined
}

/** 这一轮要结束：编译过、没问过、没拦过，就拦一次让它问 */
export async function gtOfferBeforeEnd(input: HookInput): Promise<HookOutput | undefined> {
  const s = seen.get(input.task.id)
  if (!s?.built || s.offered || s.nudged) return undefined
  if (!(await projectForRun(input.project.id, input.project.path))) return undefined
  s.nudged = true
  return {
    block: true,
    reason:
      '【UE】这次跑了编译，验证到编译为止就够了；结束前用提问工具问用户一次：「要不要写一份 GameTest 测试脚本，在游戏里验证这次的改动？」写明打算测什么（哪个界面、哪几步、检查什么），给「写」和「不用，编译通过就行」两个选项。用户同意就按 ue-gametest-authoring 技能写脚本、validate、用 ue_gametest 跑；不同意、或问题没交给用户（「提问」开关关着）就不写，直接结束，回复里说一句「要在游戏里验证的话，回我『写 GameTest』」。这次只改了文档、配置或用户已经说过要不要写测试时，不用问，直接结束。不要跑 Automation RunTests。',
  }
}
