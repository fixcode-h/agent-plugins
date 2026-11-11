import { useState } from 'react'
import {
  ChevronRight,
  CopyPlus,
  Folder,
  FolderInput,
  Gamepad2,
  Globe,
  PencilLine,
  Plus,
  Settings2,
  Trash2,
  Palette,
} from 'lucide-react'
import { toast } from '@/lib/toast'
import type { DesignMeta, DesignProject } from '@shared/design'
import { DesignProjectDialog, type DesignProjectSection } from '@/components/design/DesignProjectDialog'
import { api } from '@/lib/api'
import { useNav } from '@/lib/data'
import { useDesignData } from '@/lib/design-store'
import { cn } from '@/lib/utils'
import { DESIGN_HOME, designHomeRoute, designKind, kindFoldKey, kindLabel, toggleFoldKey } from '@/lib/design-projects'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/menu'
import { ConfirmDialog } from '@/components/ui/dialog'
import { IconButton } from '@/components/ui/icon-button'
import { InlineRename } from '@/components/ui/inline-rename'
import { EmptyPanel } from '@/components/ui/empty-panel'
import { Button } from '@/components/ui/button'
import {
  SIDEBAR_BLOCK_ROW_OFF,
  SIDEBAR_BLOCK_ROW_ON,
  SIDEBAR_GROUP_LABEL,
  SidebarCount,
  SidebarProjectName,
  PROJECT_CARD,
  PROJECT_CARD_OFF,
  PROJECT_CARD_ON,
  SidebarTaskBlock,
  TaskRowStatus,
} from '@/components/ui/sidebar'
import { t } from '@shared/i18n'

/**
 * UI 设计整页左边的列表（web/src/plugin/UiDesignPage.tsx）：UI 设计自己的项目（和 Agent 的项目分开），
 * 展开后是这个项目的各个界面。原来是面板 web/src/components/layout/SidebarDesigns.tsx 的 UiDesignList，
 * 模式下拉和插件设计的列表留在面板。
 */
const KINDS = [
  { id: 'game', icon: Gamepad2 },
  { id: 'web', icon: Globe },
] as const

