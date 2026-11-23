import { CodeXml, Copy, Play, SquareFunction } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { GmObject } from '../../shared/gm/schema.ts'
import type { Prop } from '../details/model.ts'
import { h, t } from '../host.ts'
import { copyText, openMenu } from '@panel/web/src/components/ui/item-menu'
import { useConnState } from '../conn/ConnPill.tsx'
import { useProps } from '../sections/uekit/gt-ref/live.ts'
import { useVars, type VarScope } from '../sections/uekit/gt-vars/model.ts'
import { declPropsOf, fnsOf, propsOf, scopeOf, type FnInfo } from './members.ts'
import { VarList, type VarSel } from './VarList.tsx'

/** 页签里具体看的那一栏：UE 页分函数 / 属性，Lua 页分函数 / 变量（用户 2026-11-23：方法和属性合成一个 UE 页，和 Lua 页一样里面再分两栏） */
export type MemberTab = 'fns' | 'props' | 'luaFns' | 'luaVars' | 'states'
type MemberGroup = 'ue' | 'lua' | 'states'
const groupOf = (t: MemberTab): MemberGroup =>
  t === 'fns' || t === 'props' ? 'ue' : t === 'luaFns' || t === 'luaVars' ? 'lua' : 'states'

/**
 * 对象调用中栏（规格第 7 节、效果图 2）：UE（函数 | 属性）· Lua（函数 | 变量）· 运行状态。方法按声明类分组，名字 + 签名，
 * 调不了的（callable:false）置灰、悬停写原因；属性、Lua 变量、运行状态是一行一个的变量列表（VarList），
 * 点一个在右栏「改变量」里抓取值、改值（用户 2026-11-22）；「取对象」时行尾的 ＋ 把属性加进要读的列表
 */
