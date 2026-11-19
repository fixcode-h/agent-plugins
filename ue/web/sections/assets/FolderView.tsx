import { AppWindow, Copy, Eye, MessageSquare } from 'lucide-react'
import { useState, type MouseEvent } from 'react'
import { useToChat } from '../../chat.tsx'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { InspectorBar, type BarCrumb } from '../../inspect/InspectorBar.tsx'
import { copyText, MenuHost, openMenu } from '../../menu.tsx'
import { ErrorText, fmtSize } from '../../ui.tsx'
import { useOpenInEditor } from './asset-menu.ts'
import { useFolderContents, type StatItem } from './folder-contents.ts'
import { pkgOf } from './folder-data.ts'
import { FolderTable } from './FolderTable.tsx'

/** 挂载根的显示名：/Game 在 UE 里叫 Content */
const segName = (seg: string, i: number) => (i === 0 && seg === 'Game' ? 'Content' : seg)

/**
 * 资源页右栏：选中文件夹时列它的内容（设计稿「UE 插件优化与扩展」三.3，效果图 3）。
 * 顶上和检视区同一个导航条（后退 / 前进是文件夹之间的、面包屑点哪段换到哪段、复制路径、发给对话），下面是 FolderTable。
 * 磁盘大小、修改时间服务端 stat 文件，签出问 p4，未保存和未被引用要编辑器开着（不为它起后台编辑器）
 */
export function FolderView({
  path,
  tick,
  canBack,
  canForward,
  onBack,
  onForward,
  onFolder,
  onOpen,
}: {
  path: string
  /** 页头「刷新」：变了重读 */
  tick: number
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
  /** 换到另一个文件夹（面包屑、子文件夹行） */
  onFolder: (path: string) => void
  /** 在检视区打开一个资源 */
  onOpen: (path: string) => void
}) {
  const { project, target } = useUe()
  const { ui } = h()
  const { data, error, busy, refsBusy } = useFolderContents(project.id, target, path, tick)
  const [sel, setSel] = useState<string>()
  const chat = useToChat()
  const ue = useOpenInEditor()

  const segs = path.split('/').filter(Boolean)
  const crumbs: BarCrumb[] = segs.map((s, i) => {
    const p = '/' + segs.slice(0, i + 1).join('/')
    return {
      key: p,
      name: segName(s, i),
      title: p,
      asset: true,
      onClick: i < segs.length - 1 ? () => onFolder(p) : undefined,
    }
  })

  const items = data?.items ?? []
  // 发给对话：路径 + 这一层的清单（名字、类型、大小、状态），让 Agent 直接拿去整理或排查
  const send = () => {
    const lines = items.slice(0, 200).map((it) => {
      const st = [
        it.dirty && t('未保存'),
        it.vcs?.action && `P4 ${it.vcs.action}`,
        it.vcs?.others?.length && t('{who} 签出', { who: it.vcs.others.join(', ') }),
        it.refs === 0 && t('未被引用'),
      ].filter(Boolean)
      return `- ${pkgOf(it.path)} (${it.class || '?'}${it.size !== undefined ? `, ${fmtSize(it.size)}` : ''})${st.length ? ' ' + st.join(' / ') : ''}`
    })
    if (items.length > 200) lines.push(`- … ${items.length - 200}`)
    chat.send(`UE 资源文件夹 ${path}（${items.length} 个资源）：\n${lines.join('\n')}`)
  }

  const menu = (e: MouseEvent, it: StatItem) => {
    setSel(it.path)
    openMenu(e, [
      { title: it.path },
      { label: t('在检视区打开'), icon: Eye, onClick: () => onOpen(it.path) },
      {
        label: t('在 UE 编辑器打开'),
        icon: AppWindow,
        disabled: !ue.editorOn,
        hint: ue.editorOn ? undefined : t('编辑器没开'),
        onClick: () => void ue.open(it.path),
      },
      'sep',
      { label: t('复制路径'), icon: Copy, onClick: () => copyText(pkgOf(it.path)) },
    ])
  }

  const notes = [
    data?.stat && !data.stat.editor && t('编辑器没开：未保存、未被引用要编辑器开着才看得到'),
    data?.stat?.vcsError && t('P4 状态读不到：{msg}', { msg: data.stat.vcsError }),
    data?.stat?.refsSkipped && t('还有 {n} 个资源没查引用', { n: data.stat.refsSkipped }),
    data?.more && t('只列了前 {n} 项，其余的在左边的搜索框里搜', { n: (data.folders.length ?? 0) + items.length }),
    data?.loading && t('资源注册表还在扫盘，这一层可能不全'),
    data?.note,
  ].filter(Boolean) as string[]

  return (
    <section className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-1 ue:flex-col ue:bg-card">
      <InspectorBar
        canBack={canBack}
        canForward={canForward}
        onBack={onBack}
        onForward={onForward}
        recent={[]}
        onClear={() => undefined}
        crumbs={crumbs}
        actions={
          <>
            <ui.IconButton icon={Copy} label={t('复制路径')} size="sm" onClick={() => copyText(path)} />
            {chat.available && (
              <ui.Button size="sm" variant="secondary" disabled={!data} onClick={send}>
                <MessageSquare className="ue:h-3.5 ue:w-3.5" /> {t('发给对话')}
              </ui.Button>
            )}
          </>
        }
      />
      {error && (
        <div className="ue:px-3 ue:pt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      {busy && !data ? (
        <p className="ue:px-3 ue:py-6 ue:text-center ue:text-footnote ue:text-subtle">{t('读取中…')}</p>
      ) : data ? (
        <FolderTable
          key={path}
          folders={data.folders}
          items={items}
          selected={sel}
          onSelect={setSel}
          onOpen={onOpen}
          onOpenFolder={onFolder}
          onMenu={menu}
          editor={!!data.stat?.editor}
          refsBusy={refsBusy}
          footNote={notes.length ? <span title={notes.join('\n')}>{notes[0]}</span> : undefined}
        />
      ) : null}
      {chat.dialog}
      <MenuHost />
    </section>
  )
}
