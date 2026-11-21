import {
  Copy,
  Crosshair,
  Pencil,
  Play,
  Plus,
  ScanSearch,
  Star,
  StarOff,
  Trash2,
  User,
  Cpu,
  CodeXml,
} from 'lucide-react'
import type { MouseEvent } from 'react'
import type { GmObject } from '../../../../shared/gm/schema.ts'
import { h, t } from '../../../host.ts'
import { openMenu, openMenuAt, type MenuItem } from '../../../menu.tsx'
import type { RefHits } from '../../uekit/gt-ref/live.ts'
import { AgentBadge, HitBadge, ObjRule } from '../custom/ObjRule.tsx'

/**
 * 对象调用的左栏（规格第 7 节、效果图 2）：对象列表，名字 + 匹配规则小块 + 命中个数（1 绿 / 多黄 / 0 灰，命中数走 gt.watch 推送）。
 * 「加对象」打开选对象面板；「加来源」加玩家、子系统、Lua 模块；对象右键调函数、取对象、改匹配规则、重命名、复制、删除、收藏；
 * 空白处右键也能加对象、加来源（列表空着的时候最常用）
 */
export function ObjList({
  objects,
  q,
  hits,
  live,
  selected,
  onPick,
  onAdd,
  onAddSource,
  onCall,
  onEdit,
  onRename,
  onCopy,
  onDelete,
  isFav,
  onFav,
}: {
  objects: GmObject[]
  q: string
  hits: Record<string, RefHits | undefined>
  live: boolean
  selected: string
  onPick: (name: string) => void
  onAdd: () => void
  onAddSource: (kind: 'pawn' | 'sub' | 'luaMod') => void
  onCall: (name: string, mode: 'call' | 'get') => void
  onEdit: (o: GmObject) => void
  onRename: (o: GmObject) => void
  onCopy: (o: GmObject) => void
  onDelete: (o: GmObject) => void
  isFav: (name: string) => boolean
  onFav: (name: string) => void
}) {
  const { ui, cn } = h()
  const k = q.trim().toLowerCase()
  const shown = k
    ? objects.filter((o) => `${o.name} ${o.ref?.class ?? ''} ${o.src ?? ''}`.toLowerCase().includes(k))
    : objects
  const sources: MenuItem[] = [
    { label: t('玩家'), icon: User, hint: '@pawn', onClick: () => onAddSource('pawn') },
    { label: t('子系统…'), icon: Cpu, hint: '@sub.X', onClick: () => onAddSource('sub') },
    { label: t('Lua 模块…'), icon: CodeXml, hint: '@luaMod.X', onClick: () => onAddSource('luaMod') },
  ]
  // 空白处：菜单没有二级，「加来源」写成小标题、下面三项
  const blankMenu = (e: MouseEvent) =>
    openMenu(e, [{ label: t('加对象…'), icon: Plus, onClick: onAdd }, 'sep', { title: t('加来源') }, ...sources])
  const menu = (e: MouseEvent, o: GmObject) =>
    openMenu(e, [
      { label: t('调函数'), icon: Play, onClick: () => onCall(o.name, 'call') },
      { label: t('取对象'), icon: ScanSearch, onClick: () => onCall(o.name, 'get') },
      'sep',
      o.ref && { label: t('改匹配规则…'), icon: Crosshair, onClick: () => onEdit(o) },
      { label: t('重命名'), icon: Pencil, onClick: () => onRename(o) },
      { label: t('复制'), icon: Copy, onClick: () => onCopy(o) },
      {
        label: isFav(o.name) ? t('取消收藏') : t('收藏'),
        icon: isFav(o.name) ? StarOff : Star,
        onClick: () => onFav(o.name),
      },
      'sep',
      { label: t('删除'), icon: Trash2, danger: true, onClick: () => onDelete(o) },
    ])
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-1 ue:p-2">
      <div className="ue:flex ue:items-center ue:gap-1 ue:px-1">
        <span className="ue:text-caption ue:font-medium ue:text-muted">{t('对象列表 {n}', { n: objects.length })}</span>
        <ui.Button size="sm" variant="ghost" className="ue:ml-auto" onClick={onAdd}>
          <Plus className="ue:h-3.5 ue:w-3.5" />
          {t('加对象')}
        </ui.Button>
        <ui.Button
          size="sm"
          variant="ghost"
          onClick={(e: MouseEvent<HTMLElement>) => openMenuAt(e.currentTarget, sources)}
        >
          {t('加来源')}
        </ui.Button>
      </div>
      <div
        role="list"
        onContextMenu={blankMenu}
        className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-0.5 ue:overflow-y-auto"
      >
        {shown.map((o) => {
          const hit = hits[o.name]
          return (
            <div
              key={o.name}
              role="listitem"
              tabIndex={0}
              onClick={() => onPick(o.name)}
              onKeyDown={(e) => e.key === 'Enter' && onPick(o.name)}
              onContextMenu={(e) => menu(e, o)}
              className={cn(
                'ue:flex ue:cursor-pointer ue:flex-col ue:gap-1 ue:overflow-hidden ue:rounded-md ue:px-2 ue:py-1.5 ue:outline-none ue:focus-visible:bg-hover',
                o.name === selected ? 'ue:bg-sel' : 'ue:hover:bg-hover',
              )}
            >
              <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-2">
                <span className="ue:truncate ue:text-footnote ue:font-medium ue:text-fg">{o.name}</span>
                {o.by === 'agent' && <AgentBadge />}
                <span className="ue:ml-auto">
                  {o.ref && live ? <HitBadge n={hit?.count} error={hit?.error} /> : null}
                </span>
              </div>
              <span className="ue:min-w-0 ue:overflow-hidden">
                <ObjRule o={o} small />
              </span>
            </div>
          )
        })}
        {!shown.length && (
          <p className="ue:px-2 ue:py-2 ue:text-footnote ue:text-subtle">
            {k ? t('没有名字或类里含「{q}」的对象', { q }) : t('还没有对象：点「加对象」选一个')}
          </p>
        )}
      </div>
      <p className="ue:px-1 ue:text-caption ue:leading-relaxed ue:text-subtle">
        {t('「加对象」打开选对象面板定类和唯一标识。存的是匹配规则，每次用时按规则现找。')}
      </p>
    </div>
  )
}
