import { CodeXml, Copy, Play, SquareFunction } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { GmObject } from '../../../../shared/gm/schema.ts'
import type { Prop } from '../../../details/model.ts'
import { h, t } from '../../../host.ts'
import { copyText, openMenu } from '../../../menu.tsx'
import { useProps } from '../../uekit/gt-ref/live.ts'
import { useVars } from '../../uekit/gt-vars/model.ts'
import { fnsOf, propsOf, scopeOf, type FnInfo } from './members.ts'
import { VarList, type VarSel } from './VarList.tsx'

export type MemberTab = 'fns' | 'props' | 'lua' | 'states'

/**
 * 对象调用中栏（规格第 7 节、效果图 2）：方法 · 属性 · Lua · 运行状态。方法按声明类分组，名字 + 签名，
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
  picking,
  picked,
  onTogglePick,
  varSel,
  onVar,
  rev = 0,
}: {
  project: string
  obj: GmObject
  live: boolean
  tab: MemberTab
  onTab: (t: MemberTab) => void
  fn?: string
  onFn: (f: FnInfo) => void
  /** 正在「取对象」：属性行尾出 ＋ / × */
  picking: boolean
  picked: string[]
  onTogglePick: (prop: string) => void
  /** 选中的变量（属性路径）：右栏「改变量」 */
  varSel?: string
  onVar: (v: VarSel) => void
  /** 改完变量加一：重读属性 */
  rev?: number
}) {
  const { ui, cn } = h()
  const [q, setQ] = useState('')
  const vars = useVars(project, scopeOf(obj), live)
  const props = useProps(project, obj.ref && live ? { target: { obj: obj.ref as { class: string } } } : undefined, rev)
  const groups = vars.data?.groups ?? []
  const fns = useMemo(() => fnsOf(groups.filter((g) => g.src !== 'lua')), [groups])
  const luaFns = useMemo(() => fnsOf(groups.filter((g) => g.src === 'lua')), [groups])
  const luaFields = groups.filter((g) => g.src === 'lua').flatMap((g) => g.items.filter((i) => i.kind === 'prop'))
  const propList = useMemo(() => propsOf(props.data, 'props'), [props.data])
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
        readOnly: !obj.ref || !!f.readOnly,
        readOnlyWhy: !obj.ref ? t('来源对象不能直接改字段') : undefined,
        edit: true,
      })),
    [luaFields, obj.ref],
  )
  const luaVars = luaProps.length ? luaProps : luaDecl
  const varList = (list: Prop[], lua: boolean) => (
    <VarList
      list={list}
      lua={lua}
      q={q}
      selected={varSel}
      onPick={onVar}
      picking={picking}
      picked={picked}
      onTogglePick={onTogglePick}
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
            title={f.callable ? f.sig : f.why || t('这个函数调不了')}
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
  const section = (label: string) => (
    <div className="ue:mt-1 ue:border-b ue:border-line/60 ue:px-2 ue:pt-2 ue:pb-1 ue:text-caption ue:font-semibold ue:tracking-wide ue:text-fg">
      {label}
    </div>
  )
  const note = (s: string) => <p className="ue:p-3 ue:text-footnote ue:text-subtle">{s}</p>
  const offline = !live ? note(t('游戏没在运行：连上编辑器、开着 PIE 才列得出这个对象的成员')) : null
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:flex-col ue:gap-2 ue:border-b ue:border-line ue:p-2">
        <ui.Segmented
          size="sm"
          label={t('方法 / 属性 / Lua / 运行状态')}
          value={tab}
          onChange={onTab}
          options={[
            { id: 'fns' as const, label: t('方法 {n}', { n: fns.length }) },
            { id: 'props' as const, label: t('属性 {n}', { n: propList.length }) },
            { id: 'lua' as const, label: `Lua ${luaFns.length + luaVars.length}` },
            { id: 'states' as const, label: t('运行状态 {n}', { n: stateList.length }) },
          ]}
        />
        {tab !== 'states' && (
          <ui.Input
            size="sm"
            placeholder={tab === 'fns' ? t('搜函数') : tab === 'props' ? t('搜属性') : t('搜函数和变量')}
            value={q}
            onChange={(e: { target: { value: string } }) => setQ(e.target.value)}
          />
        )}
      </div>
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:overflow-y-auto ue:p-1">
        {(vars.error || props.error) && (
          <p className="ue:p-2 ue:text-footnote ue:text-danger">{vars.error || props.error}</p>
        )}
        {tab === 'fns' &&
          (offline ?? (fns.length ? fnList(fns) : note(vars.loading ? t('读取中…') : t('没有能调的函数'))))}
        {tab === 'lua' && (
          // 函数和变量分成两组（用户 2026-11-22：以前混在一个列表里），搜索两组都筛
          <>
            {luaFns.length > 0 && section(t('函数 {n}', { n: luaFns.length }))}
            {fnList(luaFns)}
            {/* 游戏开着时用 gt.props 读到的实例上的值；读不到时退回 Lua 文件里声明的字段 */}
            {luaVars.length > 0 && (
              <>
                {section(t('变量 {n}', { n: luaVars.length }))}
                {varList(
                  luaVars.map((p) => ({ ...p, category: undefined })),
                  true,
                )}
              </>
            )}
            {!luaFns.length && !luaVars.length && note(t('这个对象没绑 Lua，或 Lua 文件里没有声明'))}
          </>
        )}
        {(tab === 'props' || tab === 'states') &&
          (obj.src
            ? note(t('来源对象只列方法；属性在 GameTest 的选对象面板里看'))
            : (offline ??
              ((tab === 'props' ? propList : stateList).length
                ? varList(tab === 'props' ? propList : stateList, false)
                : note(props.loading ? t('读取中…') : t('没有属性')))))}
      </div>
    </div>
  )
}
