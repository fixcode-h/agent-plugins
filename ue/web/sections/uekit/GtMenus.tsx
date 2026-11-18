import { Copy, CopyPlus, Download, FileJson, FolderOpen, Pencil, Play, Trash2 } from 'lucide-react'
import type { MouseEvent } from 'react'
import { ppost } from '../../api.ts'
import { h, t } from '../../host.ts'
import { copyText, openMenu, type MenuItem } from '../../menu.tsx'
import type { GtRunSummary } from './GtRun.tsx'
import { copyScenarioJson, downloadScenarioJson } from './gt-export.ts'

/** GameTest 左栏一项场景（gt.scenarios 的一条） */
export interface Scenario {
  name: string
  relativePath: string
  _note?: string
  steps: number
  revision?: number
  tags?: string[]
  parseError?: string
}

/**
 * GameTest 页左栏的右键菜单：场景（运行、改名、复制一份、复制路径、在文件夹中显示、删除）、
 * 最近运行（打开场景、再跑一次、复制 runId 和输出目录）。文件夹的菜单、改名和删除（先看谁在 call）在场景库整理里（GtLibrary.tsx）。
 * 文件操作由面板直接做（ext/gt/file），做完 reload 重新向 UE 要场景列表
 */
export function useScenarioMenus(o: {
  project: string
  /** 场景根的绝对路径（gt.scenarios 的 absoluteRootDir） */
  root: string
  /** 正在跑或在录制：这时不让再起一个 run */
  locked: boolean
  reload: () => void
  open: (s: Scenario) => void
  /** ignoreSkipIf：全部照做，忽略步骤上的「已达成就跳过」（GameTest 1.7.0） */
  runScenario: (s: Scenario, ignoreSkipIf?: boolean) => void
  scenarios: Scenario[]
  /** 录制截图的两项（GtShotMenus.tsx）：识别截图文字、删除录制截图 */
  shotItems?: (s: Scenario) => MenuItem[]
  /** 改名、删除：场景库整理的同一套流程（先列出谁在 call 它，GtLibrary.tsx） */
  rename: (s: Scenario) => void
  remove: (s: Scenario) => void
}) {
  const { toast } = h()

  const fileOp = async (path: string, action: string, extra: Record<string, unknown> = {}) => {
    try {
      return await ppost<{ path: string }>(o.project, 'ext/gt/file', { root: o.root, path, action, ...extra })
    } catch (e) {
      toast.error((e as Error).message)
      return undefined
    }
  }
  const fullPath = (rel: string) => `${o.root.replace(/[\\/]+$/, '')}/${rel}`

  const leafMenu = (e: MouseEvent, _path: string, s: Scenario) =>
    openMenu(e, [
      { title: s.name },
      {
        label: t('运行'),
        icon: Play,
        disabled: o.locked || !!s.parseError,
        onClick: () => {
          o.open(s)
          o.runScenario(s)
        },
      },
      {
        label: t('全部照做'),
        icon: Play,
        hint: t('忽略已达成就跳过'),
        disabled: o.locked || !!s.parseError,
        onClick: () => {
          o.open(s)
          o.runScenario(s, true)
        },
      },
      'sep',
      {
        label: t('改名…'),
        icon: Pencil,
        onClick: () => o.rename(s),
      },
      {
        label: t('复制一份'),
        icon: CopyPlus,
        onClick: () =>
          void fileOp(s.relativePath, 'duplicate').then((r) => {
            if (!r) return
            toast.success(t('已复制成 {p}', { p: r.path }))
            o.reload()
          }),
      },
      'sep',
      { label: t('复制为 JSON'), icon: FileJson, onClick: () => copyScenarioJson(o.project, o.root, s.relativePath) },
      {
        label: t('导出 JSON…'),
        icon: Download,
        onClick: () => downloadScenarioJson(o.project, o.root, s.relativePath),
      },
      'sep',
      { label: t('复制路径'), icon: Copy, hint: t('相对场景根'), onClick: () => copyText(s.relativePath) },
      { label: t('复制完整路径'), icon: Copy, onClick: () => copyText(fullPath(s.relativePath)) },
      { label: t('在文件夹中显示'), icon: FolderOpen, onClick: () => void fileOp(s.relativePath, 'reveal') },
      ...(o.shotItems ? ['sep' as const, ...o.shotItems(s)] : []),
      'sep',
      { label: t('删除…'), icon: Trash2, danger: true, onClick: () => o.remove(s) },
    ])

  const runMenu = (e: MouseEvent, r: GtRunSummary) => {
    const s = o.scenarios.find((x) => (r.scenario ? x.relativePath === r.scenario : x.name === r.name))
    openMenu(e, [
      { title: r.name },
      s && { label: t('打开场景'), icon: FolderOpen, onClick: () => o.open(s) },
      s && {
        label: t('再跑一次'),
        icon: Play,
        disabled: o.locked,
        onClick: () => {
          o.open(s)
          o.runScenario(s)
        },
      },
      'sep',
      { label: t('复制 runId'), icon: Copy, onClick: () => copyText(r.runId) },
      r.outputDir && { label: t('复制输出目录'), icon: Copy, onClick: () => copyText(r.outputDir!) },
    ])
  }

  return { leafMenu, runMenu }
}
