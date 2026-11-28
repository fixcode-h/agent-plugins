import { ownFields } from '../walk.ts'
import { issue, type Check, type Issue } from './types.ts'

/**
 * 项目接口（`项目.` 开头）GameTest 2.9.0 起不认（用户 2026-11-28：不许为测试专门写接口）：用到就报错、说改用什么。
 * 自带接口（Object.* / Widget.* …）的清单在编辑器里，离线不查
 */
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** 一步里用到的接口名：api 步骤、条件里的 { api }（任意深度） */
export function apiNames(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => apiNames(x, out))
  else if (isObj(v)) {
    if (typeof v.api === 'string') out.push(v.api)
    Object.values(v).forEach((x) => apiNames(x, out))
  }
  return out
}

export function projectApis(api: Obj) {
  const names = new Map<string, Obj>()
  for (const src of ['cpp', 'lua']) {
    const sec = api[src]
    if (isObj(sec) && Array.isArray(sec.items))
      for (const x of sec.items) if (isObj(x) && typeof x.name === 'string') names.set(x.name, x)
  }
  return { names, renamed: (isObj(api.renamed) ? api.renamed : {}) as Record<string, string> }
}

export const apis: Check = {
  name: 'apis',
  summary: '不再用项目接口（项目.…，GameTest 2.9.0 起不认）',
  async run(env) {
    const out: Issue[] = []
    for (const s of env.steps)
      for (const name of apiNames(ownFields(s.step))) {
        if (!name.startsWith('项目.')) continue
        // 用户 2026-11-28：不许为测试专门写接口，测试调项目实际的业务接口
        out.push(
          issue(
            s,
            'api_missing',
            `${name} 是项目测试接口，GameTest 2.9.0 起不认了：有 GM 用「执行 GM」（gm.run），业务对象上的函数用「对象调用」（obj.do），都不行再写 Lua 代码节点（lua）或函数库（luafn）`,
          ),
        )
      }
    return out
  },
}
