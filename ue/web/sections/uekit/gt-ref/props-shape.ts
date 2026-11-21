import type { GtPropGroup, GtPropItem } from '../../../../shared/gt-script/ref/types.ts'
import { t } from '../../../host.ts'

/** gt.props 的 functions 组里的一项（Lua 类的函数）：只有名字、参数、定义在哪个父类 */
interface LuaFnRaw {
  name: string
  params?: string[]
  from?: string
  /** UE 类的函数（GameTest 2.1.5）才有：返回类型、cpp / bp、BlueprintPure */
  ret?: string
  src?: string
  pure?: boolean
  /** 无参取值函数：能写进路径（`@.名字()`），带 kind / ops，可以当唯一标识的条件 */
  path?: string
  kind?: string
  ops?: string[]
}

const isFn = (x: unknown): x is LuaFnRaw =>
  !!x && typeof x === 'object' && typeof (x as LuaFnRaw).name === 'string' && !('prop' in (x as object))

/** 函数 → 细节栏「方法」页的一行：路径写不出来（不能当标识），所以用一个不是路径的键、标成不能比 */
function fnItem(f: LuaFnRaw): GtPropItem {
  const params = Array.isArray(f.params) ? f.params.map(String) : []
  const src = f.src === 'cpp' || f.src === 'bp' ? f.src : 'lua'
  // 能当条件的取值函数（UE 给了 path）：路径就是它，kind 是返回值的
  const usable = typeof f.path === 'string' && f.path.startsWith('@') && Array.isArray(f.ops) && f.ops.length > 0
  return {
    prop: usable ? f.path! : `fn:${f.name}`,
    name: `${f.name}(${params.join(', ')})`,
    src: src === 'lua' ? 'lua' : src,
    type: typeof f.ret === 'string' && f.ret ? f.ret : 'function',
    kind: usable ? (f.kind as GtPropItem['kind']) : 'object',
    ...(usable
      ? { ops: f.ops!.map(String) }
      : {
          comparable: false,
          why:
            params.length > 0
              ? t('有参数的函数不能当条件：调用用 obj.call')
              : f.ret
                ? t('这个函数不是 Pure 或 const，读值会改游戏，不能当条件')
                : t('函数只列出来看：调用用 obj.call'),
        }),
    luaFn: {
      params,
      ...(f.from ? { from: f.from } : {}),
      ...(typeof f.ret === 'string' && f.ret ? { ret: f.ret } : {}),
      src,
      ...(f.pure ? { pure: true } : {}),
    },
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
