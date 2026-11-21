import type { GtPropGroup, GtPropItem } from '../../../../shared/gt-script/ref/types.ts'
import { t } from '../../../host.ts'

/** gt.props 的 functions 组里的一项（Lua 类的函数）：只有名字、参数、定义在哪个父类 */
interface LuaFnRaw {
  name: string
  params?: string[]
  from?: string
}

const isFn = (x: unknown): x is LuaFnRaw =>
  !!x && typeof x === 'object' && typeof (x as LuaFnRaw).name === 'string' && !('prop' in (x as object))

/** Lua 函数 → 细节栏的一行：路径写不出来（Lua 段后面不能调函数），所以用一个不是路径的键、标成不能比 */
function fnItem(f: LuaFnRaw): GtPropItem {
  const params = Array.isArray(f.params) ? f.params.map(String) : []
  return {
    prop: `fn:${f.name}`,
    name: `${f.name}(${params.join(', ')})`,
    src: 'lua',
    type: 'function',
    kind: 'object',
    comparable: false,
    why: t('Lua 函数只列出来看：调用用 obj.call'),
    luaFn: { params, ...(f.from ? { from: f.from } : {}) },
  }
}

/**
 * gt.props 的返回整成统一的组（C++ 读 Lua 类 `class: "lua:模块"` 时给 `lua` 组（prop 是 `@#字段`）和 `functions` 组
 * （项是 `{name, params, from?}`，没有 prop）；也接受它们放在顶层 `lua` / `functions` 数组里）。
 * 其余照原样。带 part 时 prop 相对部件，拼部件在 pick/data.ts 的 itemsOf 做
 */
export function normalizeGroups(raw: { groups?: unknown; lua?: unknown; functions?: unknown }): GtPropGroup[] {
  const out: GtPropGroup[] = []
  for (const g of Array.isArray(raw.groups) ? (raw.groups as GtPropGroup[]) : []) {
    const items = (Array.isArray(g.items) ? g.items : []) as unknown[]
    out.push({ ...g, items: items.map((x) => (isFn(x) ? fnItem(x) : (x as GtPropItem))) })
  }
  if (Array.isArray(raw.lua) && !out.some((g) => g.id === 'lua'))
    out.push({ id: 'lua', title: 'Lua', items: raw.lua as GtPropItem[] })
  if (Array.isArray(raw.functions) && !out.some((g) => g.id === 'functions'))
    out.push({ id: 'functions', title: t('Lua 函数'), items: (raw.functions as unknown[]).filter(isFn).map(fnItem) })
  return out
}
