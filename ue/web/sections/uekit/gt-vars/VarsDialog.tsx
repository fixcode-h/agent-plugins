import { AppWindow, Cpu, FileCode2, Info, Terminal, User } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { CondNode } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { useSearchIndex } from '../../../jump/index-data.ts'
import { SearchBox } from '@panel/web/src/components/ui/search-box'
import { CompareEdit } from '../gt-cond/compare.tsx'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { matchWidgets } from '../gt-widget-match.ts'
import { FieldGroups, itemKey } from './FieldGroups.tsx'
import { useVars, type VarGroup, type VarItem, type VarScope } from './model.ts'

const PLAYERS = ['pawn', 'pc', 'ps', 'gs', 'gi', 'gm', 'hud'] as const
const playerLabel = (w: (typeof PLAYERS)[number]) =>
  ({
    pawn: t('玩家角色'),
    pc: 'PlayerController',
    ps: 'PlayerState',
    gs: 'GameState',
    gi: 'GameInstance',
    gm: t('GameMode（服务器 / 单机）'),
    hud: 'HUD',
  })[w]

/** 挑中的字段 → 一条判断（协议 4.1）：界面上的是「对象的属性」（obj + v5 属性路径），其余是 value + 来源路径 */
export function checkOf(scope: VarScope, g: VarGroup, it: VarItem): CondNode {
  const call = it.kind === 'fn' ? '()' : ''
  const strip = (p: string) => p.replace(/^(self|[A-Z]\w*)\./, '')
  const v = it.value
  const simple = typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string'
  if (scope.scope === 'widget') {
    // v5 路径：Lua 字段 @#x，属性 @.X，无参方法 @.X()
    const prop = g.src === 'lua' ? `@#${strip(it.path)}` : `@.${it.path}${call}`
    const c: CondNode = { obj: { class: scope.class }, prop }
    // 有此刻的值时默认「等于此刻的值」，改起来最快；没有值时按真值算
    if (simple) Object.assign(c, typeof v === 'boolean' ? { op: 'is', value: v } : { op: 'eq', value: v })
    else Object.assign(c, { op: 'is', value: true })
    return c
  }
  let c: CondNode
  if (scope.scope === 'player') c = { value: `@${scope.which}.${it.path}${call}` }
  else if (scope.scope === 'subsystem') c = { value: `@sub.${g.class ?? scope.name ?? ''}.${it.path}${call}` }
  else if (scope.scope === 'lua') c = { value: `@luaMod.${scope.module}.${strip(it.path)}` }
  else c = { value: it.path }
  if (simple) c.equals = v
  return c
}

/**
 * 从代码选变量（定稿 9.5、效果图 4）：左边分类树（界面、游戏对象、子系统、Lua 模块、控制台变量），
 * 右边按 C++ / 蓝图 / Lua 分组的字段表；挑一个字段，下面拼好比较，「用这个」加进条件组。
 * C++ 和蓝图要编辑器开着（反射）；Lua 组面板扫文件，游戏没开也有
 */
