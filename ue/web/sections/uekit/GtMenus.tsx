import { Copy, CopyPlus, Download, FileJson, FolderOpen, Layers, Pencil, Play, Trash2 } from 'lucide-react'
import { useState, type MouseEvent } from 'react'
import { ppost } from '../../api.ts'
import { h, t } from '../../host.ts'
import { copyText, openMenu } from '../../menu.tsx'
import { Confirm } from '../../ui.tsx'
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
 * GameTest 页左栏的右键菜单：场景（运行、改名、复制一份、复制路径、在文件夹中显示、删除）、文件夹（复制路径、在文件夹中显示）、
 * 最近运行（打开场景、再跑一次、复制 runId 和输出目录）。改名、删除要弹窗，弹窗也在这里（dialogs 挂进页面）。
 * 文件操作由面板直接做（ext/gt/file），做完 reload 重新向 UE 要场景列表
 */
export function useScenarioMenus(o: {
  project: string
  /** 场景根的绝对路径（gt.scenarios 的 absoluteRootDir）和给人看的写法（rootDir） */
  root: string
  rootLabel: string
  /** 正在跑或在录制：这时不让再起一个 run */
  locked: boolean
  reload: () => void
  open: (s: Scenario) => void
  runScenario: (s: Scenario) => void
  /** 批量运行几份场景（文件夹右键「运行这里的全部场景」）；旧 GameTest 不支持批量时不给 */
  runBatch?: (paths: string[], label: string) => void
  scenarios: Scenario[]
}) {
  const { ui, toast } = h()
  const [renaming, setRenaming] = useState<Scenario>()
  const [newName, setNewName] = useState('')
  const [deleting, setDeleting] = useState<Scenario>()

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
      'sep',
      {
        label: t('改名…'),
        icon: Pencil,
        onClick: () => {
          setNewName(s.name)
          setRenaming(s)
        },
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
      'sep',
      { label: t('删除…'), icon: Trash2, danger: true, onClick: () => setDeleting(s) },
    ])

  const folderMenu = (e: MouseEvent, path: string, leaves: Scenario[]) =>
    openMenu(e, [
      { title: t('{p}（{n} 个场景）', { p: path, n: leaves.length }) },
      o.runBatch && {
        label: t('运行这里的全部场景'),
        icon: Layers,
        hint: t('一个接一个'),
        disabled: o.locked || !leaves.some((s) => !s.parseError),
        onClick: () =>
          o.runBatch!(
            leaves.filter((s) => !s.parseError).map((s) => s.relativePath),
            path,
          ),
      },
      o.runBatch && 'sep',
      { label: t('复制路径'), icon: Copy, hint: t('相对场景根'), onClick: () => copyText(path) },
      { label: t('复制完整路径'), icon: Copy, onClick: () => copyText(fullPath(path)) },
      { label: t('在文件夹中显示'), icon: FolderOpen, onClick: () => void fileOp(path, 'reveal') },
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

  const rename = async () => {
    const s = renaming
    const name = newName.trim()
    setRenaming(undefined)
    if (!s || !name || name === s.name) return
    const r = await fileOp(s.relativePath, 'rename', { name })
    if (!r) return
    o.reload()
    o.open({ ...s, name, relativePath: r.path })
  }
  const remove = async () => {
    const s = deleting
    setDeleting(undefined)
    if (!s || !(await fileOp(s.relativePath, 'delete'))) return
    toast.success(t('已删除 {p}', { p: s.relativePath }))
    o.reload()
  }

  const dialogs = (
    <>
      <Confirm
        open={!!renaming}
        title={t('改名')}
        okText={t('改名')}
        onOk={() => void rename()}
        onCancel={() => setRenaming(undefined)}
      >
        <div className="ue:flex ue:flex-col ue:gap-2">
          <ui.Input
            autoFocus
            value={newName}
            onChange={(e: { target: { value: string } }) => setNewName(e.target.value)}
            onKeyDown={(e: { key: string }) => e.key === 'Enter' && void rename()}
          />
          <p className="ue:text-footnote ue:leading-relaxed ue:text-subtle">
            {t('文件名和场景里的名字一起改，文件留在原来的目录。')}
          </p>
        </div>
      </Confirm>
      <Confirm
        open={!!deleting}
        danger
        title={t('删除场景')}
        okText={t('删除')}
        onOk={() => void remove()}
        onCancel={() => setDeleting(undefined)}
      >
        {t('删除 {root}/{p}？文件直接从磁盘删掉，不进回收站；用 git、P4 管着的可以从版本库找回。', {
          root: o.rootLabel,
          p: deleting?.relativePath ?? '',
        })}
      </Confirm>
    </>
  )

  return { leafMenu, folderMenu, runMenu, dialogs }
}
