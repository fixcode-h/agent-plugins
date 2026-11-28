import { existsSync } from 'node:fs'
import path from 'node:path'
import type { HookInput, HookOutput } from '../../../../sdk/server.ts'

/**
 * 不许往游戏项目里加测试用的 Lua 文件（用户 2026-11-28，长期硬规则）：以前 Agent 写测试时会建 GameTestApi/XxxTestApi.lua。
 * 清单 hooks 的 block-test-lua（改文件）、block-test-lua-shell（命令行）交到这里。范围（用户让我定）：
 * - 新建 .lua 文件（改已有的 .lua 是正常的 Lua 开发，不管）；
 * - 并且是测试相关：游戏测试角色（ue-gametest，含「游戏内测试」工作流的各节点）建的任何 .lua，
 *   或者别的角色建的、路径里带 GameTestApi / 文件名带 Test 的 .lua。
 * 拦下的原因写清楚改用什么；用户确实要建，按面板的放行流程请用户放行（插件钩子拦下的也能放行）
 */
export const TEST_LUA_HOOKS = ['block-test-lua', 'block-test-lua-shell']

/** 这次调用要写的文件：改文件工具点名的、补丁里的 Add File、shell 里重定向 / tee 写到的 .lua */
export function luaTargets(input: HookInput): string[] {
  const tool = input.tool
  if (!tool) return []
  const out = new Set<string>()
  const v = tool.input ?? {}
  if (tool.kind === 'edit') {
    for (const k of ['file_path', 'filePath', 'path', 'target_file']) if (typeof v[k] === 'string') out.add(v[k] as string)
    for (const x of Object.values(v))
      if (typeof x === 'string') for (const m of x.matchAll(/^\*\*\* Add File: (.+)$/gm)) out.add(m[1].trim())
  }
  if (tool.kind === 'shell') {
    const cmd = String(v.command ?? '')
    for (const m of cmd.matchAll(/(?:>>?|\btee\s+(?:-a\s+)?)\s*["']?([^\s"'|;&>]+\.lua)\b/gi)) out.add(m[1])
  }
  return [...out].filter((f) => /\.lua$/i.test(f))
}

const isTesty = (rel: string) => /(^|[\\/])GameTestApi([\\/]|$)/i.test(rel) || /test/i.test(path.basename(rel))

export function testLuaDeny(input: HookInput): HookOutput | undefined {
  const root = input.project?.path || ''
  const tester = /ue-gametest/.test(input.agent?.id ?? '')
  for (const f of luaTargets(input)) {
    const abs = path.resolve(root || '.', f)
    if (existsSync(abs)) continue
    const rel = root ? path.relative(root, abs) : f
    if (!tester && !isTesty(rel)) continue
    return {
      deny: true,
      reason:
        `不许往游戏项目里加测试用的 Lua 文件（${rel.replace(/\\/g, '/')}）：GameTest 的 Lua 只写在「Lua 代码」节点（action=lua，代码存在脚本 JSON 里）` +
        '或面板的 Lua 函数库（action=luafn，文件 AgentPanel/UE/gametest-lua.json，一组普通函数、不许有类结构，ue_gametest look what=api 的 luaFns 能看到）。' +
        '准备状态先用执行 GM，再用对象调用调项目实际的业务接口，最后才写 Lua。用户明确要求在项目里建这个文件时，请用户放行。',
    }
  }
  return undefined
}
