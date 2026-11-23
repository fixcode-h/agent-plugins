import {
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Download,
  ExternalLink,
  FilePlus2,
  FileText,
  FlaskConical,
  FolderOpen,
  GitCompare,
  RefreshCw,
  ScanSearch,
  SquarePen,
  Upload,
} from 'lucide-react'
import type { MouseEvent } from 'react'
import { ppost } from '../../api.ts'
import { h, t } from '../../host.ts'
import { copyText, openMenu, type MenuItem } from '@panel/web/src/components/ui/item-menu'
import type { ForgeTab } from './ForgeDetail.tsx'
import type { ForgeEntry } from './Forge.tsx'
import type { ForgeNewInit } from './ForgeNew.tsx'
import { assetDirFor } from './forge-templates.ts'
import { fileOpItems, type ForgeFileOps } from './forge-file-ops.ts'
import { FILTERS } from './kinds.ts'

/**
 * AssetForge 左栏的右键菜单（设计稿 §3）：配置文件、文件夹、列表空白处、多选，还有标题行的「⋯」。
 * 动作都由页面传进来（导入、导出、切右栏页签、展开收起……），这里只管列哪些项、什么时候不能点。
 * 「在文件夹中显示」「用编辑器打开」走 UE 插件服务端的 ext/forge/file，在本机直接开，不经 UE。
 */
export interface ForgeMenuCtx {
  project: string
  /** forge.health 的 configRoot；还没拿到时本机动作不能点 */
  configRoot: string
  entries: ForgeEntry[]
  /** 多选中的 entry.key */
  picked: string[]
  /** 有作业在跑或按钮正忙：不让再发起作业 */
  locked: boolean
  importConfigs: (configs: string[], dryRun?: boolean) => void
  exportAssets: (assets: string[]) => void
  open: (e: ForgeEntry, tab?: ForgeTab) => void
  reload: (deep: boolean) => void
  expand: (open: boolean, under?: string) => void
  go: (section: string, sub?: string) => void
  /** 打开「新建配置」弹窗（右键文件夹时预填类型和资产目录） */
  newConfig: (init?: ForgeNewInit) => void
  /** 配置根第一层目录 → kind（forge.kinds 的 dir） */
  dirKinds?: Map<string, string>
  /** 复制一份、让 AI 改、存为模板 */
  fileOps?: ForgeFileOps
}

/** 能导入：有配置文件、配置读得懂、写了目标资产 */
export const canImport = (e: ForgeEntry) => !!e.config && !['parse-error', 'foreign', 'no-asset'].includes(e.state)
/** 生成的资产在 UE 里存在：才能导出、才能去资源页看 */
export const hasAsset = (e: ForgeEntry) =>
  !!e.asset && !['asset-missing', 'never-imported', 'no-asset'].includes(e.state)
/** 资源页认对象路径（/Game/A/B.B），配置里写的是包路径 */
export const objectPath = (asset: string) => (asset.includes('.') ? asset : `${asset}.${asset.split('/').pop()}`)

