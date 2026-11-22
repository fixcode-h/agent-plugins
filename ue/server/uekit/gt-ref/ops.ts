import type { GtPropGroup, GtPropItem } from '../../../shared/gt-script/ref/types.ts'
import { luaRoot } from '../gt-author/lua-files.ts'
import { cmpVersion } from '../../semver.ts'
import type { UeProject } from '../../types.ts'
import { t } from '../../util.ts'
import { liveMap, type LuaLive } from './lua-live.ts'
import { luaDeclared, mergeLuaProps } from './lua-props.ts'

/**
 * GameTest 2.0 起的对象引用操作（协议 game-test-ref 第 7 节）：gt.tree / gt.highlight / gt.props / gt.refFor / gt.classes 照常转给 UE，
 * 面板在前后各做一件事：
 * - 前：编辑器里的 GameTest 低于这个操作要的版本（2.0.0，gt.classes 2.1.0）时直接报「请升级 GameTest」，不把「未知操作」原样丢出去；
 * - 后：gt.props 按 luaModule 读 Lua 源码补 Lua 字段 `@#x`（7.5）。UE 太旧、游戏没开时，只要知道模块（参数 luaModule）
 *   照样返回 Lua 声明的字段（unavailable 写原因），编辑页的 Lua 字段下拉不至于空着。
 * 不 import instances.ts（选进程、发请求由 ops.ts 传进来），单测不用面板。
 */
export const GT_REF_OPS = new Set(['gt.tree', 'gt.highlight', 'gt.props', 'gt.refFor', 'gt.classes'])
export const GT_REF_MIN = '2.0.0'
/** 比 2.0.0 晚加的操作各自要的最低版本：gt.classes（选对象面板的类树）随 v5 脚本一起在 2.1.0 加 */
const OP_MIN: Record<string, string> = { 'gt.classes': '2.1.0' }
export const gtRefMinOf = (op: string) => OP_MIN[op] ?? GT_REF_MIN
/** 读结构的上限（ADR 0067、协议 7.3） */
const PROPS_MAX = 12000

interface CardLike {
  extensions?: { name: string; version: string }[]
}
type A = Record<string, unknown>

const upgradeMsg = (m: string, v?: string) =>
  v
    ? t(
        '请升级 GameTest 到 {m}：编辑器里是 {v}，这个功能（控件树、属性树、类树、描边）要 {m} 起；在 UE 页「UE 插件」升级并重新编译',
        { m, v },
      )
    : t('请升级 GameTest 到 {m}：编辑器里的 GameTest 不认这个操作；在 UE 页「UE 插件」升级并重新编译', { m })

/** 名片上的 GameTest 低于 min（或没加载）时给出原因；名片没列扩展（旧 UELink）时交给 UE 自己回错 */
export function gameTestTooOld(card: CardLike, min = GT_REF_MIN): string | undefined {
  if (!card.extensions) return undefined
  const gt = card.extensions.find((x) => x.name === 'GameTest')
  if (!gt) return t('编辑器里没加载 GameTest：在 UE 页「UE 插件」装上 GameTest {m} 并重新编译', { m: min })
  return cmpVersion(gt.version, min) < 0 ? upgradeMsg(min, gt.version) : undefined
}

/** UE 回「不认识的操作」时换成升级提示，其余错误原样 */
function explain(e: unknown, min: string): Error {
  const msg = (e as Error).message ?? String(e)
  return /unknown|不认识|未知|not found|没有.*操作/i.test(msg) ? new Error(upgradeMsg(min)) : (e as Error)
}

export interface GtRefDeps<C extends CardLike> {
  project: Pick<UeProject, 'root' | 'luaBuild'>
  /** 挑进程（ops.ts 的 chooseCard：没有游戏进程时抛错） */
  pick: () => Promise<C>
  send: (card: C, args: A) => Promise<A>
  /** gt.classes 连不上 UE（没开、GameTest 太旧）时改从磁盘读类树（offline/classes.ts）；note 是给界面看的原因 */
  offlineClasses?: (args: A, note: string) => Promise<A>
  /** 读对象实例表这一层（UELink lua.get，回 {fields}）：gt.props 按对象路径读时补 UE 没给的 Lua 字段此刻的值 */
  luaFields?: (card: C, path: string) => Promise<A>
}

