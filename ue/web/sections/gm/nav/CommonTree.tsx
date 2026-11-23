import {
  ArrowDown,
  ArrowUp,
  Crosshair,
  FileCode,
  Folder,
  FolderInput,
  FolderPlus,
  ListVideo,
  Pencil,
  SquareTerminal,
  StarOff,
  Trash2,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import type { MouseEvent } from 'react'
import {
  addCommonGroup,
  argsText,
  commonGroups,
  deleteCommonGroup,
  moveCommon,
  renameCommonGroup,
  setCommonGroup,
} from '../../../../shared/gm/common.ts'
import type { GmFav, GmStore } from '../../../../shared/gm/schema.ts'
import type { useAsk } from '../../../ask.tsx'
import { h, t } from '../../../host.ts'
import { openMenu } from '../../../menu.tsx'
import { FileTree, type TreeLeaf } from '../../uekit/tree.tsx'
import type { GmEntry } from '../data.ts'
import type { MenuList } from './use-gm-menus.ts'

/** 常用树里的一行：原条目 + 在 common 里的下标（同一条 GM 可以有几组参数，靠下标区分） */
export interface CommonRow {
  f: GmFav
  i: number
}

const KIND: Record<string, { icon: LucideIcon; label: () => string; accent?: boolean }> = {
  lua: { icon: FileCode, label: () => 'Lua', accent: true },
  cpp: { icon: Wand2, label: () => 'C++' },
  custom: { icon: Crosshair, label: () => t('自定义'), accent: true },
  console: { icon: SquareTerminal, label: () => t('命令') },
  macro: { icon: ListVideo, label: () => t('宏') },
  obj: { icon: Crosshair, label: () => t('对象'), accent: true },
}
const kindOf = (key: string) => KIND[key.slice(0, key.indexOf(':'))] ?? KIND.cpp

/**
 * GM 页左栏「常用」分类（用户 2026-11-22：四个分类的收藏合成一份，可以分组）：一棵树，分组是文件夹，
 * 混放 GM（带那组参数）、宏、自定义 GM、对象、控制台命令。叶子按用户排的顺序（右键上移下移），拖进分组改分组；
 * 右键这条自己的动作（执行、打开……，GmNav 给）+ 移到分组 / 上移 / 下移 / 移出常用；分组右键新建子分组、改名、删除
 */
export function CommonTree({
  g,
  q,
  find,
  macroName,
  selected,
  onOpen,
  itemMenu,
  save,
  ask,
}: {
  g: GmStore
  q: string
  find: (key: string) => GmEntry | undefined
  macroName: (id: string) => string | undefined
  /** 选中的那一条在 common 里的下标 */
  selected?: number
  onOpen: (f: GmFav, i: number) => void
  /** 这条自己的动作（执行、打开、填回参数……） */
  itemMenu: (f: GmFav) => MenuList
  save: (g: GmStore) => void
  ask: ReturnType<typeof useAsk>[1]
}) {
  const { ui } = h()
  const nameOf = (f: GmFav) => {
    const [kind, ...rest] = f.key.split(':')
    const id = rest.join(':')
    if (kind === 'macro') return macroName(id)
    if (kind === 'obj' || kind === 'console') return id
    return find(f.key)?.name
  }
  // 宏、自定义 GM 删了、Lua GM 改名了：淡显，只能移出（对象在对象列表里删了也一样）
  const gone = (f: GmFav) => {
    const kind = f.key.slice(0, f.key.indexOf(':'))
    if (kind === 'obj') return !g.objects.some((o) => o.name === f.key.slice(4))
    if (kind === 'console') return false
    if (kind === 'macro') return !macroName(f.key.slice(6))
    return !find(f.key)
  }
  const k = q.trim().toLowerCase()
  const rows: CommonRow[] = g.common.map((f, i) => ({ f, i }))
  const shown = k ? rows.filter(({ f }) => `${nameOf(f) ?? f.key} ${argsText(f.args)}`.toLowerCase().includes(k)) : rows
  const items: TreeLeaf<CommonRow>[] = shown.map((r) => ({
    path: `${r.f.group ? `${r.f.group}/` : ''}${r.i}`,
    data: r,
  }))
  const groups = commonGroups(g)

  const askGroup = async (title: string, init = '') =>
    (await ask({ title, label: t('分组的名字（用 / 分层，例如：战斗/Boss）'), init }))?.trim()
  const newGroup = async (parent = '') => {
    const name = await askGroup(t('新建分组'))
    if (name) save(addCommonGroup(g, parent ? `${parent}/${name}` : name))
  }
  const leafMenu = (e: MouseEvent, r: CommonRow) => {
    e.stopPropagation()
    const sameGroup = g.common.map((f, i) => ({ f, i })).filter((x) => (x.f.group ?? '') === (r.f.group ?? ''))
    const pos = sameGroup.findIndex((x) => x.i === r.i)
    const prev = sameGroup[pos - 1]
    const next = sameGroup[pos + 1]
    openMenu(e, [
      ...(gone(r.f) ? [] : itemMenu(r.f)),
      'sep',
      // 分组多了平铺会把菜单撑得很长：收进子菜单（项多自动带搜索）
      {
        label: t('移到分组'),
        icon: FolderInput,
        hint: r.f.group || t('（最外层）'),
        search: t('搜分组'),
        sub: [
          {
            label: t('新分组…'),
            icon: FolderPlus,
            onClick: async () => {
              const name = await askGroup(t('新建分组'))
              if (name) save(setCommonGroup(addCommonGroup(g, name), r.i, name))
            },
          },
          'sep',
          ...['', ...groups].map((p) => ({
            label: p || t('（最外层）'),
            icon: p ? Folder : FolderInput,
            checked: (r.f.group ?? '') === p,
            disabled: (r.f.group ?? '') === p,
            onClick: () => save(setCommonGroup(g, r.i, p || undefined)),
          })),
        ],
      },
      'sep',
      {
        label: t('上移'),
        icon: ArrowUp,
        disabled: !prev,
        onClick: () => prev && save(moveCommon(g, r.i, prev.i, r.f.group)),
      },
      {
        label: t('下移'),
        icon: ArrowDown,
        disabled: !next,
        onClick: () => next && save(moveCommon(g, r.i, next.i, r.f.group)),
      },
      'sep',
      {
        label: t('移出常用'),
        icon: StarOff,
        danger: true,
        onClick: () => save({ ...g, common: g.common.filter((_, i) => i !== r.i) }),
      },
    ])
  }
  const folderMenu = (e: MouseEvent, path: string) => {
    e.stopPropagation()
    openMenu(e, [
      { label: t('新建子分组…'), icon: FolderPlus, onClick: () => void newGroup(path) },
      {
        label: t('改名'),
        icon: Pencil,
        onClick: async () => {
          const to = await askGroup(t('分组改名'), path)
          if (to && to !== path) save(renameCommonGroup(g, path, to))
        },
      },
      'sep',
      {
        label: t('删除分组（条目挪到上一层）'),
        icon: Trash2,
        danger: true,
        onClick: () => save(deleteCommonGroup(g, path)),
      },
    ])
  }

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:h-8 ue:shrink-0 ue:items-center ue:gap-2 ue:px-3 ue:text-caption">
        <span className="ue:font-medium ue:text-muted">{t('常用 {n}', { n: g.common.length })}</span>
        <span className="ue:truncate ue:text-subtle">{t('右键排序 · 拖进分组')}</span>
        <ui.IconButton
          icon={FolderPlus}
          size="sm"
          className="ue:ml-auto"
          label={t('新建分组')}
          onClick={() => void newGroup()}
        />
      </div>
      <div
        onContextMenu={(e) =>
          openMenu(e, [{ label: t('新建分组…'), icon: FolderPlus, onClick: () => void newGroup() }])
        }
        className="ue:min-h-0 ue:flex-1 ue:overflow-y-auto ue:px-2 ue:pb-2"
      >
        <FileTree<CommonRow>
          items={items}
          folders={k ? undefined : groups}
          keepOrder
          searching={!!k}
          active={items.find((x) => x.data.i === selected)?.path}
          label={t('常用')}
          onOpen={(_p, r) => !gone(r.f) && onOpen(r.f, r.i)}
          leafIcon={(r) => {
            const m = kindOf(r.f.key)
            return { icon: m.icon, tone: m.accent ? 'ue:text-accent-text' : 'ue:text-muted' }
          }}
          leafLabel={(r) => (
            <>
              <span className={r.f.key.startsWith('lua:') || r.f.key.startsWith('cpp:') ? 'ue:font-mono' : undefined}>
                {nameOf(r.f) ?? r.f.key.replace(/^[a-z]+:/, '')}
              </span>
              {argsText(r.f.args) && (
                <span className="ue:ml-1.5 ue:font-mono ue:text-caption ue:text-subtle">{argsText(r.f.args)}</span>
              )}
            </>
          )}
          leafDim={(r) => gone(r.f)}
          leafRight={(r) => kindOf(r.f.key).label()}
          onLeafMenu={(e, _p, r) => leafMenu(e, r)}
          onFolderMenu={(e, p) => folderMenu(e, p)}
          onMove={(src, toDir) => {
            if (src.dir) {
              const name = src.path.split('/').pop()!
              save(renameCommonGroup(g, src.path, toDir ? `${toDir}/${name}` : name))
            } else if (src.data) save(setCommonGroup(g, src.data.i, toDir || undefined))
          }}
          empty={
            <p className="ue:px-2 ue:py-2 ue:text-footnote ue:text-subtle">
              {k
                ? t('没有含「{q}」的常用', { q })
                : t('还没有常用：在 GM、宏、对象上右键「加到常用」，或在详情里点「加到常用」')}
            </p>
          }
        />
      </div>
    </div>
  )
}