export function forgeMenus(c: ForgeMenuCtx) {
  const fileAction = (path: string, action: 'reveal' | 'open') => {
    if (!c.configRoot) return h().toast.error(t('不知道配置根在哪：先刷新 AssetForge 页'))
    ppost(c.project, 'ext/forge/file', { root: c.configRoot, path, action }).catch((e: Error) =>
      h().toast.error(e.message),
    )
  }
  const configsOf = (list: ForgeEntry[]) => list.filter(canImport).map((e) => e.config!)

  const expandItems = (under?: string): MenuItem[] => [
    { label: t('展开全部'), icon: ChevronsUpDown, onClick: () => c.expand(true, under) },
    { label: t('收起全部'), icon: ChevronsDownUp, onClick: () => c.expand(false, under) },
  ]

  const leafItems = (e: ForgeEntry): (MenuItem | false)[] => [
    { title: e.config ?? e.name },
    {
      label: t('导入'),
      icon: Download,
      disabled: c.locked || !canImport(e),
      onClick: () => c.importConfigs([e.config!]),
    },
    { label: t('演练导入（看计划）'), icon: FlaskConical, disabled: !canImport(e), onClick: () => c.open(e, 'plan') },
    { label: t('查看属性差异'), icon: GitCompare, disabled: !hasAsset(e), onClick: () => c.open(e, 'diff') },
    { label: t('打开配置原文'), icon: FileText, disabled: !e.config, onClick: () => c.open(e, 'config') },
    'sep',
    {
      label: t('导出到配置'),
      icon: Upload,
      hint: t('用资产覆盖'),
      disabled: c.locked || !hasAsset(e),
      onClick: () => c.exportAssets([e.asset!]),
    },
    'sep',
    {
      label: t('在资源页打开生成的资源'),
      icon: ExternalLink,
      disabled: !hasAsset(e),
      onClick: () => c.go('assets', objectPath(e.asset!)),
    },
    {
      label: t('在文件夹中显示'),
      icon: FolderOpen,
      disabled: !e.config,
      onClick: () => fileAction(e.config!, 'reveal'),
    },
    { label: t('用编辑器打开'), icon: SquarePen, disabled: !e.config, onClick: () => fileAction(e.config!, 'open') },
    ...fileOpItems(c.fileOps, e),
    'sep',
    { label: t('复制配置路径'), icon: Copy, disabled: !e.config, onClick: () => copyText(e.config!) },
    { label: t('复制资产路径'), icon: Copy, disabled: !e.asset, onClick: () => copyText(e.asset!) },
  ]

  /** 多选时右键任一选中行：对选中的这几份一起做 */
  const pickedItems = (): MenuItem[] => {
    const list = c.entries.filter((e) => c.picked.includes(e.key))
    const configs = configsOf(list)
    const assets = list.filter(hasAsset).map((e) => e.asset!)
    return [
      { title: t('选中了 {n} 份配置', { n: list.length }) },
      {
        label: t('导入选中的 {n} 份', { n: configs.length }),
        icon: Download,
        disabled: c.locked || !configs.length,
        onClick: () => c.importConfigs(configs),
      },
      {
        label: t('导出选中的 {n} 份', { n: assets.length }),
        icon: Upload,
        hint: t('用资产覆盖'),
        disabled: c.locked || !assets.length,
        onClick: () => c.exportAssets(assets),
      },
      'sep',
      {
        label: t('复制路径（每行一个）'),
        icon: Copy,
        onClick: () => copyText(list.map((e) => e.config ?? e.asset ?? e.key).join('\n')),
      },
    ]
  }

  const leafMenu = (ev: MouseEvent, _path: string, e: ForgeEntry) =>
    openMenu(ev, c.picked.length > 1 && c.picked.includes(e.key) ? pickedItems() : leafItems(e))

  const folderMenu = (ev: MouseEvent, path: string, leaves: ForgeEntry[]) => {
    const pending = configsOf(leaves.filter(FILTERS.pending))
    const all = configsOf(leaves)
    openMenu(ev, [
      { title: t('{p}/ · {n} 份', { p: path, n: leaves.length }) },
      {
        label: t('在这里新建配置…'),
        icon: FilePlus2,
        disabled: !c.configRoot,
        onClick: () => c.newConfig({ kind: c.dirKinds?.get(path.split('/')[0]), assetDir: assetDirFor(path) }),
      },
      'sep',
      {
        label: t('导入这个目录待导入的 {n} 份', { n: pending.length }),
        icon: Download,
        disabled: c.locked || !pending.length,
        onClick: () => c.importConfigs(pending),
      },
      {
        label: t('全部导入（{n} 份）', { n: all.length }),
        icon: Download,
        disabled: c.locked || !all.length,
        onClick: () => c.importConfigs(all),
      },
      // forge.entries 的深度检查只能整个配置根一起做；按目录就对这几份演练导入，结果在作业报告里看
      {
        label: t('深度检查这个目录'),
        icon: ScanSearch,
        hint: t('慢'),
        disabled: c.locked || !all.length,
        onClick: () => c.importConfigs(all, true),
      },
      'sep',
      { label: t('在文件夹中显示'), icon: FolderOpen, onClick: () => fileAction(path, 'reveal') },
      { label: t('复制路径'), icon: Copy, onClick: () => copyText(path) },
      'sep',
      ...expandItems(path),
    ])
  }

  /** 列表空白处和标题行的「⋯」共用：刷新、深度检查、打开配置根、展开收起 */
  const rootItems = (withRefresh: boolean): MenuItem[] => [
    ...(withRefresh ? [{ label: t('刷新'), icon: RefreshCw, onClick: () => c.reload(false) }] : []),
    { label: t('深度检查'), icon: ScanSearch, hint: t('慢'), onClick: () => c.reload(true) },
    'sep',
    { label: t('新建配置…'), icon: FilePlus2, disabled: !c.configRoot, onClick: () => c.newConfig() },
    { label: t('打开配置根'), icon: FolderOpen, disabled: !c.configRoot, onClick: () => fileAction('', 'reveal') },
    ...expandItems(),
  ]
  const bodyMenu = (ev: MouseEvent) => openMenu(ev, rootItems(true))
  const moreMenu = (ev: MouseEvent) => openMenu(ev, rootItems(false))

  return { leafMenu, folderMenu, bodyMenu, moreMenu, revealRoot: () => fileAction('', 'reveal') }
}
