import {
  Copy,
  Crosshair,
  FolderInput,
  FolderPlus,
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
import { useState, type MouseEvent } from 'react'
import type { GmObject } from '../../../../shared/gm/schema.ts'
import { h, t } from '../../../host.ts'
import { openMenu, openMenuAt, type MenuItem } from '../../../menu.tsx'
import type { RefHits } from '../../uekit/gt-ref/live.ts'
import { FileTree, type TreeLeaf } from '../../uekit/tree.tsx'
import type { DragSrc } from '../../uekit/tree-dnd.ts'
import { AgentBadge, HitBadge, ObjRule, iconOf } from '../custom/ObjRule.tsx'

type SrcKind = 'pawn' | 'sub' | 'luaMod'

/** 名字里的 / 会被树当成分层：显示时换成长得一样的除号斜杠 */
const seg = (n: string) => n.replaceAll('/', '∕')
const pathOf = (o: GmObject) => (o.folder ? `${o.folder}/${seg(o.name)}` : seg(o.name))

/**
 * 对象调用的左栏（规格第 7 节、效果图 2）：对象列表按文件夹排成树（和 GameTest 场景库同一棵 FileTree），
 * 每个对象一行名字 + 命中个数（1 绿 / 多黄 / 0 灰，走 gt.watch 推送），下面一行匹配规则。
 * 用户 2026-11-22：能建文件夹、整块右键菜单、新增对象必须选文件夹；对象和文件夹都能拖进别的文件夹。
 * 右键对象：调函数、取对象、改匹配规则、重命名、复制、移到文件夹、收藏、删除；右键文件夹：在这里加对象 / 来源、
 * 新建子文件夹、重命名、删除；空白处：加对象、新建文件夹、加来源
 */
export function ObjList({
  objects,
  folders,
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
  onMoveTo,
  onDelete,
  onNewFolder,
  onRenameFolder,
  onDeleteFolder,
  onMove,
  isFav,
  onFav,
}: {
  objects: GmObject[]
  folders: string[]
  q: string
  hits: Record<string, RefHits | undefined>
  live: boolean
  selected: string
  onPick: (name: string) => void
  /** folder：默认放进哪个文件夹 */
  onAdd: (folder?: string) => void
  onAddSource: (kind: SrcKind, folder?: string) => void
  onCall: (name: string, mode: 'call' | 'get') => void
  onEdit: (o: GmObject) => void
  onRename: (o: GmObject) => void
  onCopy: (o: GmObject) => void
  onMoveTo: (o: GmObject) => void
  onDelete: (o: GmObject) => void
  /** 在 parent 下新建文件夹（'' 是最外层） */
  onNewFolder: (parent: string) => void
  onRenameFolder: (path: string) => void
  onDeleteFolder: (path: string, objects: GmObject[]) => void
  onMove: (src: DragSrc<GmObject>, toDir: string) => void
  isFav: (name: string) => boolean
  onFav: (name: string) => void
}) {
  const { ui } = h()
  // 点过的文件夹：「加对象」默认放进它；没点过时用选中对象所在的文件夹
  const [activeFolder, setActiveFolder] = useState<string>()
  const k = q.trim().toLowerCase()
  const shown = k
    ? objects.filter((o) => `${o.name} ${o.ref?.class ?? ''} ${o.src ?? ''}`.toLowerCase().includes(k))
    : objects
  const items: TreeLeaf<GmObject>[] = shown.map((o) => ({ path: pathOf(o), data: o }))
  const sel = objects.find((o) => o.name === selected)
  const here = activeFolder ?? sel?.folder
  const sources = (folder?: string): MenuItem[] => [
    { label: t('玩家'), icon: User, hint: '@pawn', onClick: () => onAddSource('pawn', folder) },
    { label: t('子系统…'), icon: Cpu, hint: '@sub.X', onClick: () => onAddSource('sub', folder) },
    { label: t('Lua 模块…'), icon: CodeXml, hint: '@luaMod.X', onClick: () => onAddSource('luaMod', folder) },
  ]
  // 菜单没有二级：「加来源」写成小标题、下面三项
  const blankMenu = (e: MouseEvent) =>
    openMenu(e, [
      { label: t('加对象…'), icon: Plus, onClick: () => onAdd(here) },
      { label: t('新建文件夹…'), icon: FolderPlus, onClick: () => onNewFolder('') },
      'sep',
      { title: t('加来源') },
      ...sources(here),
    ])
  const folderMenu = (e: MouseEvent, path: string, leaves: GmObject[]) => {
    e.stopPropagation()
    setActiveFolder(path)
    openMenu(e, [
      { label: t('在这里加对象…'), icon: Plus, onClick: () => onAdd(path) },
      { label: t('新建子文件夹…'), icon: FolderPlus, onClick: () => onNewFolder(path) },
      'sep',
      { title: t('在这里加来源') },
      ...sources(path),
      'sep',
      { label: t('重命名'), icon: Pencil, onClick: () => onRenameFolder(path) },
      { label: t('删除'), icon: Trash2, danger: true, onClick: () => onDeleteFolder(path, leaves) },
    ])
  }
  const menu = (e: MouseEvent, o: GmObject) => {
    e.stopPropagation()
    openMenu(e, [
      { label: t('调函数'), icon: Play, onClick: () => onCall(o.name, 'call') },
      { label: t('取对象'), icon: ScanSearch, onClick: () => onCall(o.name, 'get') },
      'sep',
      o.ref && { label: t('改匹配规则…'), icon: Crosshair, onClick: () => onEdit(o) },
      { label: t('重命名'), icon: Pencil, onClick: () => onRename(o) },
      { label: t('复制'), icon: Copy, onClick: () => onCopy(o) },
      { label: t('移到文件夹…'), icon: FolderInput, onClick: () => onMoveTo(o) },
      {
        label: isFav(o.name) ? t('取消收藏') : t('收藏'),
        icon: isFav(o.name) ? StarOff : Star,
        onClick: () => onFav(o.name),
      },
      'sep',
      { label: t('删除'), icon: Trash2, danger: true, onClick: () => onDelete(o) },
    ])
  }
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-1 ue:p-2">
      <div className="ue:flex ue:items-center ue:gap-1 ue:px-1">
        <span className="ue:text-caption ue:font-medium ue:text-muted">{t('对象列表 {n}', { n: objects.length })}</span>
        <ui.Button size="sm" variant="ghost" className="ue:ml-auto" onClick={() => onAdd(here)}>
          <Plus className="ue:h-3.5 ue:w-3.5" />
          {t('加对象')}
        </ui.Button>
        <ui.Button
          size="sm"
          variant="ghost"
          onClick={(e: MouseEvent<HTMLElement>) => openMenuAt(e.currentTarget, sources(here))}
        >
          {t('加来源')}
        </ui.Button>
        <ui.IconButton icon={FolderPlus} size="sm" label={t('新建文件夹')} onClick={() => onNewFolder('')} />
      </div>
      <div onContextMenu={blankMenu} className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:overflow-y-auto">
        <FileTree<GmObject>
          items={items}
          folders={k ? undefined : folders}
          active={sel ? pathOf(sel) : undefined}
          activeFolder={activeFolder}
          searching={!!k}
          label={t('对象列表')}
          onOpen={(_p, o) => {
            setActiveFolder(undefined)
            onPick(o.name)
          }}
          onFolderClick={setActiveFolder}
          leafIcon={(o) => ({
            icon: iconOf(o),
            tone: o.src?.startsWith('@luaMod.') || o.ref?.class.startsWith('lua:') ? 'ue:text-muted' : 'ue:text-accent',
          })}
          leafRight={(o) => (
            <>
              {o.by === 'agent' && <AgentBadge />}
              {o.ref && live ? <HitBadge n={hits[o.name]?.count} error={hits[o.name]?.error} /> : null}
            </>
          )}
          leafSub={(o) => <ObjRule o={o} small noIcon />}
          onLeafMenu={(e, _p, o) => menu(e, o)}
          onFolderMenu={folderMenu}
          onMove={onMove}
          empty={
            <p className="ue:px-2 ue:py-2 ue:text-footnote ue:text-subtle">
              {k ? t('没有名字或类里含「{q}」的对象', { q }) : t('还没有对象：先新建一个文件夹，再「加对象」')}
            </p>
          }
        />
      </div>
      <p className="ue:px-1 ue:text-caption ue:leading-relaxed ue:text-subtle">
        {t('「加对象」打开选对象面板定类和唯一标识。存的是匹配规则，每次用时按规则现找。')}
      </p>
    </div>
  )
}
