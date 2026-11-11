import { Copy, ExternalLink, FolderOpen, GitCompareArrows, MessageSquare, PanelRightOpen, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ppost } from '../../api.ts'
import { h, t } from '../../host.ts'
import { copyText, type MenuItem } from './menu.tsx'
import { nameOf, type Capture } from './types.ts'

/**
 * 一份抓取的右键菜单（左栏会话列表的行、页头的标题、详情顶上的文件条都用这一份）：
 * 打开、在 Insights 里打开、在文件夹里显示、重命名、交给 Agent、选来对比、复制名字 / 路径 / id、删除。
 */
export function captureItems(
  project: string,
  c: Capture,
  o: {
    onOpen?: () => void
    onAgent?: () => void
    onRename: () => void
    onDelete: () => void
    onPick?: () => void
    picked?: boolean
  },
): MenuItem[] {
  const { toast } = h()
  const call = (path: string) =>
    ppost(project, path, { id: c.id }).catch((e: Error) => {
      toast.error(e.message)
    })
  return [
    { title: nameOf(c) },
    o.onOpen && { label: t('打开'), icon: PanelRightOpen, onClick: o.onOpen },
    c.kind === 'trace' && {
      label: t('在 Unreal Insights 里打开'),
      icon: ExternalLink,
      onClick: () => void call('perf/insights'),
    },
    { label: t('在文件夹中显示'), icon: FolderOpen, onClick: () => void call('perf/reveal') },
    { label: t('重命名…'), icon: Pencil, onClick: o.onRename },
    o.onAgent && { label: t('让 Agent 分析'), icon: MessageSquare, onClick: o.onAgent },
    o.onPick &&
      c.kind !== 'trace' && {
        label: t('选来对比'),
        icon: GitCompareArrows,
        checked: o.picked,
        onClick: o.onPick,
      },
    'sep',
    { label: t('复制名字'), icon: Copy, onClick: () => copyText(nameOf(c)) },
    { label: t('复制文件路径'), onClick: () => copyText(c.file) },
    { label: t('复制抓取 id'), onClick: () => copyText(c.id) },
    'sep',
    {
      label: c.imported ? t('取消登记…') : t('删除…'),
      icon: Trash2,
      danger: true,
      onClick: o.onDelete,
    },
  ].filter(Boolean) as MenuItem[]
}

/** 重命名弹窗：只改面板里显示的名字，不动磁盘上的文件 */
export function RenameDialog({
  project,
  capture,
  onClose,
  onDone,
}: {
  project: string
  capture?: Capture
  onClose: () => void
  onDone: () => void
}) {
  const { ui, toast } = h()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (capture) setName(nameOf(capture))
  }, [capture])
  const save = async () => {
    if (!capture || !name.trim()) return
    setBusy(true)
    try {
      await ppost(project, 'perf/rename', { id: capture.id, label: name.trim() })
      onDone()
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <ui.Modal
      open={!!capture}
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('重命名抓取')}
      size="sm"
      footer={
        <>
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          <ui.Button variant="primary" disabled={busy || !name.trim()} onClick={() => void save()}>
            {t('保存')}
          </ui.Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <ui.Input
          autoFocus
          value={name}
          maxLength={80}
          onChange={(e: { target: { value: string } }) => setName(e.target.value)}
        />
        <p className="ue:mt-2 ue:text-caption ue:text-subtle">
          {t('只改面板里显示的名字，磁盘上的文件名不变。Agent 也可以用这个名字找到它。')}
        </p>
      </form>
    </ui.Modal>
  )
}
