import { CodeXml, Copy, Play, Plus, SquareFunction, Variable, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { GmObject } from '../../../../shared/gm/schema.ts'
import { Details } from '../../../details/Details.tsx'
import type { DetailsApi } from '../../../details/rows.tsx'
import { h, t } from '../../../host.ts'
import { copyText, openMenu } from '../../../menu.tsx'
import { useProps } from '../../uekit/gt-ref/live.ts'
import { useVars } from '../../uekit/gt-vars/model.ts'
import { fnsOf, propsOf, scopeOf, type FnInfo } from './members.ts'

export type MemberTab = 'fns' | 'props' | 'lua' | 'states'

const noop = () => undefined

/**
 * 对象调用中栏（规格第 7 节、效果图 2）：方法 · 属性 · Lua · 运行状态。方法按声明类分组，名字 + 签名，
 * 调不了的（callable:false）置灰、悬停写原因；属性和运行状态用 Details 只读显示，「取对象」时行尾的 ＋ 把属性加进要读的列表
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
}) {
  const { ui, cn } = h()
  const [q, setQ] = useState('')
  const vars = useVars(project, scopeOf(obj), live)
  const props = useProps(project, obj.ref && live ? { target: { obj: obj.ref as { class: string } } } : undefined)
  const groups = vars.data?.groups ?? []
  const fns = useMemo(() => fnsOf(groups.filter((g) => g.src !== 'lua')), [groups])
  const luaFns = useMemo(() => fnsOf(groups.filter((g) => g.src === 'lua')), [groups])
  const luaFields = groups.filter((g) => g.src === 'lua').flatMap((g) => g.items.filter((i) => i.kind === 'prop'))
  const propList = useMemo(() => propsOf(props.data, false), [props.data])
  const stateList = useMemo(() => propsOf(props.data, true), [props.data])
  const api: Omit<DetailsApi, 'q'> = {
    busy: '',
    version: 0,
    changed: noop,
    isChanged: () => false,
    setValue: noop,
    arrayOp: noop,
    reset: noop,
    openRef: () => undefined,
    loadFull: async () => undefined,
    action: picking
      ? (n, depth) =>
          depth === 0 ? (
            <button
              type="button"
              title={picked.includes(n.path) ? t('不读这个属性') : t('取对象时读这个属性')}
              onClick={() => onTogglePick(n.path)}
              className="ue:grid ue:cursor-pointer ue:text-subtle ue:hover:text-accent"
            >
              {picked.includes(n.path) ? <X className="ue:h-3.5 ue:w-3.5" /> : <Plus className="ue:h-3.5 ue:w-3.5" />}
            </button>
          ) : null
      : undefined,
  }
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
            { id: 'lua' as const, label: `Lua ${luaFns.length + luaFields.length}` },
            { id: 'states' as const, label: t('运行状态 {n}', { n: stateList.length }) },
          ]}
        />
        {(tab === 'fns' || tab === 'lua') && (
          <ui.Input
            size="sm"
            placeholder={t('搜函数')}
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
          <>
            {fnList(luaFns)}
            {luaFields.map((f) => (
              <div
                key={f.path}
                onContextMenu={(e) =>
                  openMenu(e, [{ label: t('复制属性名'), icon: Copy, onClick: () => copyText(f.name) }])
                }
                className="ue:flex ue:items-center ue:gap-2 ue:px-2 ue:py-1 ue:text-footnote"
              >
                <Variable className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
                <span className="ue:font-mono ue:text-fg">{f.name}</span>
                <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-caption ue:text-subtle">
                  {f.value === undefined ? f.type : JSON.stringify(f.value)}
                </span>
              </div>
            ))}
            {!luaFns.length && !luaFields.length && note(t('这个对象没绑 Lua，或 Lua 文件里没有声明'))}
          </>
        )}
        {(tab === 'props' || tab === 'states') &&
          (obj.src
            ? note(t('来源对象只列方法；属性在 GameTest 的选对象面板里看'))
            : (offline ?? (
                <Details props={tab === 'props' ? propList : stateList} api={api} loading={props.loading} />
              )))}
      </div>
    </div>
  )
}