export function VarsDialog({ onClose, onPick }: { onClose: () => void; onPick: (c: CondNode) => void }) {
  const { ui, cn } = h()
  const ctx = useEditCtx()
  const index = useSearchIndex(ctx.project)
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<VarScope>()
  const [luaMod, setLuaMod] = useState('')
  const [cvar, setCvar] = useState('')
  const [pick, setPick] = useState<{ key: string; cond: CondNode }>()
  const vars = useVars(ctx.project, scope, ctx.live)
  const widgets = useMemo(() => matchWidgets(index.idx, q, 60).rows, [index.idx, q])

  const node = (key: string, label: ReactNode, s: VarScope, icon: ReactNode) => {
    const on = JSON.stringify(scope) === JSON.stringify(s)
    return (
      <button
        key={key}
        type="button"
        onClick={() => {
          setScope(s)
          setPick(undefined)
        }}
        className={cn(
          'ue:flex ue:h-7 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-(--c-row-radius) ue:px-2 ue:text-left ue:text-footnote ue:hover:bg-hover',
          on && 'ue:bg-sel',
        )}
      >
        {icon}
        <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-fg">{label}</span>
      </button>
    )
  }
  const head = (text: string) => <p className="ue:px-2 ue:pt-3 ue:pb-1 ue:text-caption ue:text-subtle">{text}</p>
  const icon = (I: typeof AppWindow) => <I className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />

  return (
    <ui.Modal
      open
      size="xl"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('选一个变量当条件')}
      description={t('从 C++、蓝图和 Lua 里列出来：游戏没开也能选，开着时显示此刻的值。只读字段和不带参数的只读函数。')}
      footer={
        <>
          <span className="ue:mr-auto ue:flex ue:items-center ue:gap-1 ue:text-footnote ue:text-subtle">
            <Info className="ue:h-3.5 ue:w-3.5" />
            {t('C++ 和蓝图在编辑器里按反射读；Lua 从项目的 Lua 文件里扫 self.xxx = 和 ---@field')}
          </span>
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          <ui.Button disabled={!pick} onClick={() => pick && onPick(pick.cond)}>
            {t('用这个')}
          </ui.Button>
        </>
      }
    >
      <div className="ue:flex ue:h-[60vh] ue:min-h-0 ue:gap-0 ue:overflow-hidden ue:rounded-(--c-row-radius) ue:border ue:border-line">
        <div className="ue:flex ue:w-64 ue:shrink-0 ue:flex-col ue:border-r ue:border-line">
          <div className="ue:p-2">
            <SearchBox live onSearch={setQ} placeholder={t('搜界面名')} />
          </div>
          <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:px-1 ue:pb-2">
            {head(t('界面'))}
            {widgets.map((w) => node(`w:${w.pkg}`, w.name, { scope: 'widget', class: w.value }, icon(AppWindow)))}
            {!widgets.length && (
              <p className="ue:px-2 ue:text-caption ue:text-subtle">
                {index.idx ? t('没有匹配的界面') : t('正在读资源索引…')}
              </p>
            )}
            {head(t('游戏对象'))}
            {PLAYERS.map((w) => node(`p:${w}`, playerLabel(w), { scope: 'player', which: w }, icon(User)))}
            {head(t('子系统'))}
            {node('sub', t('全部子系统'), { scope: 'subsystem' }, icon(Cpu))}
            {head(t('Lua 模块'))}
            <div className="ue:flex ue:gap-1 ue:px-1">
              <ui.Input
                size="sm"
                className="ue:min-w-0 ue:flex-1 ue:font-mono"
                placeholder={t('require 路径')}
                value={luaMod}
                onChange={(e: { target: { value: string } }) => setLuaMod(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent) =>
                  e.key === 'Enter' && luaMod.trim() && setScope({ scope: 'lua', module: luaMod.trim() })
                }
              />
            </div>
            {head(t('控制台变量'))}
            <div className="ue:flex ue:gap-1 ue:px-1">
              <ui.Input
                size="sm"
                className="ue:min-w-0 ue:flex-1 ue:font-mono"
                placeholder="t.MaxFPS"
                value={cvar}
                onChange={(e: { target: { value: string } }) => {
                  setCvar(e.target.value)
                  setPick(
                    e.target.value.trim()
                      ? { key: 'cvar', cond: { value: `@cvar.${e.target.value.trim()}` } }
                      : undefined,
                  )
                }}
              />
              {icon(Terminal)}
            </div>
          </div>
        </div>
        <div className="ue:flex ue:min-w-0 ue:flex-1 ue:flex-col">
          {!scope && (
            <div className="ue:flex ue:flex-1 ue:flex-col ue:items-center ue:justify-center ue:gap-2 ue:text-footnote ue:text-subtle">
              <FileCode2 className="ue:h-6 ue:w-6" />
              {t('在左边挑一个界面、游戏对象、子系统或 Lua 模块')}
            </div>
          )}
          {scope && (
            <>
              {(vars.error || (!ctx.live && scope.scope !== 'lua')) && (
                <p className="ue:border-b ue:border-line ue:px-3 ue:py-1.5 ue:text-caption ue:text-warning">
                  {vars.error || t('编辑器没开：只列得出 Lua 文件里扫到的字段；C++ 和蓝图要编辑器开着按反射读')}
                </p>
              )}
              {vars.loading && !vars.data ? (
                <p className="ue:p-4 ue:text-footnote ue:text-subtle">{t('正在读…')}</p>
              ) : (
                <FieldGroups
                  groups={vars.data?.groups ?? []}
                  showValue
                  selected={new Set(pick ? [pick.key] : [])}
                  onToggle={(g, it) => setPick({ key: itemKey(g, it), cond: checkOf(scope, g, it) })}
                />
              )}
            </>
          )}
          {pick && (
            <div className="ue:flex ue:flex-col ue:gap-1.5 ue:border-t ue:border-line ue:p-3">
              <div className="ue:flex ue:items-center ue:gap-2">
                <span className="ue:shrink-0 ue:text-footnote ue:text-subtle">{t('条件')}</span>
                <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-footnote ue:text-fg">
                  {String(pick.cond.field ?? pick.cond.value ?? '')}
                </span>
              </div>
              <CompareEdit value={pick.cond} onChange={(c) => setPick({ ...pick, cond: c })} />
              <code className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">
                {JSON.stringify(pick.cond)}
              </code>
            </div>
          )}
        </div>
      </div>
    </ui.Modal>
  )
}
