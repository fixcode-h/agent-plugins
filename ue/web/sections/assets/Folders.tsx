import { Copy, Folder as FolderIcon, FolderOpen, RefreshCw, Star, StarOff } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { op } from '../../api.ts'
import { assetIcon } from '../../asset-icons.ts'
import { ClassPicker, type ClassOpt } from '../../ClassPicker.tsx'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { useKept } from '../../keep.ts'
import { copyText, MenuHost, openMenu } from '../../menu.tsx'
import { TreeList, type TreeLine } from '../../TreeList.tsx'
import { Hit, hitText, keepSet, TreeSearch } from '../../tree-search.tsx'
import { ErrorText } from '../../ui.tsx'
import { useAssetMenu } from './asset-menu.ts'
import { useFavFolders } from './fav-data.ts'
import { FavFolders, FavStar } from './FavFolders.tsx'
import { RedirectorDialog, redirectorMenuItem } from './Redirectors.tsx'
import { pkgOf, useFolderData, type Folder, type Item } from './folder-data.ts'

/** 类型下拉不打字时列的常用类型（和资源页搜索页签差不多，少几个不常按文件夹找的） */
const COMMON = [
  'Blueprint',
  'WidgetBlueprint',
  'DataTable',
  'DataAsset',
  'PrimaryDataAsset',
  'Material',
  'MaterialInstanceConstant',
  'Texture2D',
  'StaticMesh',
  'SkeletalMesh',
  'AnimSequence',
  'SoundWave',
  'World',
]

/** 树上的一个节点：真文件夹、虚拟分组（Plugins、Engine / Plugins）、资源 */
type N =
  | { kind: 'folder'; key: string; name: string; f: Folder }
  | { kind: 'group'; key: string; name: string; kids: Folder[] }
  | { kind: 'item'; key: string; name: string; it: Item }

const NONE: Record<string, boolean> = {}

/**
 * 资源页「文件夹」页签：照 Content Browser 的文件夹树，点开文件夹才读下一层（设计稿 designs/对象页合并与资源导航-设计稿.md 第 8 节）。
 * 根是 Content（/Game）、Plugins（项目插件，一个插件一个挂载点）、Engine（默认收起，展开才读）。
 * 数据走 assets.children：编辑器开着问资源注册表，没开就扫磁盘（不为它起后台编辑器，见 server/asset-folders.ts）
 */