export function MemberPane({
  project,
  obj,
  live,
  tab,
  onTab,
  fn,
  onFn,
  needSig,
  onSig,
  picking,
  picked,
  onTogglePick,
  varSel,
  onVar,
  rev = 0,
  pinned,
  onTogglePin,
  scope,
  tabs,
}: {
  project: string
  obj: GmObject
  live: boolean
  tab: MemberTab
  onTab: (t: MemberTab) => void
  fn?: string
  onFn: (f: FnInfo) => void
  /** 选中的函数只有名字（打开自定义 GM、从调用记录填回）：列出函数后按名字找到它补签名（B5） */
  needSig?: boolean
  onSig?: (f: FnInfo) => void
  /** 正在「取对象」：属性行尾出 ＋ / × */
  picking?: boolean
  picked?: string[]
  onTogglePick?: (prop: string) => void
  /** 选中的变量（属性路径）：右栏「改变量」 */
  varSel?: string
  onVar?: (v: VarSel) => void
  /** 改完变量加一：重读属性 */
  rev?: number
  /** 钉住的属性（F4） */
  pinned?: string[]
  onTogglePin?: (prop: string) => void
  /** 列函数的范围另给（测试页静态函数按类列、$变量按前面「找对象」的类列）；不给按 obj 算 */
  scope?: VarScope
  /** 只出这几栏（测试页「换函数…」只要 UE 和 Lua 的函数）；不给全出。一页里只剩一栏时不出里面的切换 */
  tabs?: MemberTab[]
}) {
  const { ui, cn } = h()
  // 搜索按页签各记各的，换对象清空（L8：以前共用一个，切页签像是列表空了）
  const [qs, setQs] = useState<Partial<Record<MemberTab, string>>>({})
  const [qObj, setQObj] = useState(obj.name)
  if (qObj !== obj.name) {
    setQObj(obj.name)
    setQs({})
  }
  const q = qs[tab] ?? ''
  const setQ = (v: string) => setQs((m) => ({ ...m, [tab]: v }))
  // 游戏没在跑时按类列成员（F3）：函数用 gt.vars scope=class，属性用 gt.props 的 class 模式给类默认值，
  // 能先看清有什么、填好参数，开 PIE 后再调；游戏开着时照旧读命中的实例
  const game = useConnState().state === 'game'
  const cls = (obj.ref as { class?: string } | undefined)?.class
  const byClass = !game && !!cls
  // Lua 类（lua:模块）的成员一律从源码读（用户 2026-11-23）：纯 Lua 模块类不在 UE 的类表里，问 gt.vars 只会报
  // 「找不到类…蓝图类要加载过」，而源码里的函数、self 字段是全的；游戏开着时值照旧由 gt.props 读实例补上
  const luaCls = !!cls?.startsWith('lua:')
  const vars = useVars(project, scope ?? (byClass || luaCls ? { scope: 'class', name: cls! } : scopeOf(obj)), live)
  const props = useProps(
    project,
    obj.ref && live ? (game ? { target: { obj: obj.ref as { class: string } } } : { class: cls! }) : undefined,
    rev,
  )
  const groups = vars.data?.groups ?? []
  const fns = useMemo(() => fnsOf(groups.filter((g) => g.src !== 'lua')), [groups])
  const luaFns = useMemo(() => fnsOf(groups.filter((g) => g.src === 'lua')), [groups])
  const luaFields = groups.filter((g) => g.src === 'lua').flatMap((g) => g.items.filter((i) => i.kind === 'prop'))
  // UE 没连上、按类从源码读（用户 2026-11-23）：只给看，调用和改值要连上编辑器
  const fromSource = (byClass || luaCls) && !!vars.data?.offline
  // UE 没连上时属性、运行状态也只能从源码看；连着时照旧问 UE
  const srcOnly = fromSource && !live
  const srcWhy = !live
    ? t('UE 没连上：这是从源码读的声明，连上编辑器、游戏在跑才能读值和改')
    : t('游戏没在运行：这是从源码读的声明，开 PIE 后才能读值和改')
  const declProps = useMemo(() => (srcOnly ? declPropsOf(groups, srcWhy) : []), [srcOnly, groups, srcWhy])
  const liveProps = useMemo(() => propsOf(props.data, 'props'), [props.data])
  const propList = srcOnly ? declProps : liveProps
  const stateList = useMemo(() => propsOf(props.data, 'states'), [props.data])
  const luaProps = useMemo(() => propsOf(props.data, 'lua'), [props.data])
  // gt.props 没给 Lua 组时：Lua 文件里声明的字段（gt.vars + luafields），路径补成 obj.set 认的 @.字段
  const luaDecl = useMemo<Prop[]>(
    () =>
      luaFields.map((f) => ({
        name: f.path.startsWith('@') ? f.path : `@.${f.name}`,
        displayName: f.name,
        type: f.type ?? 'any',
        value: f.value,
        readOnly: !obj.ref || !game || !!f.readOnly,
        readOnlyWhy: !obj.ref ? t('来源对象不能直接改字段') : !game ? srcWhy : undefined,
        edit: true,
      })),
    [luaFields, obj.ref, game, srcWhy],
  )
  // 游戏开着：实例上读到的值在前，源码里声明了、实例上还没有的补在后面；游戏没开：源码里的全（UE 按类只给得出一部分）
  const luaVars = useMemo(() => {
    if (!game) return luaDecl.length ? luaDecl : luaProps
    const have = new Set(luaProps.map((p) => p.displayName ?? p.name))
    return [...luaProps, ...luaDecl.filter((d) => !have.has(d.displayName ?? d.name))]
  }, [game, luaProps, luaDecl])
  // 离线的 Lua 类只有 Lua 成员：停在空的「方法」页像是什么都没读到，换对象时直接翻到 Lua 页
  const toLua = fromSource && !fns.length && luaFns.length + luaVars.length > 0
  useEffect(() => {
    if (toLua && tab === 'fns') onTab(luaFns.length ? 'luaFns' : 'luaVars')
    // 只在换对象、刚读到成员时翻一次，之后用户自己点回「方法」不再跳
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [obj.name, toLua])
  useEffect(() => {
    if (!needSig || !fn) return
    const f = [...fns, ...luaFns].find((x) => x.name === fn)
    if (f) onSig?.(f)
    // 只在函数列表到了、或换了要补的函数时找一次
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [needSig, fn, fns, luaFns])
  const varList = (list: Prop[], lua: boolean) => (
    <VarList
      list={list}
      lua={lua}
      q={q}
      selected={varSel}
      onPick={(v) => onVar?.(v)}
      picking={!!picking}
      picked={picked ?? []}
      onTogglePick={(p) => onTogglePick?.(p)}
      pinned={pinned}
      onTogglePin={obj.ref ? onTogglePin : undefined}
    />
  )
  const k = q.trim().toLowerCase()
  const fnList = (list: FnInfo[]) => {
    const shown = k ? list.filter((f) => f.name.toLowerCase().includes(k)) : list
    let last = ''
    return shown.map((f) => {
      const head = f.owner !== last
      last = f.owner
      const Icon = f.src === 'lua' ? CodeXml : SquareFunction
      return (
        <div key={`${f.owner}.${f.name}`}>
          {head && (
            <div className="ue:px-2 ue:pt-2 ue:pb-1 ue:text-caption ue:font-medium ue:text-muted">{f.owner}</div>
          )}
          {/* 调不了的用 aria-disabled 而不是 disabled：disabled 的按钮收不到右键，「复制函数名」就用不了 */}
          <button
            type="button"
            aria-disabled={!f.callable}
            title={[f.callable ? `${f.name}${f.sig}` : f.why || t('这个函数调不了'), f.note].filter(Boolean).join('\n')}
            onClick={() => f.callable && onFn(f)}
            onContextMenu={(e) =>
              openMenu(e, [
                { label: t('调这个函数'), icon: Play, disabled: !f.callable, onClick: () => onFn(f) },
                'sep',
                { label: t('复制函数名'), icon: Copy, onClick: () => copyText(f.name) },
                f.sig && { label: t('复制签名'), icon: Copy, onClick: () => copyText(`${f.name}${f.sig}`) },
              ])
            }
            className={cn(
              'ue:flex ue:w-full ue:items-center ue:gap-2 ue:rounded-md ue:px-2 ue:py-1.5 ue:text-left ue:text-footnote',
              !f.callable ? 'ue:cursor-default ue:opacity-45' : 'ue:cursor-pointer',
              fn === f.name ? 'ue:bg-sel' : f.callable && 'ue:hover:bg-hover',
            )}
          >
            <Icon className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
            <span className="ue:font-mono ue:text-fg">{f.name}</span>
            <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-caption ue:text-subtle">{f.sig}</span>
          </button>
        </div>
      )
    })
  }
  const note = (s: string) => <p className="ue:p-3 ue:text-footnote ue:text-subtle">{s}</p>
  // 按类的对象离线也从源码列（fromSource），只有按来源（@pawn 之类）的才真的列不出
  const offline =
    !live && !byClass ? note(t('UE 没连上：连上编辑器才列得出这个对象的成员，值要游戏在跑才读得到')) : null
  const srcBanner =
    fromSource && !game ? (
      <p className="ue:mx-1 ue:my-1 ue:rounded-(--c-row-radius) ue:bg-hover ue:px-2 ue:py-1.5 ue:text-caption ue:text-muted">
        {!live
          ? t(
              'UE 没连上：成员是从源码读的（Lua 文件、项目 C++ 头文件），能先看、先填参数；调用和改值要连上编辑器，读值要游戏在跑',
            )
          : t('游戏没在运行：Lua 成员是从源码读的，能先看、先填参数；调用和改值要开 PIE')}
        {vars.data?.note ? <span className="ue:mt-0.5 ue:block">{vars.data.note}</span> : null}
      </p>
    ) : null
  const defaults =
    live && byClass && (tab === 'props' || tab === 'states') ? (
      <p className="ue:mx-1 ue:my-1 ue:rounded-(--c-row-radius) ue:bg-hover ue:px-2 ue:py-1.5 ue:text-caption ue:text-muted">
        {tab === 'props'
          ? t('游戏没在运行：这里是类的默认值，开 PIE 后读命中实例此刻的值')
          : t('游戏没在运行：运行状态要开 PIE 后才有')}
      </p>
    ) : null
  const all: MemberTab[] = tabs ?? ['fns', 'props', 'luaFns', 'luaVars', 'states']
  const count: Record<MemberTab, number> = {
    fns: fns.length,
    props: propList.length,
    luaFns: luaFns.length,
    luaVars: luaVars.length,
    states: stateList.length,
  }
  const inGroup = (g: MemberGroup) => all.filter((x) => groupOf(x) === g)
  const group = groupOf(tab)
  // 切回某页时回到上次在这页看的那一栏；没看过时先给有东西的那栏（纯 Lua 类常常只有变量）
  const [lastSub, setLastSub] = useState<Partial<Record<MemberGroup, MemberTab>>>({})
  const lastOfGroup = lastSub[group]
  if (lastOfGroup !== tab) setLastSub((m) => ({ ...m, [group]: tab }))
  const openGroup = (g: MemberGroup) => {
    const subs = inGroup(g)
    const remembered = lastSub[g]
    onTab(remembered && subs.includes(remembered) ? remembered : (subs.find((x) => count[x] > 0) ?? subs[0]))
  }
  const groupLabel: Record<MemberGroup, string> = {
    ue: `UE ${count.fns + count.props}`,
    lua: `Lua ${count.luaFns + count.luaVars}`,
    states: t('运行状态 {n}', { n: count.states }),
  }
  const subLabel: Record<MemberTab, string> = {
    fns: t('函数 {n}', { n: count.fns }),
    props: t('属性 {n}', { n: count.props }),
    luaFns: t('函数 {n}', { n: count.luaFns }),
    luaVars: t('变量 {n}', { n: count.luaVars }),
    states: '',
  }
  const subs = inGroup(group)
  const placeholder: Record<MemberTab, string> = {
    fns: t('搜函数'),
    props: t('搜属性'),
    luaFns: t('搜函数'),
    luaVars: t('搜变量'),
    states: '',
  }
  const luaEmpty = !luaFns.length && !luaVars.length
  const luaNone = offline ?? note(vars.loading ? t('读取中…') : t('这个对象没绑 Lua，或 Lua 文件里没有声明'))
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:flex-col ue:gap-2 ue:border-b ue:border-line ue:p-2">
        <ui.Segmented
          size="sm"
          label={t('UE / Lua / 运行状态')}
          value={group}
          onChange={openGroup}
          options={(['ue', 'lua', 'states'] as const)
            .filter((g) => inGroup(g).length > 0)
            .map((g) => ({ id: g, label: groupLabel[g] }))}
        />
        {tab !== 'states' && (
          <div className="ue:flex ue:items-center ue:gap-2">
            {/* UE 和 Lua 页里各分函数和变量两栏，各占满整栏高度（用户 2026-11-23：以前混在一个列表里，变量被挤到底部） */}
            {subs.length > 1 && (
              <ui.Segmented
                size="sm"
                label={group === 'ue' ? t('函数 / 属性') : t('函数 / 变量')}
                value={tab}
                onChange={onTab}
                options={subs.map((x) => ({ id: x, label: subLabel[x] }))}
              />
            )}
            <div className="ue:min-w-0 ue:flex-1">
              <ui.Input
                size="sm"
                placeholder={placeholder[tab]}
                value={q}
                onChange={(e: { target: { value: string } }) => setQ(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:overflow-y-auto ue:p-1">
        {defaults}
        {srcBanner}
        {(vars.error || props.error) && (
          <p className="ue:p-2 ue:text-footnote ue:text-danger">{vars.error || props.error}</p>
        )}
        {tab === 'fns' &&
          (offline ??
            (fns.length
              ? fnList(fns)
              : note(
                  vars.loading
                    ? t('读取中…')
                    : fromSource && luaFns.length
                      ? t('这是 Lua 类：函数在「Lua」页')
                      : t('没有能调的函数'),
                )))}
        {tab === 'luaFns' &&
          (luaFns.length ? fnList(luaFns) : luaEmpty ? luaNone : note(t('Lua 文件里没有函数，变量在「变量」栏')))}
        {/* 游戏开着时用 gt.props 读到的实例上的值；读不到时退回 Lua 文件里声明的字段 */}
        {tab === 'luaVars' &&
          (luaVars.length
            ? varList(
                luaVars.map((p) => ({ ...p, category: undefined })),
                true,
              )
            : luaEmpty
              ? luaNone
              : note(t('Lua 文件里没有声明变量')))}
        {(tab === 'props' || tab === 'states') &&
          (obj.src
            ? note(t('来源对象只列方法；属性在 GameTest 的选对象面板里看'))
            : (offline ??
              (srcOnly && tab === 'states'
                ? note(t('运行状态要游戏在跑才有'))
                : (tab === 'props' ? propList : stateList).length
                  ? varList(tab === 'props' ? propList : stateList, false)
                  : note(props.loading || vars.loading ? t('读取中…') : t('没有属性')))))}
      </div>
    </div>
  )
}
