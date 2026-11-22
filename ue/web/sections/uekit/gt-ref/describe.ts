import {
  describeIdent,
  describeItem,
  describeRef as sharedDescribeRef,
  describeTarget,
  inObj,
  inlineOf,
  inWords,
  looksLikeSelector,
  refForm,
  shortClass,
  toTarget,
  type GtIdentItem,
  type GtIdentNode,
  type GtRef,
  type GtRefLike,
  type GtTarget,
} from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'

/**
 * 界面上引用的一行字：拼法都在 shared/gt-script/ref/describe.ts（列表、流程图、报告、服务端同一份），
 * 这里只把界面的 t 传进去，再补几个只有界面用的小工具（卡片标题、步骤标题里的短名、旧选择器提示）
 */
const o = (objects?: unknown) => ({ t, objects })

/** 类名显示用：去掉资源路径前缀、`_C` 后缀（`/Game/UI/WBP_Shop.WBP_Shop_C` → `WBP_Shop`） */
/** 界面上显示的类名：Lua 类只显示模块名最后一段（完整路径太长会把栏标题挤得重叠，用户 2026-11-21），完整的放悬停提示 */
export const classShort = (cls: string | undefined) =>
  cls ? (shortClass(cls).split(/[/.]/).filter(Boolean).at(-1) ?? shortClass(cls)) : ''

/** 一条标识 / 判断的一句话：`TxtTitle 文字 = 杂货铺` */
export const identText = (it: Partial<GtIdentItem>) => describeItem(it, o())

/** 标识的短写（对象卡片的 chips、脚本对象列表）；条件组写成「（A 或 B）」 */
export const identShort = (it: GtIdentNode) => describeIdent([it], o())

/** 整个唯一标识的一句话：组之间「，」，组里「且 / 或」 */
export const identTreeText = (nodes: readonly GtIdentNode[]) => describeIdent(nodes, o())

/** 引用的一句话：`WBP_Shop（标题 = 杂货铺，ShopId = 1001）`；名字引用、`$var` 原样（给 objects 时名字后面带类） */
export const describeRef = (ref: GtRefLike | undefined, objects?: unknown) =>
  ref === undefined || ref === null || ref === '' ? '' : sharedDescribeRef(ref, o(objects))

/** 「在哪找」一个词的显示 */
export const inWordText = (w: string) =>
  w === 'screen'
    ? t('屏上界面')
    : w === 'world'
      ? t('关卡 Actor')
      : w === 'lua'
        ? t('Lua 对象')
        : w === 'all'
          ? t('所有对象')
          : w

const SOURCE_WORDS: Record<string, () => string> = {
  gi: () => t('游戏实例'),
  gs: () => t('游戏状态'),
  gm: () => t('游戏模式'),
  ps: () => t('玩家状态'),
  pc: () => t('玩家控制器'),
  pawn: () => t('玩家角色'),
  hud: () => t('HUD'),
  sub: () => t('子系统'),
  luaMod: () => t('Lua 模块'),
  luaG: () => t('Lua 全局'),
  cvar: () => t('控制台变量'),
  actor: () => t('关卡 Actor'),
}

/**
 * 取值来源字符串（`@sub.UQuestSubsystem.DailyLeft`、`@pc`）在界面上的写法：「子系统 UQuestSubsystem · DailyLeft」。
 * 文件里还是 GameTest 认的 @ 写法，界面上不出现 @ 路径（分析文档 B5，2026-11-21 定）；不认得的原样
 */
export function sourceText(v: string): string {
  const m = /^@(\w+)(?:\.(.+))?$/.exec(v.trim())
  const word = m && SOURCE_WORDS[m[1]]
  if (!m || !word) return v
  if (!m[2]) return word()
  if (m[1] === 'sub') {
    const [cls, ...rest] = m[2].split('.')
    return rest.length ? `${word()} ${cls} · ${rest.join('.')}` : `${word()} ${cls}`
  }
  return `${word()} · ${m[2]}`
}

/** 对象卡片的「在哪找」：一个词、几个词（数组）、`@来源`、另一个对象里的容器 */
export function inText(inn: GtRef['in']): string {
  if (inn === undefined) return t('自动')
  const io = inObj(inn)
  if (io) return `${typeof io.obj === 'string' ? io.obj : classShort(io.obj.class)}${io.part ? ` › ${io.part}` : ''}`
  if (typeof inn === 'string' && inn.startsWith('@')) return sourceText(inn)
  return inWords(inn).map(inWordText).join(' · ')
}

/** 引用对象（不是名字、不是 $var） */
export const isRefObj = (v: unknown): v is GtRef => refForm(v) === 'inline'

/** 第 2 节的 target：`{obj, part?, slate?}`；也接受直接写引用（= {obj: 它}）。v3 的选择器字符串不算 */
export function asTarget(v: unknown): GtTarget | undefined {
  if (typeof v === 'string' && v && !v.startsWith('$') && looksLikeSelector(v)) return undefined
  return toTarget(v)
}

/** v3 的选择器字符串（`WBP_X:Root/Btn`）：v4 里不认，界面上提示升级 */
export const isOldSelector = (v: unknown) => typeof v === 'string' && v !== '' && !asTarget(v)

/** 动作落点的一句话：`shop › BtnBuy`；旧选择器原样 */
export function targetText(v: unknown, objects?: unknown): string {
  if (typeof v === 'string') return v.startsWith('@') ? sourceText(v) : v
  return asTarget(v) ? describeTarget(v, o(objects)) : ''
}

/** 把名字引用展开成对象（gt.resolve 不认场景里的名字时，面板先展开再问）；`in.obj` 也展开，成环就停 */
export function inlineRef(ref: GtRefLike, objects: Record<string, unknown> | undefined, depth = 0): GtRefLike {
  if (depth > 8) return ref
  if (typeof ref === 'string') {
    const def = inlineOf(ref, objects)
    return def ? inlineRef(def, objects, depth + 1) : ref
  }
  const io = inObj(ref.in)
  if (io) return { ...ref, in: { ...io, obj: inlineRef(io.obj, objects, depth + 1) } }
  return ref
}

/** 引用的类（名字查 objects）：列部件、按类读属性用 */
export function classOfRef(ref: GtRefLike | undefined, objects?: Record<string, unknown>): string {
  return ref ? (inlineOf(ref, objects)?.class ?? '') : ''
}

/** 步骤标题里的控件名：部件名，没有部件时是对象名或类名 */
export function targetShort(v: unknown): string {
  const tg = asTarget(v)
  if (!tg) return typeof v === 'string' ? v : ''
  if (tg.part) return tg.part.split('.').pop() ?? tg.part
  return typeof tg.obj === 'string' ? tg.obj : classShort(tg.obj.class)
}
