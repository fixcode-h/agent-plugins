import { ownFields } from '../walk.ts'
import { issue, type Check, type Issue } from './types.ts'

/**
 * 项目接口（`项目.` 开头）在不在 _api.json 里、是不是改了名。自带接口（Object.* / Widget.* …）的清单在编辑器里，离线不查
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
  summary: '项目接口（项目.…）在 _api.json 里、没有改名',
  async run(env) {
    const out: Issue[] = []
    let lib: ReturnType<typeof projectApis> | undefined
    for (const s of env.steps)
      for (const name of apiNames(ownFields(s.step))) {
        if (!name.startsWith('项目.')) continue
        lib ??= projectApis(await env.api())
        if (lib.names.has(name)) continue
        const to = lib.renamed[name]
        out.push(
          to
            ? issue(s, 'api_renamed', `接口 ${name} 改名了，改用 ${to}`)
            : issue(
                s,
                'api_missing',
                `接口库里没有 ${name}：ue_gametest action=api 看有哪些（C++ 接口要编辑器扫过才在 _api.json 里）`,
              ),
        )
      }
    return out
  },
}