export function AssetFolders({
  selected,
  onSelect,
  reveal,
  folder,
  onFolder,
}: {
  /** 当前选中的资源路径（/Game/A/B.B 或 /Game/A/B） */
  selected: string
  /** 点了一个资源 */
  onSelect: (path: string) => void
  /** 要定位的资源（「在文件夹里定位」、从别处跳过来）：展开到它所在的文件夹并滚到它；变了才定位一次 */
  reveal?: string
  /** 右栏正在列内容的文件夹（没有时右栏是检视区）：高亮它；不是在树里点的（面包屑、后退）就展开定位过去 */
  folder?: string
  /** 点了一个文件夹（或收藏）：右栏列它的内容 */
  onFolder?: (path: string) => void
}) {
  const { project, target, state } = useUe()
  const data = useFolderData(project.id, target)
  const { levels, open, toggle, load, setCls, revealPath } = data
  const kk = `${project.id}/assets/folders`
  const [q, setQ] = useKept(`${kk}/q`, '')
  // 搜索时自动展开露出命中项的节点，用户再点收起记在这里（换关键词清掉），和 UObject 树一样
  const [fold, setFold] = useState<{ q: string; m: Record<string, boolean> }>({ q: '', m: {} })
  const folded = fold.q === q ? fold.m : NONE
  const [clsOpt, setClsOpt] = useKept<ClassOpt>(`${kk}/clsOpt`, { name: '' })
  // 收藏和定位到的文件夹高亮
  const [selFolder, setSelFolder] = useState('')
  const [scrollTo, setScrollTo] = useState<{ key: string; seq: number }>()

  // 收藏的文件夹存在项目里（文档根或 .agent-panel，权限与设置里选，server/favorites.ts），团队共用
  const fav = useFavFolders(project.id)
  const favs = fav.folders
  const [favOpen, setFavOpen] = useKept(`${kk}/favOpen`, true)
  const assetMenu = useAssetMenu()

  const goTo = async (path: string, kind: 'asset' | 'folder') => {
    const key = await revealPath(path, kind)
    if (!key) return
    if (kind === 'folder') setSelFolder(pkgOf(path))
    setScrollTo((s) => ({ key, seq: (s?.seq ?? 0) + 1 }))
  }
  // 树里点的文件夹不用再定位（就在眼前），记下来和 folder 比
  const picked = useRef('')
  useEffect(() => {
    if (folder && folder !== picked.current) void goTo(folder, 'folder')
    picked.current = folder ?? ''
    // 只在右栏换了文件夹时看
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [folder])
  const pickFolder = (p: string) => {
    picked.current = p
    setSelFolder(p)
    onFolder?.(p)
    // 和 Content Browser 一样：点文件夹名展开它（不收起，收起点前面的箭头）
    if (!open[p]) toggle(p)
  }
  useEffect(() => {
    if (reveal) void goTo(reveal, 'asset')
    // 只在要定位的资源变了时定位一次
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal])

  const root = levels['/']
  const mounts = root?.folders ?? []
  const plugins = mounts.filter((f) => f.root === 'plugin')
  const enginePlugins = mounts.filter((f) => f.root === 'engine' && f.path !== '/Engine')
  // 有编辑器（或已经起来的后台编辑器）才去取类型列表：只是点开下拉，不为它启动后台编辑器
  const canList = (state?.instances ?? []).some((i) => i.kind === 'editor' || i.kind === 'background')

  const { lines, hits } = useMemo(() => {
    const folderNode = (f: Folder, name = f.name): N => ({ kind: 'folder', key: `f:${f.path}`, name, f })
    const tops: N[] = [
      folderNode(mounts.find((f) => f.path === '/Game') ?? { name: 'Content', path: '/Game' }, 'Content'),
      ...(plugins.length ? [{ kind: 'group', key: '#plugins', name: 'Plugins', kids: plugins } as N] : []),
      folderNode(mounts.find((f) => f.path === '/Engine') ?? { name: 'Engine', path: '/Engine' }, 'Engine'),
    ]
    const kidsOf = (n: N): N[] => {
      if (n.kind === 'group') return n.kids.map((f) => folderNode(f))
      if (n.kind === 'item') return []
      const lv = levels[n.f.path]
      if (!lv) return []
      return [
        ...(n.f.path === '/Engine' && enginePlugins.length
          ? [{ kind: 'group', key: '#engine-plugins', name: 'Plugins', kids: enginePlugins } as N]
          : []),
        ...lv.folders.map((f) => folderNode(f)),
        ...lv.items.map((it): N => ({ kind: 'item', key: `i:${pkgOf(it.path)}`, name: it.name, it })),
      ]
    }
    const searching = !!q.trim()
    const { keep, hits } = searching
      ? keepSet(
          tops,
          kidsOf,
          (n) => n.key,
          (n) => hitText(q, n.name, n.kind === 'item' ? n.it.class : undefined),
        )
      : { keep: new Set<string>(), hits: 0 }
    const out: TreeLine[] = []
    const label = (s: string, filter: boolean) => (filter ? <Hit text={s} q={q} /> : s)
    const walk = (list: N[], depth: number, filter: boolean) => {
      for (const n of list) {
        if (filter && !keep.has(n.key)) continue
        if (n.kind === 'item') {
          const ic = assetIcon(n.it.class)
          out.push({
            key: n.key,
            depth,
            label: label(n.name, filter),
            icon: ic.icon,
            iconTone: ic.tone,
            expandable: false,
            open: false,
            selected: !!selected && pkgOf(selected) === pkgOf(n.it.path),
            title: n.it.path,
            aside: n.it.class ? label(n.it.class, filter) : undefined,
            onSelect: () => onSelect(n.it.path),
            onMenu: (e) => assetMenu(e, n.it.path),
          })
          continue
        }
        const forced = filter && kidsOf(n).some((c) => keep.has(c.key))
        const isOpen = forced ? !folded[n.key] : !!open[n.kind === 'group' ? n.key : n.f.path]
        const fpath = n.kind === 'folder' ? n.f.path : ''
        const lv = fpath ? levels[fpath] : undefined
        const onToggle = forced
          ? () => setFold({ q, m: { ...folded, [n.key]: isOpen } })
          : () => toggle(n.kind === 'group' ? n.key : n.f.path)
        out.push({
          key: n.key,
          depth,
          label: label(n.name, filter),
          icon: isOpen ? FolderOpen : FolderIcon,
          iconTone: 'ue:text-subtle',
          expandable: true,
          open: isOpen,
          selected: n.kind === 'folder' && (folder ? folder === n.f.path : selFolder === n.f.path),
          title: n.kind === 'folder' ? n.f.path : undefined,
          aside: lv?.busy
            ? t('读取中…')
            : n.kind === 'group'
              ? n.kids.length
              : n.f.count !== undefined
                ? n.f.count
                : // 桥接不给子项数：展开读过的就数读到的，没读过的不显示，不为计数多发请求
                  lv && !lv.error
                  ? (lv.total ?? lv.folders.length + lv.items.length)
                  : undefined,
          onToggle,
          onSelect: n.kind === 'folder' && onFolder && !forced ? () => pickFolder(n.f.path) : undefined,
          onMenu: n.kind === 'folder' ? (e) => folderMenu(e, n.f.path) : undefined,
          // 行尾星标：收藏了一直显示实心的，没收藏的悬停才露出来
          action:
            n.kind === 'folder' ? (
              <FavStar on={favs.includes(n.f.path)} onClick={() => fav.toggle(n.f.path)} />
            ) : undefined,
          actionShown: n.kind === 'folder' && favs.includes(n.f.path),
        })
        if (!isOpen) continue
        if (forced) {
          walk(kidsOf(n), depth + 1, true)
          continue
        }
        walk(kidsOf(n), depth + 1, false)
        if (!lv) continue
        if (lv.error) out.push(note(`${n.key}#error`, depth + 1, lv.error, 'ue:text-danger'))
        if (lv.note) out.push(note(`${n.key}#note`, depth + 1, lv.note))
        if (lv.loading)
          out.push(
            note(
              `${n.key}#loading`,
              depth + 1,
              <>
                {t('资源注册表还在扫盘，这一层可能不全')}{' '}
                <button
                  type="button"
                  className="ue:cursor-pointer ue:text-accent-text ue:hover:underline"
                  onClick={() => void load(fpath)}
                >
                  {t('重读')}
                </button>
              </>,
            ),
          )
        if (lv.more) {
          const rest = lv.total ? lv.total - lv.folders.length - lv.items.length : 0
          out.push(
            note(
              `${n.key}#more`,
              depth + 1,
              rest > 0 ? t('还有 {n} 个，用搜索页签找', { n: rest }) : t('还有更多，用搜索页签找'),
            ),
          )
        }
      }
    }
    walk(tops, 0, searching)
    return { lines: out, hits }
    // toggle、onSelect、folderMenu 每次渲染都是新的，按数据变化重算就够
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [levels, open, selected, selFolder, folder, q, folded, favs])

  function folderMenu(e: MouseEvent, path: string) {
    const on = favs.includes(path)
    openMenu(e, [
      { title: path },
      { label: on ? t('取消收藏') : t('收藏'), icon: on ? StarOff : Star, onClick: () => fav.toggle(path) },
      { label: t('重新读取'), icon: RefreshCw, onClick: () => void load(path) },
      { label: t('复制路径'), icon: Copy, onClick: () => copyText(path) },
      'sep',
      redirectorMenuItem(path),
    ])
  }

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex">
        <div className="ue:min-w-0 ue:flex-1">
          <TreeSearch value={q} onChange={setQ} placeholder={t('筛当前展开的文件夹')} hits={hits} partial />
        </div>
        <div className="ue:w-36 ue:shrink-0 ue:border-b ue:border-line ue:py-2 ue:pr-3">
          <ClassPicker
            value={clsOpt.name ? clsOpt : { name: '', label: t('所有类型') }}
            common={[{ name: '', label: t('所有类型') }, ...COMMON.map((name) => ({ name }))]}
            placeholder={t('只列这个类型的资源')}
            load={
              canList
                ? (s) =>
                    op<{ items: { name: string; path: string; count: number }[] }>(
                      project.id,
                      'asset.classes',
                      { q: s, limit: 200 },
                      undefined,
                      60000,
                    ).then((r) =>
                      r.items.map((c) => ({
                        name: c.name,
                        path: c.path,
                        note: c.count ? t('{n} 个', { n: c.count }) : undefined,
                      })),
                    )
                : undefined
            }
            onChange={(c) => {
              setClsOpt(c)
              setCls(c.path || c.name)
            }}
          />
        </div>
      </div>
      {root?.source === 'disk' && (
        <p className="ue:px-3 ue:pt-1.5 ue:text-caption ue:text-subtle">
          {t('编辑器没开，按磁盘上的 Content 列：资源类型点开才知道')}
        </p>
      )}
      {root?.error && (
        <div className="ue:px-3 ue:pt-2">
          <ErrorText>{root.error}</ErrorText>
        </div>
      )}
      <FavFolders
        folders={favs}
        selected={selFolder}
        open={favOpen}
        onOpenChange={setFavOpen}
        onGo={(p) => (onFolder ? onFolder(p) : void goTo(p, 'folder'))}
        onRemove={fav.toggle}
        onMove={fav.move}
        where={fav.file}
      />
      <TreeList lines={lines} label={t('资源文件夹')} reveal={scrollTo} />
      <MenuHost />
      <RedirectorDialog onFixed={(p) => void load(p)} />
    </div>
  )
}

/** 树里的提示行（出错、提示、截断）：不能选也不能展开 */
function note(key: string, depth: number, text: ReactNode, tone = 'ue:text-subtle'): TreeLine {
  return {
    key,
    depth,
    label: <span className={tone}>{text}</span>,
    icon: FolderIcon,
    iconTone: 'ue:invisible',
    expandable: false,
    open: false,
    selected: false,
  }
}
