import type { GtPropGroup } from '../../../shared/gt-script/ref/types.ts'
import { luaRoot } from '../gt-author/lua-files.ts'
import { cmpVersion } from '../../semver.ts'
import type { UeProject } from '../../types.ts'
import { t } from '../../util.ts'
import { luaDeclared, mergeLuaProps } from './lua-props.ts'

/**
 * GameTest 2.0 的对象引用操作（协议 game-test-ref 第 7 节）：gt.tree / gt.highlight / gt.props / gt.refFor 照常转给 UE，
 * 面板在前后各做一件事：
 * - 前：编辑器里的 GameTest 低于 2.0.0 时直接报「请升级 GameTest 到 2.0.0」，不把「未知操作」原样丢出去；
 * - 后：gt.props 按 luaModule 读 Lua 源码补 Lua 字段 `@#x`（7.5）。UE 太旧、游戏没开时，只要知道模块（参数 luaModule）
 *   照样返回 Lua 声明的字段（unavailable 写原因），编辑页的 Lua 字段下拉不至于空着。
 * 不 import instances.ts（选进程、发请求由 ops.ts 传进来），单测不用面板。
 */
export const GT_REF_OPS = new Set(['gt.tree', 'gt.highlight', 'gt.props', 'gt.refFor'])
export const GT_REF_MIN = '2.0.0'
/** 读结构的上限（ADR 0067、协议 7.3） */
const PROPS_MAX = 12000

interface CardLike {
  extensions?: { name: string; version: string }[]
}
type A = Record<string, unknown>

const upgradeMsg = (v?: string) =>
  v
    ? t(
        '请升级 GameTest 到 2.0.0：编辑器里是 {v}，对象引用（控件树、属性树、描边）要 2.0.0 起；在 UE 页「UE 插件」升级并重新编译',
        {
          v,
        },
      )
    : t('请升级 GameTest 到 2.0.0：编辑器里的 GameTest 不认这个操作；在 UE 页「UE 插件」升级并重新编译')

/** 名片上的 GameTest 低于 2.0.0（或没加载）时给出原因；名片没列扩展（旧 UELink）时交给 UE 自己回错 */
export function gameTestTooOld(card: CardLike): string | undefined {
  if (!card.extensions) return undefined
  const gt = card.extensions.find((x) => x.name === 'GameTest')
  if (!gt) return t('编辑器里没加载 GameTest：在 UE 页「UE 插件」装上 GameTest 2.0.0 并重新编译')
  return cmpVersion(gt.version, GT_REF_MIN) < 0 ? upgradeMsg(gt.version) : undefined
}

/** UE 回「不认识的操作」时换成升级提示，其余错误原样 */
function explain(e: unknown): Error {
  const msg = (e as Error).message ?? String(e)
  return /unknown|不认识|未知|not found|没有.*操作/i.test(msg) ? new Error(upgradeMsg()) : (e as Error)
}

export interface GtRefDeps<C extends CardLike> {
  project: Pick<UeProject, 'root' | 'luaBuild'>
  /** 挑进程（ops.ts 的 chooseCard：没有游戏进程时抛错） */
  pick: () => Promise<C>
  send: (card: C, args: A) => Promise<A>
}

export async function gtRefOp<C extends CardLike>(op: string, args: A, deps: GtRefDeps<C>): Promise<A> {
  const { luaModule, ...fwd } = args
  let res: A | undefined
  let failed: Error | undefined
  try {
    const card = await deps.pick()
    const old = gameTestTooOld(card)
    if (old) throw new Error(old)
    res = await deps.send(card, fwd)
  } catch (e) {
    failed = explain(e)
  }
  if (op !== 'gt.props') {
    if (failed) throw failed
    return res!
  }
  const mod = String(res?.luaModule ?? luaModule ?? '')
  // 不知道 Lua 模块又拿不到 UE 的结果：没有能给的
  if (failed && !mod) throw failed
  return withLua(deps.project, res ?? { class: args.class ?? '', groups: [] }, args, mod, failed?.message)
}

/** gt.props 的结果补 Lua 声明字段；看的是部件（part）或翻到后面几页时不补（Lua 字段属于对象本身，在第一页的 self 组） */
async function withLua(project: GtRefDeps<CardLike>['project'], res: A, args: A, mod: string, unavailable?: string) {
  const out: A = { ...res, ...(mod ? { luaModule: mod } : {}), ...(unavailable ? { unavailable } : {}) }
  if (!mod || args.part || Number(args.offset ?? 0) > 0) return out
  const decl = await luaDeclared(luaRoot(project), mod)
  if (!decl) return out
  const groups = Array.isArray(res.groups) ? (res.groups as GtPropGroup[]) : []
  const merged = mergeLuaProps(groups, decl, {
    filter: typeof args.filter === 'string' ? args.filter : '',
    selfTitle: t('自己'),
  })
  out.groups = merged.groups
  out.luaFile = decl.file
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
