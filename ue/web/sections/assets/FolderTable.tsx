import { ArrowDown, ArrowUp, Folder as FolderIcon } from 'lucide-react'
import { useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { assetClassLabel, assetIcon } from '../../asset-icons.ts'
import { h, t } from '../../host.ts'
import { Badge, fmtSize, fmtTime } from '../../ui.tsx'
import type { Folder } from './folder-data.ts'
import type { StatItem } from './folder-contents.ts'

type SortKey = 'name' | 'class' | 'size' | 'mtime'

/** 行高（设置 →「组件」里能调） */
export const FOLDER_ROW = 32

/**
 * 资源页右栏「文件夹内容」表（设计稿「UE 插件优化与扩展」三.3，效果图 3）：类型胶囊带计数、名称 / 类型 / 磁盘大小 /
 * 修改时间 / 状态（未保存、P4 签出、未被引用），底栏合计。子文件夹排在前面，点进去就是换到那个文件夹。
 * 只管显示和交互，数据由调用方给（FolderView.tsx），设置 →「组件」里的示例也用它
 */
export function FolderTable({
  folders,
  items,
  selected,
  onSelect,
  onOpen,
  onOpenFolder,
  onMenu,
  editor,
  refsBusy,
  rowHeight = FOLDER_ROW,
  footNote,
}: {
  folders: Folder[]
  items: StatItem[]
  selected?: string
  onSelect: (path: string) => void
  /** 双击、回车：在检视区打开 */
  onOpen: (path: string) => void
  onOpenFolder: (path: string) => void
  onMenu?: (e: MouseEvent, it: StatItem) => void
  /** 有编辑器答了未保存、引用；没有时状态列只有 P4 */
  editor: boolean
  /** 还在查引用 */
  refsBusy?: boolean
  rowHeight?: number
  /** 底栏右边的一句提示（截断、P4 读不到…） */
  footNote?: ReactNode
}) {
  const { cn, ui } = h()
  const [cls, setCls] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'name', desc: false })

  // 类型胶囊：按个数从多到少
  const kinds = useMemo(() => {
    const m = new Map<string, number>()
    for (const it of items) m.set(it.class, (m.get(it.class) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [items])

  const query = q.trim().toLowerCase()
  const rows = useMemo(() => {
    const list = items.filter((it) => (!cls || it.class === cls) && (!query || it.name.toLowerCase().includes(query)))
    const dir = sort.desc ? -1 : 1
    const val = (it: StatItem) =>
      sort.key === 'size'
        ? (it.size ?? -1)
        : sort.key === 'mtime'
          ? (it.mtime ?? '')
          : sort.key === 'class'
            ? it.class
            : ''
    return list.sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      const c = va < vb ? -1 : va > vb ? 1 : 0
      return (
        c * dir ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) *
          (sort.key === 'name' ? dir : 1)
      )
    })
  }, [items, cls, query, sort])
  const subFolders = cls ? [] : folders.filter((f) => !query || f.name.toLowerCase().includes(query))

  const total = items.reduce((n, it) => n + (it.size ?? 0), 0)
  const dirty = items.filter((it) => it.dirty).length
  const out = items.filter((it) => it.vcs?.action).length
  const unref = items.filter((it) => it.refs === 0).length

  const head = (key: SortKey, label: string, right = false) => (
    <button
      type="button"
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key === 'size' || key === 'mtime' }))}
      className={cn(
        'ue:flex ue:cursor-pointer ue:items-center ue:gap-1 ue:hover:text-fg',
        right && 'ue:justify-end',
        sort.key === key && 'ue:text-fg',
      )}
    >
      {label}
      {sort.key === key &&
        (sort.desc ? <ArrowDown className="ue:h-3 ue:w-3" /> : <ArrowUp className="ue:h-3 ue:w-3" />)}
    </button>
  )
  const grid =
    'ue:grid ue:grid-cols-[minmax(10rem,1fr)_8rem_5.5rem_7.5rem_minmax(8rem,12rem)] ue:items-center ue:gap-3 ue:px-3'

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-1.5 ue:border-b ue:border-line ue:px-3 ue:py-2">
        <Chip on={!cls} onClick={() => setCls('')} label={t('全部')} n={items.length} />
        {kinds.map(([c, n]) => {
          const ic = assetIcon(c)
          return (
            <Chip
              key={c || '?'}
              on={cls === c}
              onClick={() => setCls(cls === c ? '' : c)}
              label={assetClassLabel(c)}
              n={n}
              icon={<ic.icon className={cn('ue:h-3.5 ue:w-3.5', ic.tone)} />}
            />
          )
        })}
        <div className="ue:ml-auto ue:w-48">
          <ui.Input
            value={q}
            onChange={(e: { target: { value: string } }) => setQ(e.target.value)}
            placeholder={t('在这个文件夹里找')}
            aria-label={t('在这个文件夹里找')}
            size="sm"
          />
        </div>
      </div>
      <div
        role="row"
        className={cn(grid, 'ue:h-8 ue:shrink-0 ue:border-b ue:border-line ue:text-caption ue:text-subtle')}
      >
        {head('name', t('名称'))}
        {head('class', t('类型'))}
        {head('size', t('磁盘大小'), true)}
        {head('mtime', t('修改时间'))}
        <span>
          {t('状态')}
          {refsBusy && <span className="ue:ml-1.5">{t('查引用中…')}</span>}
        </span>
      </div>
      <div role="grid" aria-label={t('文件夹内容')} className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
        {subFolders.map((f) => (
          <div
            key={f.path}
            role="row"
            tabIndex={0}
            title={f.path}
            style={{ height: rowHeight }}
            onClick={() => onOpenFolder(f.path)}
            onKeyDown={(e) => e.key === 'Enter' && onOpenFolder(f.path)}
            className={cn(
              grid,
              'ue:cursor-pointer ue:text-footnote ue:text-fg ue:outline-none ue:hover:bg-hover ue:focus-visible:bg-hover',
            )}
          >
            <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-2">
              <FolderIcon className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
              <span className="ue:truncate">{f.name}</span>
            </span>
            <span className="ue:text-muted">{t('文件夹')}</span>
            <span className="ue:text-right ue:text-subtle">
              {f.count !== undefined ? t('{n} 项', { n: f.count }) : ''}
            </span>
            <span />
            <span />
          </div>
        ))}
        {rows.map((it) => {
          const ic = assetIcon(it.class)
          const sel = selected === it.path
          return (
            <div
              key={it.path}
              role="row"
              aria-selected={sel}
              tabIndex={0}
              title={it.path}
              style={{ height: rowHeight }}
              onClick={() => onSelect(it.path)}
              onDoubleClick={() => onOpen(it.path)}
              onKeyDown={(e) => e.key === 'Enter' && onOpen(it.path)}
              onContextMenu={onMenu ? (e) => onMenu(e, it) : undefined}
              className={cn(
                grid,
                'ue:cursor-pointer ue:text-footnote ue:outline-none ue:focus-visible:bg-hover',
                sel ? 'ue:bg-sel ue:text-fg' : 'ue:text-fg ue:hover:bg-hover',
              )}
            >
              <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-2">
                <ic.icon className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0', ic.tone)} />
                <span className="ue:truncate ue:font-mono">{it.name}</span>
              </span>
              <span className="ue:truncate ue:text-muted">{assetClassLabel(it.class)}</span>
              <span className="ue:text-right ue:text-muted ue:tabular-nums">
                {it.size !== undefined ? fmtSize(it.size) : '—'}
              </span>
              <span className="ue:truncate ue:text-muted ue:tabular-nums">{it.mtime ? fmtTime(it.mtime) : '—'}</span>
              <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1 ue:overflow-hidden">
                <Status it={it} />
              </span>
            </div>
          )
        })}
        {!rows.length && !subFolders.length && (
          <p className="ue:px-3 ue:py-6 ue:text-center ue:text-footnote ue:text-subtle">
            {items.length || folders.length ? t('没有符合条件的资源') : t('这个文件夹是空的')}
          </p>
        )}
      </div>
      <div className="ue:flex ue:h-9 ue:shrink-0 ue:items-center ue:gap-3 ue:border-t ue:border-line ue:px-3 ue:text-caption ue:text-subtle">
        <span>{t('{n} 个资源 · 共 {size}', { n: items.length, size: fmtSize(total) })}</span>
        <span>
          {[
            editor && t('{n} 个未保存', { n: dirty }),
            t('{n} 个已签出', { n: out }),
            editor && !refsBusy && t('{n} 个没人引用', { n: unref }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span className="ue:ml-auto ue:truncate">{footNote ?? t('双击打开 · 右键更多')}</span>
      </div>
    </div>
  )
}

/** 状态列：未保存（黄）、P4 自己签出 / 别人签出、未被引用（灰） */
function Status({ it }: { it: StatItem }) {
  const action = it.vcs?.action
  const others = it.vcs?.others ?? []
  return (
    <>
      {it.dirty && <Badge tone="warn">{t('未保存')}</Badge>}
      {action && (
        <Badge>{action === 'add' ? t('P4 待添加') : action === 'delete' ? t('P4 待删除') : t('P4 已签出')}</Badge>
      )}
      {others.length > 0 && (
        <Badge tone="warn" title={others.join('\n')}>
          {t('{who} 签出', { who: others[0].split('@')[0] + (others.length > 1 ? ` +${others.length - 1}` : '') })}
        </Badge>
      )}
      {it.refs === 0 && (
        <Badge title={t('资源注册表里没有别的包引用它（含软引用）；代码里按路径加载的这里看不到')}>
          {t('未被引用')}
        </Badge>
      )}
    </>
  )
}

/** 类型胶囊：图标颜色和资源图标一致 */
function Chip({
  on,
  onClick,
  label,
  n,
  icon,
}: {
  on: boolean
  onClick: () => void
  label: string
  n: number
  icon?: ReactNode
}) {
  const { cn } = h()
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'ue:flex ue:h-7 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:rounded-full ue:border ue:px-2.5 ue:text-footnote ue:transition-colors',
        on
          ? 'ue:border-transparent ue:bg-sel ue:text-fg'
          : 'ue:border-line ue:text-muted ue:hover:bg-hover ue:hover:text-fg',
      )}
    >
      {icon}
      {label}
      <span className="ue:text-subtle ue:tabular-nums">{n}</span>
    </button>
  )
}
