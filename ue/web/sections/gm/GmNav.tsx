import { Box, Cpu, FileCode, Folder, History, Layers, ListVideo, Plus, Star } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { LuaGmScan } from '../../../server/lua-gm/types.ts'
import type { GmMacro } from '../../../server/types.ts'
import { h, t } from '../../host.ts'
import { fmtTime } from '../../ui.tsx'

/** 左栏选中的是哪一项：收藏、最近、来源、分组（groupKey 之后的名字）、宏 */
export type GmView =
  | { kind: 'fav' | 'recent' | 'all' | 'lua' | 'cpp' | 'engine' }
  | { kind: 'group'; id: string; label: string }
  | { kind: 'macro'; id: string }

export const sameView = (a: GmView, b: GmView) =>
  a.kind === b.kind && ('id' in a ? a.id : '') === ('id' in b ? b.id : '')

/**
 * GM 页左栏（效果图 1）：收藏、最近执行；来源（Lua / 项目 C++ / 引擎自带，引擎的默认淡显）；分组（同名合并）；宏；
 * 底部是 Lua GM 的扫描状态和「重新扫描」「让 AI 改扫描脚本」
 */
export function GmNav({
  view,
  onView,
  counts,
  groups,
  macros,
  onNewMacro,
  scan,
  scanning,
  onRescan,
  onFixScript,
  onSetup,
}: {
  view: GmView
  onView: (v: GmView) => void
  counts: Record<'fav' | 'recent' | 'all' | 'lua' | 'cpp' | 'engine', number>
  groups: { id: string; label: string; n: number }[]
  macros: GmMacro[]
  onNewMacro: () => void
  scan?: LuaGmScan
  scanning: boolean
  onRescan: () => void
  onFixScript: () => void
  onSetup: () => void
}) {
  const { cn } = h()
  const row = (v: GmView, icon: LucideIcon, label: ReactNode, n: ReactNode, dim = false) => {
    const Icon = icon
    const on = sameView(view, v)
    return (
      <button
        key={`${v.kind}:${'id' in v ? v.id : ''}`}
        type="button"
        onClick={() => onView(v)}
        className={cn(
          'ue:flex ue:h-8 ue:w-full ue:shrink-0 ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-lg ue:px-2.5 ue:text-body',
          on ? 'ue:bg-active ue:text-fg' : 'ue:text-muted ue:hover:bg-hover',
          dim && !on && 'ue:opacity-60',
        )}
      >
        <Icon className="ue:h-3.5 ue:w-3.5 ue:shrink-0" />
        <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-left">{label}</span>
        <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{n}</span>
      </button>
    )
  }
  const head = (label: string, aside?: ReactNode) => (
    <div className="ue:mt-3 ue:flex ue:items-center ue:px-2.5 ue:pb-1 ue:text-caption ue:text-subtle">
      {label}
      {aside && <span className="ue:ml-auto">{aside}</span>}
    </div>
  )
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-0.5 ue:overflow-auto ue:p-2">
        {row({ kind: 'fav' }, Star, t('收藏'), counts.fav)}
        {row({ kind: 'recent' }, History, t('最近执行'), counts.recent)}
        {head(t('来源'))}
        {row({ kind: 'all' }, Layers, t('全部'), counts.all)}
        {row({ kind: 'lua' }, FileCode, 'Lua', counts.lua)}
        {row({ kind: 'cpp' }, Cpu, t('C++（项目）'), counts.cpp)}
        {row({ kind: 'engine' }, Box, t('引擎自带'), counts.engine, true)}
        {groups.length > 0 && head(t('分组'), t('同名合并'))}
        {groups.map((g) => row({ kind: 'group', id: g.id, label: g.label }, Folder, g.label, g.n))}
        {head(
          t('宏'),
          <button
            type="button"
            title={t('新建宏')}
            onClick={onNewMacro}
            className="ue:grid ue:cursor-pointer ue:hover:text-fg"
          >
            <Plus className="ue:h-3.5 ue:w-3.5" />
          </button>,
        )}
        {macros.map((m) => row({ kind: 'macro', id: m.id }, ListVideo, m.name, t('{n} 步', { n: m.steps.length })))}
        {!macros.length && (
          <p className="ue:px-2.5 ue:text-caption ue:text-subtle">{t('点 + 新建，把几条 GM 串起来一键执行')}</p>
        )}
      </div>
      <LuaStatus scan={scan} scanning={scanning} onRescan={onRescan} onFixScript={onFixScript} onSetup={onSetup} />
    </div>
  )
}

function LuaStatus({
  scan,
  scanning,
  onRescan,
  onFixScript,
  onSetup,
}: {
  scan?: LuaGmScan
  scanning: boolean
  onRescan: () => void
  onFixScript: () => void
  onSetup: () => void
}) {
  const { cn } = h()
  const link = 'ue:cursor-pointer ue:text-accent-text ue:hover:underline ue:disabled:opacity-50'
  if (!scan) return null
  const ready = scan.hasScript && scan.files.length > 0
  return (
    <div className="ue:flex ue:shrink-0 ue:flex-col ue:gap-1 ue:border-t ue:border-line ue:px-3 ue:py-2.5 ue:text-caption ue:text-subtle">
      {ready ? (
        <>
          <span className="ue:flex ue:items-center ue:gap-1.5">
            <span className={cn('ue:h-1.5 ue:w-1.5 ue:rounded-full', scan.error ? 'ue:bg-danger' : 'ue:bg-success')} />
            {t('Lua GM · {f} 个文件 · {n} 条', { f: scan.files.length, n: scan.items.length })}
          </span>
          {scan.error ? (
            <span className="ue:line-clamp-3 ue:text-danger" title={scan.error}>
              {scan.error}
            </span>
          ) : (
            <span>
              {t('{at} 扫描 · {ms} 秒 · 文件变了自动重扫', {
                at: fmtTime(scan.scannedAt),
                ms: (scan.ms / 1000).toFixed(1),
              })}
            </span>
          )}
          {scan.warnings.length > 0 && (
            <span className="ue:text-warning" title={scan.warnings.join('\n')}>
              {t('{n} 条没认出来（悬停看原因）', { n: scan.warnings.length })}
            </span>
          )}
          <span className="ue:flex ue:gap-3">
            <button type="button" className={link} disabled={scanning} onClick={onRescan}>
              {scanning ? t('正在扫描…') : t('重新扫描')}
            </button>
            <button type="button" className={link} onClick={onFixScript}>
              {t('让 AI 改扫描脚本')}
            </button>
          </span>
        </>
      ) : (
        <>
          <span>{scan.error || t('还没设置 Lua GM：选好 GM 文件，让 AI 写一个扫描脚本，以后自动列出')}</span>
          <button type="button" className={cn(link, 'ue:self-start')} onClick={onSetup}>
            {t('Lua GM 扫描设置')}
          </button>
        </>
      )}
    </div>
  )
}