/** 设计模式的侧栏（设计数据见 lib/design-store） */
export function UiDesignList() {
  const { designProjects: projects, setDesignProjects, designs, setDesigns } = useDesignData()
  const { route, go } = useNav()
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState('')
  const [deleting, setDeleting] = useState<DesignMeta>()
  // 新建（null）或编辑项目；undefined 表示没打开
  const [editing, setEditing] = useState<DesignProject | null>()
  const [section, setSection] = useState<DesignProjectSection>('general')
  const [removingProject, setRemovingProject] = useState<DesignProject>()
  const byProject = new Map<string, DesignMeta[]>()
  for (const d of [...designs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
    byProject.set(d.projectId, [...(byProject.get(d.projectId) ?? []), d])
  const last = (pid: string, fallback: string) => byProject.get(pid)?.[0]?.updatedAt ?? fallback
  const list = [...projects].sort((a, b) => last(b.id, b.updatedAt).localeCompare(last(a.id, a.updatedAt)))
  // 项目和分类（`项目id:分类id`）共用一份折叠集合。只有最前面的箭头按钮和分类行改这个集合，
  // 点项目名是打开项目主页，不再顺带折叠
  const toggleFold = (key: string) => setFolded((f) => toggleFoldKey(f, key))

  const rename = async (d: DesignMeta, title: string) => {
    setRenaming('')
    title = title.trim()
    if (!title || title === d.title) return
    try {
      const f = await api.design(d.id)
      await api.saveDesign(d.id, {
        title,
        data: f.data,
        designSize: f.designSize,
        style: f.style,
        root: f.root,
        components: f.components,
        annotations: f.annotations,
        images: f.images,
        animations: f.animations,
      })
      setDesigns((l) => l.map((x) => (x.id === d.id ? { ...x, title } : x)))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const remove = async (d: DesignMeta) => {
    try {
      await api.deleteDesign(d.id)
      setDesigns((l) => l.filter((x) => x.id !== d.id))
      if (route.page === 'design' && route.id === d.id) go({ page: 'design' })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setDeleting(undefined)
    }
  }

  const copy = async (d: DesignMeta) => {
    try {
      const c = await api.copyDesign(d.id)
      setDesigns((l) => [
        ...l,
        {
          id: c.id,
          projectId: c.projectId,
          kind: c.kind,
          title: c.title,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        },
      ])
      go({ page: 'design', id: c.id })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const move = async (d: DesignMeta, projectId: string) => {
    try {
      await api.moveDesign(d.id, projectId)
      setDesigns((l) => l.map((x) => (x.id === d.id ? { ...x, projectId } : x)))
      // 目标项目如果折叠着就展开，能看到移过去的设计
      setFolded((f) => {
        const n = new Set(f)
        n.delete(projectId)
        return n
      })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const removeProject = async (p: DesignProject) => {
    try {
      await api.deleteDesignProject(p.id)
      setDesignProjects((l) => l.filter((x) => x.id !== p.id))
      setDesigns((l) => l.filter((x) => x.projectId !== p.id))
      if (route.page === 'design' && designs.some((d) => d.id === route.id && d.projectId === p.id))
        go({ page: 'design' })
      // 正停在这个项目的主页上：项目没了就回新建设计页
      else if (route.page === 'design' && route.id === DESIGN_HOME && route.sub === p.id) go({ page: 'design' })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRemovingProject(undefined)
    }
  }

  /** 侧栏里的一个设计 */
  const designRow = (d: DesignMeta) => {
    const on = route.page === 'design' && route.id === d.id
    return (
      <ContextMenu key={d.id}>
        <ContextMenuTrigger asChild>
          <div
            // 整行都能点：以前只有文字能点，点到图标或空白处没反应，像是要点两次
            onClick={() => renaming !== d.id && go({ page: 'design', id: d.id })}
            className={cn(
              'ud:ml-1 ud:flex ud:h-[31px] ud:cursor-pointer ud:items-center ud:gap-2 ud:rounded-lg ud:border ud:pr-2 ud:pl-[11px] ud:text-body ud:transition-colors',
              // 设计行和 Agent 项目下的对话行一样：平时无底、悬停浅底，选中是一张白卡片 + 极淡投影
              on ? SIDEBAR_BLOCK_ROW_ON : SIDEBAR_BLOCK_ROW_OFF,
            )}
          >
            {d.kind === 'web' ? (
              <Globe className="ud:h-3.5 ud:w-3.5 ud:shrink-0 ud:text-subtle" />
            ) : (
              <Gamepad2 className="ud:h-3.5 ud:w-3.5 ud:shrink-0 ud:text-subtle" />
            )}
            {renaming === d.id ? (
              <InlineRename
                value={d.title}
                label={t('设计名称')}
                size="sm"
                onCommit={(v) => void rename(d, v)}
                onCancel={() => setRenaming('')}
                className="ud:flex-1"
              />
            ) : (
              // 点击冒泡到整行去跳转；保留按钮是为了能用键盘选中
              <button className="ud:min-w-0 ud:flex-1 ud:cursor-pointer ud:truncate ud:text-left">{d.title}</button>
            )}
            {/* 行尾状态和 Agent 侧栏的对话行同一个部件（设计稿：行尾放「等你 / 进行中」小标签） */}
            {renaming !== d.id && <TaskRowStatus needs={d.asking} running={d.running} />}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => setRenaming(d.id)}>
            <PencilLine className="ud:h-4 ud:w-4" />
            {t('重命名')}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void copy(d)}>
            <CopyPlus className="ud:h-4 ud:w-4" />
            {t('创建副本')}
          </ContextMenuItem>
          {projects.length > 1 && (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <FolderInput className="ud:h-4 ud:w-4" />
                {t('移到项目')}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {projects
                  .filter((x) => x.id !== d.projectId)
                  .map((x) => (
                    <ContextMenuItem key={x.id} onSelect={() => void move(d, x.id)}>
                      <Folder className="ud:h-4 ud:w-4 ud:text-subtle" />
                      {x.name}
                    </ContextMenuItem>
                  ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem danger onSelect={() => setDeleting(d)}>
            <Trash2 className="ud:h-4 ud:w-4" />
            {t('删除')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  return (
    <div className="ud:scroll-fade ud:flex ud:min-h-0 ud:flex-1 ud:flex-col ud:overflow-y-auto ud:px-2.5 ud:pb-2">
      <div className="ud:mb-1.5 ud:flex ud:h-6 ud:shrink-0 ud:items-center ud:pr-1 ud:pl-2">
        {/* 上面的下拉已经写了是 UI 设计，分组标题只写「项目」（照设计稿） */}
        <p className={cn('ud:flex-1 ud:font-semibold ud:tracking-[0.08em]', SIDEBAR_GROUP_LABEL)}>{t('项目')}</p>
        <IconButton icon={Plus} label={t('新建 UI 项目')} onClick={() => setEditing(null)} />
      </div>
      {!projects.length && (
        <EmptyPanel as="div" size="md" className="ud:mx-0.5 ud:mt-1 ud:flex ud:flex-col ud:items-center ud:gap-2">
          <Palette className="ud:h-5 ud:w-5 ud:text-subtle" strokeWidth={2} />
          <p className="ud:text-xs ud:leading-relaxed ud:text-subtle">
            {t('还没有 UI 项目。UI 设计的项目和 Agent 的项目是分开的。')}
          </p>
          <Button variant="link" onClick={() => setEditing(null)} className="ud:text-xs ud:font-medium">
            {t('新建 UI 项目')}
          </Button>
        </EmptyPanel>
      )}
      {list.map((p) => {
        const ds = byProject.get(p.id) ?? []
        const open = !folded.has(p.id)
        const on = route.page === 'design' && route.id === DESIGN_HOME && route.sub === p.id
        return (
          <section key={p.id} className="ud:mb-1 ud:flex ud:flex-col">
            <ContextMenu>
              <ContextMenuTrigger asChild>
                {/* 整行只是排成一行的容器：点空白处不展开也不打开，展开 / 打开各有自己的按钮；
                    折叠箭头在卡片外，和 Agent 侧栏的项目卡片一样（照设计稿 Workspace 侧栏） */}
                <div className="ud:group/proj ud:flex ud:items-center ud:gap-1">
                  <button
                    // 折叠只由这个箭头按钮触发：以前整行可点、靠冒泡折叠，点项目名打不开主页
                    onClick={() => toggleFold(p.id)}
                    // 界面检查按项目定位这个按钮：侧栏里 Agent 项目行也有同名「收起」按钮，不能靠 DOM 顺序取第一个
                    data-fold={p.id}
                    aria-expanded={open}
                    aria-label={open ? t('收起') : t('展开')}
                    disabled={!ds.length}
                    className={cn(
                      'ud:grid ud:h-6 ud:w-3 ud:shrink-0 ud:cursor-pointer ud:place-items-center ud:rounded-md ud:text-subtle ud:transition-colors ud:hover:text-fg',
                      !ds.length && 'ud:invisible',
                    )}
                  >
                    <ChevronRight
                      className={cn('ud:h-3 ud:w-3 ud:transition-transform', open && 'ud:rotate-90')}
                      strokeWidth={2.3}
                    />
                  </button>
                  <div className={cn(PROJECT_CARD, on ? PROJECT_CARD_ON : PROJECT_CARD_OFF)}>
                    <button
                      onClick={() => go(designHomeRoute(p.id))}
                      aria-label={t('打开项目「{name}」，右键查看更多操作', { name: p.name })}
                      title={t('打开项目「{name}」，右键查看更多操作', { name: p.name })}
                      className="ud:flex ud:min-w-0 ud:flex-1 ud:cursor-pointer ud:items-center ud:gap-2 ud:text-left"
                    >
                      <SidebarProjectName open={open} on={on} name={p.name} />
                    </button>
                    {ds.length > 0 && <SidebarCount n={ds.length} on={on} className="ud:group-hover/proj:hidden" />}
                    <IconButton
                      icon={Plus}
                      onClick={() => go({ page: 'design', id: 'new', sub: p.id })}
                      label={t('在「{name}」新建设计', { name: p.name })}
                      title={t('新建设计')}
                      className={cn(
                        ds.length ? 'ud:hidden' : 'ud:opacity-60',
                        'ud:group-hover/proj:grid ud:group-hover/proj:opacity-100',
                      )}
                    />
                  </div>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => go({ page: 'design', id: 'new', sub: p.id })}>
                  <Plus className="ud:h-4 ud:w-4" />
                  {t('新建设计')}
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => (setSection('general'), setEditing(p))}>
                  <Settings2 className="ud:h-4 ud:w-4" />
                  {t('项目设置')}
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => (setSection('prompts'), setEditing(p))}>
                  <Palette className="ud:h-4 ud:w-4" />
                  {t('美术提示词')}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem danger onSelect={() => setRemovingProject(p)}>
                  <Trash2 className="ud:h-4 ud:w-4" />
                  {t('删除项目')}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
            {open && ds.length > 0 && (
              <SidebarTaskBlock>
                {/* 同一个项目里游戏 UI 和网页 UI 分开列，各自可以收起 */}
                {KINDS.filter((k) => ds.some((d) => designKind(d) === k.id)).map((k) => {
                  const list = ds.filter((d) => designKind(d) === k.id)
                  const key = kindFoldKey(p.id, k.id)
                  const kOpen = !folded.has(key)
                  return (
                    <div key={k.id} className="ud:flex ud:flex-col ud:gap-px">
                      <button
                        data-kind={k.id}
                        onClick={() => toggleFold(key)}
                        aria-expanded={kOpen}
                        className="ud:ml-1 ud:flex ud:h-7 ud:cursor-pointer ud:items-center ud:gap-1.5 ud:rounded-lg ud:pr-2 ud:pl-[9px] ud:text-footnote ud:text-subtle ud:transition-colors ud:hover:bg-sel ud:hover:text-fg"
                      >
                        <ChevronRight
                          className={cn('ud:h-3 ud:w-3 ud:shrink-0 ud:transition-transform', kOpen && 'ud:rotate-90')}
                        />
                        <k.icon className="ud:h-3.5 ud:w-3.5 ud:shrink-0" />
                        <span className="ud:min-w-0 ud:flex-1 ud:truncate ud:text-left">{kindLabel(k.id)}</span>
                        <span className="ud:shrink-0 ud:text-caption ud:tabular-nums">{list.length}</span>
                      </button>
                      {kOpen && <div className="ud:ml-2 ud:flex ud:flex-col ud:gap-px">{list.map(designRow)}</div>}
                    </div>
                  )
                })}
              </SidebarTaskBlock>
            )}
          </section>
        )
      })}
      <DesignProjectDialog
        open={editing !== undefined}
        onOpenChange={(o) => !o && setEditing(undefined)}
        project={editing ?? undefined}
        section={editing ? section : 'general'}
        onSaved={(np) => !editing && go({ page: 'design', id: 'new', sub: np.id })}
      />
      <ConfirmDialog
        open={!!removingProject}
        onOpenChange={(o) => !o && setRemovingProject(undefined)}
        title={t('删除项目「{name}」？', { name: removingProject?.name ?? '' })}
        description={t('会一起删除这个项目里的 {n} 个设计和它们的图片，本机目录里导出的文件不受影响。', {
          n: designs.filter((d) => d.projectId === removingProject?.id).length,
        })}
        onConfirm={() => removingProject && removeProject(removingProject)}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title={t('删除「{name}」？', { name: deleting?.title ?? '' })}
        description={t('会删除这个设计的控件树、对话和生成的图片。')}
        onConfirm={() => deleting && void remove(deleting)}
      />
    </div>
  )
}