export async function gtRefOp<C extends CardLike>(op: string, args: A, deps: GtRefDeps<C>): Promise<A> {
  const { luaModule, ...fwd } = args
  let res: A | undefined
  let failed: Error | undefined
  let card: C | undefined
  try {
    card = await deps.pick()
    const old = gameTestTooOld(card, gtRefMinOf(op))
    if (old) throw new Error(old)
    res = await deps.send(card, fwd)
  } catch (e) {
    failed = explain(e, gtRefMinOf(op))
  }
  // 类树不该要求编辑器开着（用户 2026-11-21）：连不上 UE 时从磁盘读，界面在下拉底部显示 note
  if (op === 'gt.classes' && failed && deps.offlineClasses)
    return deps.offlineClasses(
      fwd,
      t('UE 没在运行，类树从项目文件读，没有此刻实例数（{why}）', { why: failed.message }),
    )
  // Lua 类树以磁盘上的源码为准（用户 2026-11-22「为什么对不上」）：UE 只认 package.loaded 里已经 require 过的模块，
  // 没加载的源文件看不到，UnLua 自己的框架模块倒列了出来。目录和文件按脚本根扫，UE 只拿来补此刻的实例数
  if (op === 'gt.classes' && args.lua && !failed && res && deps.offlineClasses) {
    const disk = await deps.offlineClasses(fwd, '').catch(() => undefined)
    if (disk && (Number(disk.total) > 0 || (disk.dirs as unknown[] | undefined)?.length))
      return withLiveCounts(disk, res)
  }
  if (op !== 'gt.props') {
    if (failed) throw failed
    return res!
  }
  // Lua 类（class: "lua:模块"）读不到 UE 时，模块就是类名本身：游戏没开也从源码列字段和函数（用户 2026-11-21）
  const luaCls = typeof args.class === 'string' && args.class.startsWith('lua:') ? args.class.slice(4) : ''
  const mod = String(res?.luaModule ?? luaModule ?? luaCls)
  // 不知道 Lua 模块又拿不到 UE 的结果：没有能给的
  if (failed && !mod) throw failed
  // 游戏开着、读的是某个实例：直接读它的实例表这一层，UE 名额外的字段也有此刻的值（用户 2026-11-22：DefaultFOV 显示「游戏没开」）
  let live: LuaLive | undefined
  const path = typeof args.path === 'string' ? args.path : ''
  if (!failed && card && path && mod && deps.luaFields && !args.part && !Number(args.offset ?? 0))
    live = await deps.luaFields(card, path).then(
      // 没绑 Lua 的对象（value 不是表）不算读到，免得把字段都说成「此刻是 nil」
      (r) => ((r.value as { t?: string } | undefined)?.t === 'table' ? liveMap(r.fields) : undefined),
      () => undefined,
    )
  const srcWhy = failed
    ? undefined
    : live
      ? t('这个实例上此刻是 nil（还没赋值）：值是源码里的写法')
      : path || args.target || args.node
        ? undefined
        : t('没选实例：值是源码里的写法；在实例列表里点一个看此刻的值')
  return withLua(deps.project, res ?? { class: args.class ?? '', groups: [] }, args, mod, {
    unavailable: failed?.message,
    live,
    srcWhy,
  })
}

/** 磁盘上的 Lua 类树补上 UE 给的此刻实例数（按模块名对，大小写和 / . 不敏感） */
function withLiveCounts(disk: A, live: A): A {
  const norm = (s: string) => s.replace(/[/\\]/g, '.').toLowerCase()
  const counts = new Map<string, number>()
  for (const x of (live.items as { name: string; live?: number }[] | undefined) ?? [])
    if (typeof x.live === 'number') counts.set(norm(x.name), x.live)
  const items = ((disk.items as { name: string; live?: number }[] | undefined) ?? []).map((x) => {
    const n = counts.get(norm(x.name))
    return n === undefined ? x : { ...x, live: n }
  })
  const { note, ...rest } = disk
  return { ...rest, items, ...(note ? { note } : {}), ...(live.note ? { note: live.note } : {}) }
}

/** gt.props 的结果补 Lua 声明字段；看的是部件（part）或翻到后面几页时不补（Lua 字段属于对象本身，在第一页的 self 组） */
async function withLua(
  project: GtRefDeps<CardLike>['project'],
  res: A,
  args: A,
  mod: string,
  o: { unavailable?: string; live?: LuaLive; srcWhy?: string },
) {
  const { unavailable } = o
  const out: A = { ...res, ...(mod ? { luaModule: mod } : {}), ...(unavailable ? { unavailable } : {}) }
  if (!mod || args.part || Number(args.offset ?? 0) > 0) return out
  // 没有源文件（模块不在脚本根里）时只按实例表补
  const decl =
    (await luaDeclared(luaRoot(project), mod)) ?? (o.live?.size ? { file: '', fields: [], functions: [] } : undefined)
  if (!decl) return out
  const groups = Array.isArray(res.groups) ? (res.groups as GtPropGroup[]) : []
  const merged = mergeLuaProps(groups, decl, {
    filter: typeof args.filter === 'string' ? args.filter : '',
    selfTitle: t('自己'),
    live: o.live,
    srcWhy: o.srcWhy,
  })
  out.groups = merged.groups
  if (decl.file) out.luaFile = decl.file
  // Lua 函数：UE 给过（lua: 类在游戏里读的 functions 组，项没有 src）就按名字补上源码里的返回类型；
  // 没给（游戏没开、读的是 UE 实例，GameTest 2.1.5 起 functions 组是 UE 函数）时单独一组用源码里的
  const fnRet = new Map(decl.functions.filter((f) => f.ret).map((f) => [f.name, f.ret!]))
  const luaFns = merged.groups.find((g) => g.id === 'functions' && g.items.some((x) => !(x as { src?: string }).src))
  if (luaFns) {
    for (const x of luaFns.items as unknown as { name: string; ret?: string }[])
      if (!x.ret && fnRet.has(x.name)) x.ret = fnRet.get(x.name)
  } else if (decl.functions.length) {
    merged.groups.push({ id: 'luaFunctions', title: t('Lua 函数'), items: decl.functions as unknown as GtPropItem[] })
  }
  // 超长时从补上的 Lua 声明尾部砍（UE 给的部分 UE 自己分过页），至少留一项
  const self = merged.groups.find((g) => g.id === 'self')
  let extra = merged.added
  while (self && extra > 1 && JSON.stringify(out).length > PROPS_MAX) {
    const drop = Math.max(1, Math.floor(extra * 0.3))
    self.items.splice(self.items.length - drop, drop)
    extra -= drop
    out.truncated = true
  }
  return out
}
