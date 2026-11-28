import { stat } from 'node:fs/promises'
import path from 'node:path'
import { classIssues, fileWriteIssues, fnRefsIn, luaFnIssues } from '../../../../shared/gt-script/luafn/check.ts'
import { objDoRun } from '../../../../shared/gt-script/objdo/expand.ts'
import type { LuaFnStore } from '../../../../shared/gt-script/luafn/schema.ts'
import { issue, type Check, type Issue } from './types.ts'

/**
 * 测试里自己写的 Lua 和对象调用（GameTest 2.9.0，用户 2026-11-28）：
 * - Lua 代码节点、函数库不许有类结构（luafn_class），不许写文件（lua_file_write）；
 * - 调的函数库函数要在（luafn_missing）；require 测试模块（GameTestApi、…TestApi）报 lua_file_forbidden：测试 Lua 不许放进项目；
 * - 对象调用的每一项展开得出来（和存盘时同一份 objdo/expand.ts）。
 * 函数库、项目里的旧测试接口目录在面板这边，UE 的 gt.validate 看不到，所以编辑器开着也要跑
 */
const TEST_MODULE = /\brequire\s*\(?\s*["']([^"']*(?:GameTestApi|TestApi)[^"']*)["']/

export const luacode: Check = {
  name: 'luacode',
  summary: 'Lua 代码节点、脚本函数、对象调用：无类结构、不写文件、函数库函数存在、不 require 测试模块',
  async run(env) {
    const out: Issue[] = []
    let store: LuaFnStore | undefined
    const lib = async () => (store ??= env.luaFns ? await env.luaFns() : { kind: 'gametest-lua', version: 1, fns: [] })
    const has = async (n: string) => (await lib()).fns.find((f) => f.name === n)
    const code = (s: (typeof env.steps)[number], text: string, what: string) => {
      for (const why of classIssues(text)) out.push(issue(s, 'luafn_class', `${what}${why}：测试 Lua 只写普通函数`))
      for (const why of fileWriteIssues(text))
        out.push(issue(s, 'lua_file_write', `${what}${why}：测试 Lua 不许写文件`))
      const m = TEST_MODULE.exec(text)
      if (m)
        out.push(
          issue(
            s,
            'lua_file_forbidden',
            `${what}require 了测试模块 ${m[1]}：测试用的 Lua 不许放进项目，搬进节点或函数库（ue_gametest look what=api 的 luaFns 是函数库）`,
          ),
        )
    }
    for (const s of env.steps) {
      const st = s.step
      if (st.action === 'lua') {
        const text = typeof st.code === 'string' ? st.code : ''
        if (!text.trim()) out.push(issue(s, 'bad_type', 'Lua 代码节点没写代码'))
        code(s, text, '')
        for (const n of fnRefsIn(text)) if (!(await has(n))) out.push(issue(s, 'luafn_missing', `函数库里没有 ${n}`))
      }
      if (st.action === 'luafn') {
        const n = typeof st.fn === 'string' ? st.fn : ''
        const f = n ? await has(n) : undefined
        if (!n) out.push(issue(s, 'bad_type', '脚本函数节点没选函数（fn）'))
        else if (!f) out.push(issue(s, 'luafn_missing', `函数库里没有 ${n}：先在函数库里加上，或改用 Lua 代码节点`))
        else {
          for (const why of luaFnIssues(f)) out.push(issue(s, 'luafn_class', `函数库 ${n}：${why}`))
          code(s, f.body, `函数库 ${n}：`)
        }
      }
      if (st.action === 'obj.do') {
        try {
          objDoRun(st as never)
        } catch (e) {
          out.push(issue(s, 'bad_type', `对象调用：${(e as Error).message}`))
        }
      }
    }
    // 项目里还留着旧的测试接口目录（GameTestApi）：提醒迁走（只提醒一次，不挂在步骤上）
    if (env.luaRoot && (await stat(path.join(env.luaRoot, 'GameTestApi')).catch(() => undefined))?.isDirectory())
      out.push({
        path: '',
        code: 'lua_file_forbidden',
        message:
          '项目的 Lua 脚本根里还有 GameTestApi/（旧的测试接口）：GameTest 2.9.0 起不认了，搬进函数库或节点后删掉这个目录',
        level: 'warning',
      })
    return out
  },
}
