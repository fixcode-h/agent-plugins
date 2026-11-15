import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { TabBar, TabItem } from '@/components/ui/tab-bar'
import { toast } from '@/lib/toast'
import {
  Brush,
  Copy,
  Download,
  Frame,
  Globe,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  Lock,
  MoreHorizontal,
  Network,
  PanelsTopLeft,
  Play,
  Plus,
  RectangleHorizontal,
  Shapes,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  LOCAL_MODELS,
  WORKFLOW_USES,
  WORKFLOW_USE_LABEL,
  autoPlaceholders,
  checkWorkflow,
  localFile,
  localModel,
  importedWorkflow,
  needsInputImage,
  type ComfyWorkflow,
  type WorkflowUse,
} from '@shared/local-image'
import { t } from '@shared/i18n'
import { api } from '@/lib/api'
import { useNav } from '@/lib/data'
import { comfyRoute } from '@/lib/comfy-nav'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Segmented } from '@/components/ui/segmented'
import { ChipGroup } from '@/components/ui/chip-group'
import { Progress } from '@/components/ui/progress'
import { Menu, MenuContent, MenuItem, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/components/ui/menu'
import { ConfirmDialog } from '@/components/ui/dialog'
import { ComfyWebDialog } from '@/components/comfy/ComfyWeb'
import { useLocalImage } from '@/components/settings/LocalImageSection'
import { ComfyGraphView, ComfyValueField, nodeTone } from '@/components/comfy/ComfyGraphView'
import { ComfyQueuePanel } from '@/components/comfy/ComfyQueuePanel'
import { ComfyChainPanel } from '@/components/comfy/ComfyChainPanel'
import { TemplateStore } from '@/components/comfy/TemplateStore'

type Kind = 'game' | 'web'
type View = 'graph' | 'json'
type Side = 'about' | 'node' | 'models' | 'queue'
type Source = 'all' | 'builtin' | 'mine' | 'imported'
const VIEW_KEY = 'agent-panel:comfy-view'
const loadView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'json' ? 'json' : 'graph'
  } catch {
    return 'graph'
  }
}
const newId = () => `wf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** 列表按分类分组（照设计稿）：游戏、网页各一组，去背景、放大这类处理工作流两边都能用，单独一组 */
const GROUPS: { kind: ComfyWorkflow['kind']; title: string }[] = [
  { kind: 'game', title: t('游戏 UI') },
  { kind: 'web', title: t('网页 UI') },
  { kind: 'both', title: t('图片处理') },
]

/** 列表里的缩略块：没有出过图的工作流也要能一眼分开，按用途给一个颜色和图标 */
const USE_LOOK: Record<WorkflowUse, { color: string; icon: LucideIcon }> = {
  icon: { color: '#7C3AED', icon: Shapes },
  button: { color: '#C98A1B', icon: RectangleHorizontal },
  panel: { color: '#0E6E79', icon: PanelsTopLeft },
  background: { color: '#3D4A63', icon: ImageIcon },
  concept: { color: '#2B3A55', icon: Frame },
  illustration: { color: '#4F46E5', icon: Brush },
  any: { color: '#64748B', icon: Sparkles },
}

/** 画布下面浮着的试生成条占的高度；上面标题 + 工具条的高度量出来（窄了会折成两行） */
const CANVAS_BOTTOM = 76

/** 一次试生成：只在这一页里记着，换页就没了（正式出图在 UI 设计里） */
interface TryRun {
  id: string
  workflow: string
  prompt: string
  status: 'running' | 'done' | 'failed'
  images: string[]
  error?: string
  startedAt: number
  ms?: number
}

/**
 * ComfyUI 工作流管理（照设计稿 ComfyUI 画板）：左边是按分类分组的工作流列表和 ComfyUI 的运行状态，
 * 中间整块是节点图画布（上面浮着工具条，下面是试生成），右栏分「说明 / 节点 / 模型 / 队列」。
 * 内置的是调好的工作流（只读，可以复制后改）；自己的可以手动改、从 ComfyUI 导入、让 AI 生成或优化。
 * UI 设计生成图片时选「本机」就会用到这里的工作流
 */
export function ComfyPage({ path }: { path: string }) {
  const { go, openSettings } = useNav()
  // 地址 #/plugin/comfy/comfy/<game|web>/<工作流 id>（原来是面板自带的 #/comfy/<分类>/<工作流>）
  const [kindSeg = '', wfSeg = ''] = path.split('/')
  const [data, setData] = useState<{ list: ComfyWorkflow[]; ready: string[] }>()
  const [sel, setSel] = useState(wfSeg)
  const [draft, setDraft] = useState<ComfyWorkflow | null>(null)
  const [graphText, setGraphText] = useState('')
  const [note, setNote] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [ask, setAsk] = useState<{ mode: 'create' | 'optimize'; text?: string } | null>(null)
  const [importing, setImporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [web, setWeb] = useState(false)
  const [side, setSide] = useState<Side>('about')
  const [source, setSource] = useState<Source>('all')
  /** 画布上点中的节点：右栏「节点」页签显示它的参数 */
  const [node, setNode] = useState('')
  /** 「整理」：每点一次加一，节点图把节点摆回自动排布 */
  const [layoutToken, setLayoutToken] = useState(0)
  const [tryText, setTryText] = useState('')
  const [trySize, setTrySize] = useState(TRY_SIZES[0].id)
  const [tryCount, setTryCount] = useState(1)
  const [tries, setTries] = useState<TryRun[]>([])
  /** 刚导入到 ComfyUI 的工作流：网页弹窗顶部告诉用户去侧栏哪里打开 */
  const [webImported, setWebImported] = useState<{ name: string; filename: string } | null>(null)
  const [pushing, setPushing] = useState(false)
  const [store, setStore] = useState(false)
  const [st, setSt] = useLocalImage()
  // 标题和工具条放不下一行时折成两行：量出实际高度，节点图适应时让开
  const [topInset, setTopInset] = useState(64)
  const topBar = useRef<ResizeObserver | null>(null)
  const measureTop = useCallback((el: HTMLDivElement | null) => {
    topBar.current?.disconnect()
    if (!el) return
    const ro = new ResizeObserver(() => setTopInset(Math.round(el.offsetHeight) + 20))
    ro.observe(el)
    topBar.current = ro
  }, [])
  const inset = useMemo(() => ({ top: topInset, bottom: CANVAS_BOTTOM }), [topInset])
  const [view, setViewState] = useState<View>(loadView)
  const setView = (v: View) => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // 存不了就只在这次有效
    }
  }

  const load = () =>
    api
      .comfyWorkflows()
      .then(setData)
      .catch((e) => toast.error((e as Error).message))
  useEffect(() => {
    void load()
  }, [])

  const list = useMemo(() => data?.list ?? [], [data])
  // 没指定工作流时：#/plugin/comfy/comfy/web 选第一个网页的，其余选第一个游戏的
  const current =
    list.find((w) => w.id === sel) ?? list.find((w) => w.kind === (kindSeg === 'web' ? 'web' : 'game')) ?? list[0]
  // 换了选中的工作流：编辑区换成它（新建、AI 结果还没保存时保留草稿）
  useEffect(() => {
    if (!current || (draft && dirty)) return
    setDraft(current)
    setGraphText(JSON.stringify(current.graph, null, 2))
    setNote('')
    setDirty(false)
    setNode('')
    // 只在选中的工作流变化时重置
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.updatedAt])
  /** AI 生成、导入、模板商店默认按当前工作流的分类来 */
  const kind: Kind = (draft ?? current)?.kind === 'web' ? 'web' : 'game'

  const pick = (w: ComfyWorkflow) => {
    if (w.id === draft?.id) return
    if (dirty && !confirm(t('还有没保存的修改，确定放弃？'))) return
    setDirty(false)
    setDraft(null)
    setSel(w.id)
    go(comfyRoute(w.kind === 'web' ? 'web' : 'game', w.id))
  }
  const openDraft = (w: ComfyWorkflow, why = '') => {
    setDraft(w)
    setGraphText(JSON.stringify(w.graph, null, 2))
    setNote(why)
    setDirty(true)
    setSel(w.id)
    setNode('')
  }
  const edit = (patch: Partial<ComfyWorkflow>) => {
    if (!draft) return
    setDraft({ ...draft, ...patch })
    setDirty(true)
  }

  // 节点图的 JSON 改到一半可能不合法：合法时才检查
  const graph = useMemo(() => {
    try {
      return JSON.parse(graphText) as ComfyWorkflow['graph']
    } catch {
      return null
    }
  }, [graphText])
  const problems = graph ? checkWorkflow(graph) : [t('节点图不是合法的 JSON')]
  // 图上改了值，写回 JSON；保持引用不变，免得节点图每次渲染都重建
  const onGraph = useCallback((g: ComfyWorkflow['graph']) => {
    setGraphText(JSON.stringify(g, null, 2))
    setDirty(true)
  }, [])
  const onPickNode = useCallback((id: string) => {
    setNode(id)
    setSide('node')
  }, [])
  const readOnly = !!draft?.builtin
  const ready = (w: ComfyWorkflow) => !!data?.ready.includes(w.id)

  const save = async () => {
    if (!draft || !graph || problems.length) return
    setSaving(true)
    try {
      const saved = await api.saveComfyWorkflow({ ...draft, graph })
      toast.success(t('已保存'))
      setDirty(false)
      setNote('')
      await load()
      setSel(saved.id)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const duplicate = () =>
    draft &&
    openDraft({
      ...draft,
      id: newId(),
      name: t('{name}（副本）', { name: draft.name }),
      builtin: undefined,
      graph: graph ?? draft.graph,
    })

  /** 面板 → ComfyUI：把当前工作流写进它的工作流列表；有没保存的修改先保存（ComfyUI 读的是存下来的那份） */
  const pushToComfy = async (o: { openWeb?: boolean; quiet?: boolean } = {}) => {
    if (!draft || pushing) return
    setPushing(true)
    // 先打开网页：ComfyUI 没启动时这里会显示「正在启动并导入」，不用等按钮转完才看到反应
    if (o.openWeb) {
      setWebImported(null)
      setWeb(true)
    }
    try {
      if (dirty) {
        if (!graph || problems.length) {
          toast.error(t('节点图有问题，先修好再导入'))
          return
        }
        await save()
      }
      const r = await api.importComfyWorkflow(draft.id)
      setWebImported(r)
      if (!o.quiet) toast.success(t('已导入到 ComfyUI 的工作流列表：{name}', { name: r.name }))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setPushing(false)
    }
  }
  // 打开网页时把当前工作流一起带过去；有没保存的修改时不自动导入，免得把旧的内容推过去
  const openWeb = () => {
    setWebImported(null)
    setWeb(true)
    if (draft && dirty) toast.message(t('有没保存的修改：保存后才会把工作流导入到 ComfyUI'))
    else if (draft) void pushToComfy({ quiet: true })
  }

  const exportJson = () => {
    if (!draft) return
    const blob = new Blob([JSON.stringify(graph ?? draft.graph, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${draft.name}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const draftIsNew = !!draft && !list.some((w) => w.id === draft.id)
  // 试生成跑的是存下来的那份（服务端按 id 取工作流），所以没保存、要原图的工作流先拦下并说清楚
  const tryBlock = !draft
    ? t('选一个工作流')
    : dirty || draftIsNew
      ? t('先保存再试生成：试生成用的是保存的那份')
      : graph && needsInputImage(graph)
        ? t('这个工作流要一张原图，到「队列」里的工作流链选图试跑')
        : ''
  /** 试生成：把当前工作流当成只有一段的工作流链跑一次，出图显示在「队列」页签里 */
  const tryRun = async () => {
    if (!draft || tryBlock) return
    const run: TryRun = {
      id: newId(),
      workflow: draft.name,
      prompt: tryText.trim(),
      status: 'running',
      images: [],
      startedAt: Date.now(),
    }
    setTries((xs) => [run, ...xs].slice(0, 8))
    setSide('queue')
    const patch = (p: Partial<TryRun>) => setTries((xs) => xs.map((x) => (x.id === run.id ? { ...x, ...p } : x)))
    try {
      const r = await api.runComfyChain(
        { id: `try_${draft.id}`, name: draft.name, steps: [{ workflowId: draft.id, prompt: '' }], updatedAt: '' },
        undefined,
        run.prompt,
        { ...(TRY_SIZES.find((x) => x.id === trySize) ?? TRY_SIZES[0]), count: tryCount },
      )
      patch({ status: 'done', images: r.images, ms: Date.now() - run.startedAt })
    } catch (e) {
      // 出错原样告诉用户（例如模型没下载、ComfyUI 没装），不悄悄重试
      const error = (e as Error).message
      patch({ status: 'failed', error, ms: Date.now() - run.startedAt })
      toast.error(error)
    }
  }

  const shown = list.filter((w) =>
    source === 'all'
      ? true
      : source === 'builtin'
        ? w.builtin
        : source === 'imported'
          ? !w.builtin && importedWorkflow(w)
          : !w.builtin && !importedWorkflow(w),
  )
  const model = draft?.model ? localModel(draft.model) : undefined
  const picked = node && graph?.[node] ? { id: node, ...graph[node] } : undefined
  const runningTries = tries.filter((x) => x.status === 'running').length
  const comfyState = !st
    ? t('读取中…')
    : st.running
      ? t('ComfyUI 运行中')
      : st.installed || st.external
        ? t('ComfyUI 没在运行')
        : t('还没安装 ComfyUI')

  return (
    <main className="cf:flex cf:min-w-0 cf:flex-1 cf:flex-col cf:gap-2 cf:overflow-y-auto cf:p-2 cf:lg:h-full cf:lg:flex-row cf:lg:overflow-hidden cf:lg:py-2 cf:lg:pr-2 cf:lg:pl-0.5">
      {/* 左：工作流列表（照设计稿的 268px 一栏，宽屏时会话侧栏让开，这一栏就是这页的侧栏） */}
      <section
        aria-label={t('工作流列表')}
        className="cf:flex cf:max-h-[46vh] cf:shrink-0 cf:flex-col cf:gap-2.5 cf:lg:max-h-none cf:lg:w-[268px] cf:lg:py-1"
      >
        <div className="cf:flex cf:flex-wrap cf:items-center cf:gap-1.5 cf:px-1.5">
          <h1 className="cf:min-w-[110px] cf:flex-1 cf:truncate cf:text-heading cf:font-semibold">{t('ComfyUI 工作流')}</h1>
          {/* 照设计稿：标题和两个小按钮挤在一行（28px 高、12px 字），放不下才折行 */}
          <Button size="sm" variant="secondary" className="cf:h-7 cf:px-2 cf:text-footnote" onClick={() => setImporting(true)}>
            {t('导入')}
          </Button>
          <Button size="sm" className="cf:h-7 cf:px-2 cf:text-footnote cf:font-semibold" onClick={() => setAsk({ mode: 'create' })}>
            <Sparkles className="cf:h-3.5 cf:w-3.5" />
            {t('AI 生成')}
          </Button>
        </div>
        <Segmented
          label={t('工作流来源')}
          size="sm"
          fill
          className="cf:mx-1"
          value={source}
          onChange={setSource}
          options={[
            { id: 'all', label: t('全部') },
            { id: 'builtin', label: t('内置') },
            { id: 'mine', label: t('我的') },
            { id: 'imported', label: t('导入的') },
          ]}
        />
        <div className="cf:flex cf:min-h-0 cf:flex-1 cf:flex-col cf:gap-0.5 cf:overflow-y-auto cf:px-1">
          {!data ? (
            <p className="cf:p-3 cf:text-body cf:text-subtle">{t('读取中…')}</p>
          ) : (
            <>
              {draftIsNew && (
                <ListGroup title={t('未保存')}>
                  <WorkflowRow w={draft} on ready={false} onPick={() => {}} />
                </ListGroup>
              )}
              {GROUPS.map((g) => {
                const items = shown.filter((w) => w.kind === g.kind)
                return (
                  items.length > 0 && (
                    <ListGroup key={g.kind} title={g.title}>
                      {items.map((w) => (
                        <WorkflowRow key={w.id} w={w} on={draft?.id === w.id} ready={ready(w)} onPick={() => pick(w)} />
                      ))}
                    </ListGroup>
                  )
                )
              })}
              {!shown.length && (
                <p className="cf:px-2 cf:py-4 cf:text-footnote cf:leading-relaxed cf:text-subtle">
                  {t('还没有，可以导入或让 AI 生成')}
                </p>
              )}
              <button
                type="button"
                onClick={() => setStore(true)}
                className="cf:mt-2 cf:flex cf:h-9 cf:shrink-0 cf:cursor-pointer cf:items-center cf:justify-center cf:gap-1.5 cf:rounded-xl border cf:border-dashed cf:border-line-strong cf:text-body cf:text-muted cf:transition-colors cf:hover:bg-sel/60 cf:hover:text-fg"
              >
                <LayoutGrid className="cf:h-3.5 cf:w-3.5" />
                {t('模板商店')}
              </button>
            </>
          )}
        </div>
        {/* ComfyUI 的运行状态：出图、导入都要它在跑，放在列表底下常驻 */}
        <div className="cf:mx-1 cf:flex cf:items-center cf:gap-2 cf:rounded-xl cf:bg-card cf:px-2.5 cf:py-2 cf:shadow-[0_0_0_1px_var(--line)]">
          <span
            aria-hidden
            className={cn(
              'cf:h-2 cf:w-2 cf:shrink-0 cf:rounded-full',
              st?.running
                ? 'cf:bg-success cf:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-success)_18%,transparent)]'
                : 'cf:bg-line-strong',
            )}
          />
          <span className="cf:flex cf:min-w-0 cf:flex-1 cf:flex-col">
            <span className="cf:truncate cf:text-body cf:font-semibold">{comfyState}</span>
            {st && (
              <span className="cf:truncate cf:font-mono cf:text-caption cf:text-subtle">
                {[st.url.replace(/^https?:\/\//, ''), st.gpuName].filter(Boolean).join(' · ')}
              </span>
            )}
          </span>
          <Button size="sm" variant="ghost" className="cf:h-7 cf:px-2" onClick={() => openSettings('local-image')}>
            {t('本机设置')}
          </Button>
        </div>
      </section>

      {/* 中：整块节点图画布，标题和工具条浮在上面，试生成浮在下面（照设计稿） */}
      <section aria-label={t('节点图')} className="panel cf:relative cf:min-h-[70vh] cf:min-w-0 cf:flex-1 cf:@container cf:lg:min-h-0">
        {!draft ? (
          <p className="cf:p-8 cf:text-center cf:text-body cf:text-subtle">{t('选一个工作流查看和修改')}</p>
        ) : (
          <>
            <div className="cf:absolute cf:inset-0">
              {graph && view === 'graph' ? (
                <ComfyGraphView
                  fill
                  graph={graph}
                  readOnly={readOnly}
                  onChange={onGraph}
                  inset={inset}
                  selected={node}
                  onSelect={onPickNode}
                  layoutToken={layoutToken}
                />
              ) : (
                <Textarea
                  spellCheck={false}
                  aria-label={t('节点图（ComfyUI 接口格式）')}
                  value={graphText}
                  readOnly={readOnly}
                  onChange={(e) => {
                    setGraphText(e.target.value)
                    setDirty(true)
                  }}
                  style={{ top: inset.top, bottom: inset.bottom }}
                  className="cf:absolute cf:right-4 cf:left-4 cf:h-auto cf:resize-none cf:font-mono cf:text-footnote cf:leading-[1.5]"
                />
              )}
            </div>

            <div
              ref={measureTop}
              className="cf:pointer-events-none cf:absolute cf:inset-x-3 cf:top-3 cf:z-[5] cf:flex cf:flex-wrap cf:items-start cf:justify-end cf:gap-x-3 cf:gap-y-2"
            >
              <div className="cf:pointer-events-auto cf:flex cf:min-w-[160px] cf:flex-1 cf:basis-[160px] cf:flex-col cf:gap-0.5 cf:pt-0.5 cf:pl-1">
                <div className="cf:flex cf:min-w-0 cf:items-center cf:gap-1.5">
                  <span className="cf:truncate cf:text-heading cf:font-semibold">{draft.name}</span>
                  {dirty && <span className="cf:shrink-0 cf:text-caption cf:text-warning">{t('未保存')}</span>}
                </div>
                <div className="cf:flex cf:min-w-0 cf:flex-wrap cf:items-center cf:gap-1.5 cf:text-footnote cf:text-subtle">
                  {readOnly && (
                    <span className="cf:inline-flex cf:items-center cf:gap-1 cf:rounded-md cf:bg-sel cf:px-1.5 cf:py-px cf:text-muted">
                      <Lock className="cf:h-3 cf:w-3" />
                      {t('内置，只读')}
                    </span>
                  )}
                  {model && (
                    <span
                      className={cn(
                        'cf:rounded-md cf:px-1.5 cf:py-px',
                        ready(draft) ? 'cf:bg-success/10 cf:text-success' : 'cf:bg-warning/10 cf:text-warning',
                      )}
                    >
                      {ready(draft)
                        ? t('{name} 已下载', { name: model.name })
                        : t('需要先下载 {name}', { name: model.name })}
                    </span>
                  )}
                  {problems.length > 0 && (
                    <span className="cf:rounded-md cf:bg-danger/10 cf:px-1.5 cf:py-px cf:text-danger">
                      {t('{n} 个问题', { n: problems.length })}
                    </span>
                  )}
                  {draft.description && <span className="cf:truncate">{draft.description}</span>}
                </div>
              </div>
              <div
                role="toolbar"
                aria-label={t('工作流工具')}
                className="cf:pointer-events-auto cf:flex cf:shrink-0 cf:items-center cf:gap-0.5 cf:rounded-2xl cf:bg-card cf:p-1 cf:shadow-pop"
              >
                <Tool icon={Wand2} label={t('AI 优化')} tone="peer" onClick={() => setAsk({ mode: 'optimize' })} />
                <Tool
                  icon={Network}
                  wide
                  label={t('整理')}
                  title={t('把节点摆回自动排布的位置')}
                  disabled={view !== 'graph' || !graph}
                  onClick={() => setLayoutToken((n) => n + 1)}
                />
                <Sep />
                <Tool
                  icon={pushing ? Loader2 : Upload}
                  spin={pushing}
                  label={t('导入到 ComfyUI')}
                  title={t('把当前工作流导入到 ComfyUI 的工作流列表，在 ComfyUI 网页里打开')}
                  disabled={pushing}
                  onClick={() => void pushToComfy({ openWeb: true })}
                />
                <Tool
                  icon={Globe}
                  wide
                  label={t('ComfyUI 网页')}
                  title={t('在面板里打开 ComfyUI 的网页')}
                  onClick={openWeb}
                  dot={st?.running ? 'cf:bg-success' : 'cf:bg-line-strong'}
                />
                <Segmented
                  label={t('节点图的显示方式')}
                  size="sm"
                  className="cf:mx-1"
                  value={graph ? view : 'json'}
                  onChange={setView}
                  options={[
                    // JSON 改坏了画不出图，只能先在配置里改好
                    { id: 'graph', label: t('图形'), disabled: !graph },
                    { id: 'json', label: t('配置') },
                  ]}
                />
                <Menu>
                  <MenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={t('更多')}
                      title={t('更多')}
                      className="grid cf:h-8 cf:w-8 cf:cursor-pointer cf:place-items-center cf:rounded-xl cf:text-muted cf:transition-colors cf:hover:bg-sel cf:hover:text-fg"
                    >
                      <MoreHorizontal className="cf:h-4 cf:w-4" />
                    </button>
                  </MenuTrigger>
                  <MenuContent>
                    <MenuItem onSelect={exportJson}>
                      <Download className="cf:h-3.5 cf:w-3.5" />
                      {t('导出 JSON')}
                    </MenuItem>
                    <MenuItem onSelect={duplicate}>
                      <Copy className="cf:h-3.5 cf:w-3.5" />
                      {t('复制')}
                    </MenuItem>
                    {!readOnly && !draftIsNew && (
                      <MenuItem danger onSelect={() => setDeleting(true)}>
                        <Trash2 className="cf:h-3.5 cf:w-3.5" />
                        {t('删除')}
                      </MenuItem>
                    )}
                  </MenuContent>
                </Menu>
                <Sep />
                {readOnly ? (
                  // 内置的只读：主按钮换成复制（字短，工具条才放得下标题），说明放在悬停提示里
                  <Button size="sm" className="cf:rounded-xl" onClick={duplicate} title={t('复制后修改')}>
                    <Copy className="cf:h-3.5 cf:w-3.5" />
                    {t('复制')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="cf:rounded-xl cf:font-semibold"
                    onClick={() => void save()}
                    disabled={!dirty || saving || problems.length > 0}
                  >
                    {saving && <Loader2 className="cf:h-3.5 cf:w-3.5 cf:animate-spin" />}
                    {t('保存')}
                  </Button>
                )}
              </div>
            </div>

            {note && (
              <div
                style={{ top: inset.top - 8 }}
                className="cf:absolute cf:left-4 cf:z-[5] cf:flex cf:max-w-md cf:items-start cf:gap-2 cf:rounded-xl cf:bg-accent-soft cf:px-3 cf:py-2 cf:text-body cf:leading-relaxed cf:shadow-pop"
              >
                <p className="cf:min-w-0 cf:flex-1 cf:whitespace-pre-wrap">{note}</p>
                <button
                  type="button"
                  aria-label={t('关闭')}
                  onClick={() => setNote('')}
                  className="cf:shrink-0 cf:cursor-pointer cf:text-subtle cf:hover:text-fg"
                >
                  <X className="cf:h-3.5 cf:w-3.5" />
                </button>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault()
                void tryRun()
              }}
              className="cf:absolute cf:bottom-4 cf:left-1/2 cf:z-[5] cf:flex cf:w-[min(620px,calc(100%-2rem))] cf:-translate-x-1/2 cf:items-center cf:gap-2 cf:rounded-2xl cf:bg-card cf:py-1.5 cf:pr-1.5 cf:pl-3.5 cf:shadow-pop"
            >
              <span className="cf:shrink-0 cf:text-caption cf:font-semibold cf:tracking-[0.06em] cf:text-subtle">{t('试生成')}</span>
              <input
                aria-label={t('试生成的描述')}
                value={tryText}
                onChange={(e) => setTryText(e.target.value)}
                placeholder={tryBlock || t('写一句描述，用这个工作流出一张图看看')}
                className="cf:min-w-0 cf:flex-1 cf:border-0 cf:bg-transparent cf:text-prose cf:outline-none cf:placeholder:text-subtle"
              />
              <TryPick
                label={t('试生成的尺寸')}
                value={trySize}
                onChange={setTrySize}
                options={TRY_SIZES.map((x) => ({ id: x.id, label: x.label }))}
              />
              <TryPick
                label={t('试生成的张数')}
                value={String(tryCount)}
                onChange={(v) => setTryCount(Number(v))}
                options={[1, 2, 3, 4].map((n) => ({ id: String(n), label: `× ${n}` }))}
              />
              <Button
                type="submit"
                size="sm"
                className="cf:rounded-xl cf:font-semibold"
                disabled={!!tryBlock}
                title={tryBlock}
              >
                <Play className="cf:h-3 cf:w-3 cf:fill-current" />
                {t('生成')}
              </Button>
            </form>
          </>
        )}
      </section>

      {/* 右：说明 / 节点 / 模型 / 队列 */}
      <aside
        aria-label={t('工作流详情')}
        className="panel cf:flex cf:min-h-[60vh] cf:shrink-0 cf:flex-col cf:lg:min-h-0 cf:lg:w-[330px] cf:2xl:w-[360px]"
      >
        <TabBar label={t('工作流详情')}>
          <TabItem fill active={side === 'about'} onSelect={() => setSide('about')}>
            {t('说明')}
          </TabItem>
          <TabItem fill active={side === 'node'} onSelect={() => setSide('node')}>
            {t('节点')}
          </TabItem>
          <TabItem fill active={side === 'models'} onSelect={() => setSide('models')}>
            {t('模型')}
          </TabItem>
          <TabItem
            fill
            active={side === 'queue'}
            onSelect={() => setSide('queue')}
            tag={runningTries ? <Count n={runningTries} /> : undefined}
          >
            {t('队列')}
          </TabItem>
        </TabBar>
        <div className="cf:min-h-0 cf:flex-1 cf:overflow-y-auto cf:p-3.5">
          {side === 'queue' ? (
            <div className="cf:flex cf:flex-col cf:gap-4">
              {tries.length > 0 && (
                <section className="cf:flex cf:flex-col cf:gap-2">
                  <Label>{t('试生成')}</Label>
                  {tries.map((x) => (
                    <TryCard key={x.id} run={x} />
                  ))}
                </section>
              )}
              <ComfyQueuePanel />
              <ComfyChainPanel kind={kind} />
            </div>
          ) : !draft ? (
            <p className="cf:py-6 cf:text-center cf:text-body cf:text-subtle">{t('选一个工作流查看和修改')}</p>
          ) : side === 'node' ? (
            !picked ? (
              <p className="cf:py-6 cf:text-center cf:text-body cf:leading-relaxed cf:text-subtle">
                {t('在画布上点一个节点，这里显示它的参数')}
              </p>
            ) : (
              <div className="cf:flex cf:flex-col cf:gap-3.5">
                <div className="cf:flex cf:items-center cf:gap-2">
                  <span
                    aria-hidden
                    className="cf:h-3 cf:w-3 cf:shrink-0 cf:rounded-full"
                    style={{ background: nodeTone(picked.class_type) }}
                  />
                  <span className="cf:min-w-0 cf:flex-1 cf:truncate cf:text-prose cf:font-semibold">
                    {String((picked as { _meta?: { title?: string } })._meta?.title ?? '') || picked.class_type}
                  </span>
                  <span className="cf:shrink-0 cf:font-mono cf:text-caption cf:text-subtle">
                    {picked.class_type} · #{picked.id}
                  </span>
                </div>
                {Object.entries(picked.inputs).map(([key, v]) => {
                  const link =
                    Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' ? (v as [string, number]) : null
                  return (
                    <div key={key} className="cf:flex cf:min-w-0 cf:flex-col cf:gap-1.5">
                      <Label>{key}</Label>
                      {link ? (
                        <button
                          type="button"
                          onClick={() => setNode(link[0])}
                          className="cf:flex cf:h-8 cf:cursor-pointer cf:items-center cf:gap-2 cf:rounded-lg cf:bg-field cf:px-2.5 cf:text-left cf:font-mono cf:text-footnote cf:text-muted cf:hover:text-fg"
                        >
                          <span
                            aria-hidden
                            className="cf:h-2 cf:w-2 cf:rounded-full"
                            style={{ background: nodeTone(graph?.[link[0]]?.class_type ?? '') }}
                          />
                          ← #{link[0]} {graph?.[link[0]]?.class_type ?? ''}
                          {link[1] ? ` · ${link[1]}` : ''}
                        </button>
                      ) : (
                        <ComfyValueField
                          label={key}
                          value={v}
                          readOnly={readOnly}
                          className="cf:h-8 cf:rounded-lg cf:px-2.5 cf:text-footnote"
                          onChange={(nv) =>
                            graph &&
                            onGraph({
                              ...graph,
                              [picked.id]: { ...graph[picked.id], inputs: { ...graph[picked.id].inputs, [key]: nv } },
                            })
                          }
                        />
                      )}
                    </div>
                  )
                })}
                <span className="cf:text-footnote cf:leading-relaxed cf:text-subtle">
                  {readOnly
                    ? t('内置工作流只读，复制后再改。')
                    : t('改了参数会标「未保存」；保存后导入到 ComfyUI、试生成才用新的。')}
                </span>
              </div>
            )
          ) : side === 'models' ? (
            <ModelsTab draft={draft} st={st} onStatus={setSt} />
          ) : (
            <div className="cf:flex cf:flex-col cf:gap-3.5">
              <Field label={t('名称')}>
                <Input value={draft.name} disabled={readOnly} onChange={(e) => edit({ name: e.target.value })} />
              </Field>
              <div className="cf:flex cf:flex-col cf:gap-1.5">
                <Label>{t('用途')}</Label>
                <ChipGroup
                  label={t('用途')}
                  size="sm"
                  value={draft.use}
                  onChange={(u) => !readOnly && edit({ use: u })}
                  options={WORKFLOW_USES.map((u) => ({ id: u, label: WORKFLOW_USE_LABEL[u], disabled: readOnly }))}
                />
                <span className="cf:text-footnote cf:leading-relaxed cf:text-subtle">
                  {t('UI 设计选「本机」出图时，按图片用途自动挑工作流。')}
                </span>
              </div>
              <Field label={t('用到的模型')}>
                <Select
                  aria-label={t('用到的模型')}
                  value={draft.model || 'none'}
                  disabled={readOnly}
                  onChange={(e) => edit({ model: e.target.value === 'none' ? '' : e.target.value })}
                  options={[
                    ...LOCAL_MODELS.map((m) => ({ value: m.id, label: m.name })),
                    { value: 'none', label: t('自己的模型（不检查下载）') },
                  ]}
                />
              </Field>
              <Field label={t('说明')}>
                <Textarea
                  rows={2}
                  value={draft.description}
                  disabled={readOnly}
                  onChange={(e) => edit({ description: e.target.value })}
                />
              </Field>
              <Field label={t('附加要求（英文，加在每张图的描述后面）')}>
                <Textarea
                  rows={2}
                  value={draft.extra}
                  disabled={readOnly}
                  onChange={(e) => edit({ extra: e.target.value })}
                />
              </Field>
              <span className="cf:text-footnote cf:leading-relaxed cf:text-subtle">
                {t(
                  '占位符：{{prompt}} 描述、{{negative}} 反向描述、{{width}} {{height}} 尺寸、{{count}} 张数、{{seed}} 随机种子',
                )}
              </span>
              {problems.length > 0 && (
                <ul className="cf:flex cf:flex-col cf:gap-1 cf:text-footnote cf:text-danger">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              <div className="cf:flex cf:flex-col cf:gap-1.5">
                <Label>{t('AI 优化')}</Label>
                {OPTIMIZE_TIPS().map((tip) => (
                  <button
                    key={tip}
                    type="button"
                    onClick={() => setAsk({ mode: 'optimize', text: tip })}
                    className="cf:flex cf:cursor-pointer cf:items-center cf:gap-2 cf:rounded-xl cf:bg-card cf:px-2.5 cf:py-2 cf:text-left cf:text-body cf:shadow-[0_0_0_1px_var(--line-strong)] cf:transition-colors cf:hover:bg-sel/50"
                  >
                    <Sparkles className="cf:h-3.5 cf:w-3.5 cf:shrink-0 cf:text-peer" />
                    <span className="cf:min-w-0 cf:flex-1">{tip}</span>
                    <span aria-hidden className="cf:text-subtle">
                      ›
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>

      {ask && (
        <AssistModal
          mode={ask.mode}
          initial={ask.text}
          kind={kind}
          base={ask.mode === 'optimize' ? (draft && graph ? { ...draft, graph } : undefined) : undefined}
          onClose={() => setAsk(null)}
          onResult={(w, why) => {
            setAsk(null)
            openDraft(w, why)
          }}
        />
      )}
      {importing && (
        <ImportModal
          kind={kind}
          onClose={() => setImporting(false)}
          onResult={(w) => {
            setImporting(false)
            openDraft(w, t('已自动换上占位符，检查无误后保存。'))
          }}
        />
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('删除工作流「{name}」？', { name: draft?.name ?? '' })}
        confirmText={t('删除')}
        onConfirm={async () => {
          if (!draft) return
          await api.deleteComfyWorkflow(draft.id)
          setDeleting(false)
          setDraft(null)
          setDirty(false)
          setSel('')
          await load()
        }}
      />
      <ComfyWebDialog
        open={web}
        onOpenChange={(o) => {
          setWeb(o)
          if (!o) setWebImported(null)
        }}
        imported={webImported}
        importing={pushing}
      />
      {store && (
        <TemplateStore
          kind={kind}
          status={st}
          onClose={() => setStore(false)}
          onImport={() => {
            setStore(false)
            setImporting(true)
          }}
          onAdded={(wf) => {
            setStore(false)
            setDraft(null)
            setDirty(false)
            setSel(wf.id)
            void load()
            go(comfyRoute(kind, wf.id))
          }}
        />
      )}
    </main>
  )
}

/**
 * 试生成的尺寸：只决定比例，服务端按模型的基准边长换算（localSize）；
 * 和 UI 设计里常用的几种画面对上（方图标、横幅、竖卡、整屏）
 */
const TRY_SIZES = [
  { id: 'square', label: '1024²', width: 1024, height: 1024 },
  { id: 'wide', label: '3:2', width: 1536, height: 1024 },
  { id: 'tall', label: '2:3', width: 1024, height: 1536 },
  { id: 'screen', label: '16:9', width: 1920, height: 1080 },
]

/** 试生成条上的小下拉（尺寸、张数）：按钮上写当前值，点开单选 */
function TryPick({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { id: string; label: string }[]
}) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className="cf:h-[30px] cf:shrink-0 cf:cursor-pointer cf:rounded-lg cf:bg-card cf:px-2.5 cf:text-footnote cf:shadow-[0_0_0_1px_var(--line-strong)] cf:transition-colors cf:hover:bg-sel/50"
        >
          {options.find((o) => o.id === value)?.label ?? value}
        </button>
      </MenuTrigger>
      <MenuContent className="cf:min-w-[120px]">
        <MenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((o) => (
            <MenuRadioItem key={o.id} value={o.id}>
              <span className="cf:flex-1">{o.label}</span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  )
}

/** 「AI 优化」常用的几种要求：右栏和 AI 优化弹窗里共用 */
const OPTIMIZE_TIPS = () => [
  t('出图更清晰、边缘更干净'),
  t('加一步放大再缩小，提高细节'),
  t('换成更快的设置，适合批量'),
]

function Label({ children }: { children: ReactNode }) {
  return <span className="cf:text-caption cf:font-semibold cf:tracking-[0.06em] cf:text-subtle">{children}</span>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="cf:flex cf:min-w-0 cf:flex-col cf:gap-1.5">
      <Label>{label}</Label>
      {children}
    </label>
  )
}

function Count({ n }: { n: number }) {
  return (
    <span className="cf:ml-1.5 cf:inline-flex cf:h-[18px] cf:min-w-[18px] cf:items-center cf:justify-center cf:rounded-full cf:bg-sel cf:px-1.5 cf:text-caption cf:font-normal">
      {n}
    </span>
  )
}

function Sep() {
  return <span aria-hidden className="cf:mx-1 cf:h-5 cf:w-px cf:shrink-0 cf:bg-line" />
}

/** 画布工具条上的按钮：画布够宽时图标 + 文字，窄了只留图标（文字进读屏名和悬停提示） */
function Tool({
  icon: Icon,
  label,
  title,
  onClick,
  disabled,
  spin,
  tone,
  dot,
  wide,
}: {
  icon: LucideIcon
  label: string
  /** 次要的按钮：画布更宽（≥ 1000px）才写字，免得工具条把标题挤没 */
  wide?: boolean
  title?: string
  onClick: () => void
  disabled?: boolean
  spin?: boolean
  tone?: 'peer'
  /** 文字后面的状态点（ComfyUI 有没有在跑） */
  dot?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'cf:flex cf:h-8 cf:shrink-0 cf:cursor-pointer cf:items-center cf:gap-1.5 cf:rounded-xl cf:px-2 cf:text-body cf:whitespace-nowrap cf:transition-colors cf:hover:bg-sel cf:disabled:cursor-default cf:disabled:opacity-45 cf:disabled:hover:bg-transparent cf:@[740px]:px-2.5',
        tone === 'peer' ? 'cf:text-peer' : 'cf:text-muted cf:hover:text-fg',
      )}
    >
      <Icon className={cn('cf:h-[15px] cf:w-[15px]', spin && 'cf:animate-spin')} strokeWidth={2.2} />
      <span className={cn('cf:hidden', wide ? 'cf:@[1000px]:inline' : 'cf:@[740px]:inline')}>{label}</span>
      {dot && <span aria-hidden className={cn('cf:h-1.5 cf:w-1.5 cf:rounded-full', dot)} />}
    </button>
  )
}

function ListGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="cf:flex cf:flex-col cf:gap-0.5">
      <h2 className="cf:px-1.5 cf:pt-2.5 cf:pb-1 cf:text-caption cf:font-semibold cf:tracking-[0.06em] cf:text-subtle">{title}</h2>
      {children}
    </section>
  )
}

/** 列表里的一个工作流：缩略块（按用途上色）+ 名字 + 用途和模型 + 来源标签；缩略块角上的点是模型下载了没有 */
function WorkflowRow({ w, on, ready, onPick }: { w: ComfyWorkflow; on: boolean; ready: boolean; onPick: () => void }) {
  const look = USE_LOOK[w.use] ?? USE_LOOK.any
  const Icon = look.icon
  return (
    <button
      type="button"
      onClick={onPick}
      aria-current={on}
      className={cn(
        'cf:flex cf:w-full cf:cursor-pointer cf:items-center cf:gap-2.5 cf:rounded-xl cf:px-2 cf:py-[7px] cf:text-left cf:transition-colors',
        on ? 'cf:bg-card cf:shadow-[0_0_0_1px_var(--line-strong)]' : 'cf:hover:bg-sel/60',
      )}
    >
      <span
        className="cf:relative grid cf:h-[34px] cf:w-[34px] cf:shrink-0 cf:place-items-center cf:rounded-xl cf:text-white"
        style={{ background: look.color }}
      >
        <Icon className="cf:h-4 cf:w-4 cf:opacity-90" strokeWidth={2.2} />
        <span
          title={ready ? t('模型已下载，可以用') : t('模型还没下载')}
          className={cn(
            'cf:absolute cf:-right-0.5 cf:-bottom-0.5 cf:h-2.5 cf:w-2.5 cf:rounded-full cf:border-2 cf:border-[var(--bg)]',
            ready ? 'cf:bg-success' : 'cf:bg-line-strong',
          )}
        />
      </span>
      <span className="cf:flex cf:min-w-0 cf:flex-1 cf:flex-col cf:gap-0.5">
        <span className="cf:truncate cf:text-body cf:font-semibold">{w.name}</span>
        <span className="cf:truncate cf:text-caption cf:text-subtle">
          {WORKFLOW_USE_LABEL[w.use]}
          {w.model ? ` · ${localModel(w.model)?.name ?? w.model}` : ''}
        </span>
      </span>
      <span className={cn('cf:shrink-0 cf:text-caption', w.builtin ? 'cf:text-subtle' : 'cf:text-peer')}>
        {w.builtin ? t('内置') : importedWorkflow(w) ? t('导入的') : t('我的')}
      </span>
    </button>
  )
}

/** 一次试生成的卡片：跑着时转圈 + 占位格，出图后四格缩略图，失败写原因 */
function TryCard({ run }: { run: TryRun }) {
  return (
    <div className="cf:flex cf:flex-col cf:gap-2 cf:rounded-xl cf:bg-card cf:px-3 cf:py-2.5 cf:shadow-[0_0_0_1px_var(--line),0_2px_6px_-4px_rgb(0_0_0/0.15)]">
      <div className="cf:flex cf:min-w-0 cf:items-center cf:gap-2 cf:text-body">
        {run.status === 'running' ? (
          <Loader2 className="cf:h-3.5 cf:w-3.5 cf:shrink-0 cf:animate-spin cf:text-accent" />
        ) : run.status === 'done' ? (
          <span className="grid cf:h-4 cf:w-4 cf:shrink-0 cf:place-items-center cf:rounded-full cf:bg-success/15 cf:text-micro cf:font-bold cf:text-success">
            ✓
          </span>
        ) : (
          <span className="grid cf:h-4 cf:w-4 cf:shrink-0 cf:place-items-center cf:rounded-full cf:bg-danger/15 cf:text-micro cf:font-bold cf:text-danger">
            !
          </span>
        )}
        <span className="cf:min-w-0 cf:flex-1 cf:truncate cf:font-medium" title={run.prompt}>
          {run.prompt || run.workflow}
        </span>
        <span className="cf:shrink-0 cf:text-caption cf:text-subtle">
          {run.status === 'running' ? t('生成中') : t('{s} 秒', { s: Math.max(1, Math.round((run.ms ?? 0) / 1000)) })}
        </span>
      </div>
      {run.status === 'running' && <Progress label={t('试生成进度')} value={0} indeterminate />}
      {run.status === 'failed' && <p className="cf:text-footnote cf:leading-relaxed cf:text-danger">{run.error}</p>}
      {run.images.length > 0 && (
        <div className="grid cf:grid-cols-4 cf:gap-1">
          {run.images.map((src, i) => (
            <a key={i} href={src} target="_blank" rel="noreferrer" className="cf:block">
              <img
                src={src}
                alt=""
                className="cf:aspect-square cf:w-full cf:rounded-md cf:object-cover cf:shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]"
              />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

/** 「模型」页签：这个工作流用到的内置模型有哪些文件、下载了没有，缺的可以直接下载 */
function ModelsTab({
  draft,
  st,
  onStatus,
}: {
  draft: ComfyWorkflow
  st: ReturnType<typeof useLocalImage>[0]
  onStatus: ReturnType<typeof useLocalImage>[1]
}) {
  const model = draft.model ? localModel(draft.model) : undefined
  const job = st?.job?.status === 'running' && st.job.kind === 'download' ? st.job : undefined
  if (st?.external)
    return (
      <p className="cf:py-6 cf:text-center cf:text-body cf:leading-relaxed cf:text-subtle">
        {t('用的是已有的 ComfyUI，模型由它自己管，这里不检查下载。')}
      </p>
    )
  if (!model)
    return draft.assets.length ? (
      <div className="cf:flex cf:flex-col cf:gap-2">
        <Label>{t('依赖的模型文件')}</Label>
        {draft.assets.map((a) => (
          <span key={a} className="cf:truncate cf:rounded-lg cf:bg-field cf:px-2.5 cf:py-1.5 cf:font-mono cf:text-footnote" title={a}>
            {a}
          </span>
        ))}
      </div>
    ) : (
      <p className="cf:py-6 cf:text-center cf:text-body cf:leading-relaxed cf:text-subtle">
        {t('这个工作流用自己的模型，不检查下载。')}
      </p>
    )
  const files = model.files.map((id) => ({ id, f: localFile(id), have: !!st?.files.includes(id) }))
  const missing = files.filter((x) => !x.have)
  const missingGb = missing.reduce((n, x) => n + (x.f?.gb ?? 0), 0)
  const download = () =>
    api
      .localModel(model.id, 'download')
      .then(onStatus)
      .catch((e) => toast.error((e as Error).message))
  return (
    <div className="cf:flex cf:flex-col cf:gap-2.5">
      <div className="cf:flex cf:items-baseline cf:gap-2">
        <span className="cf:min-w-0 cf:flex-1 cf:truncate cf:text-prose cf:font-semibold">{model.name}</span>
        <span className="cf:shrink-0 cf:text-caption cf:text-subtle">{t('建议显存 {n} GB', { n: model.vram })}</span>
      </div>
      {files.map(({ id, f, have }) => (
        <div
          key={id}
          className="cf:flex cf:flex-col cf:gap-2 cf:rounded-xl cf:bg-card cf:px-3 cf:py-2.5 cf:shadow-[0_0_0_1px_var(--line),0_2px_6px_-4px_rgb(0_0_0/0.15)]"
        >
          <div className="cf:flex cf:min-w-0 cf:items-center cf:gap-2">
            <span className="cf:min-w-0 cf:flex-1 cf:truncate cf:font-mono cf:text-footnote" title={f?.file ?? id}>
              {f?.file ?? id}
            </span>
            <span
              className={cn(
                'cf:shrink-0 cf:rounded-full cf:px-2 cf:py-px cf:text-caption cf:font-semibold cf:whitespace-nowrap',
                have
                  ? 'cf:bg-success/10 cf:text-success'
                  : job
                    ? 'cf:bg-accent-soft cf:text-accent-text'
                    : 'cf:bg-warning/10 cf:text-warning',
              )}
            >
              {have ? t('已下载') : job ? t('下载中') : t('还没下载')}
            </span>
          </div>
          {f && <span className="cf:text-caption cf:text-subtle">{t('约 {n} GB', { n: f.gb })}</span>}
          {!have && job?.progress && (
            <Progress label={t('下载进度')} value={job.progress.done} max={job.progress.total} />
          )}
        </div>
      ))}
      {missing.length > 0 && !job && (
        <Button size="sm" variant="secondary" className="cf:self-start" onClick={() => void download()}>
          <Download className="cf:h-3.5 cf:w-3.5" />
          {t('下载 · 约 {n} GB', { n: Math.round(missingGb * 10) / 10 })}
        </Button>
      )}
      {job && <span className="cf:text-footnote cf:text-subtle">{job.step}</span>}
    </div>
  )
}

/** AI 生成新的工作流，或者按要求优化当前的 */
function AssistModal({
  mode,
  initial = '',
  kind: kind0,
  base,
  onClose,
  onResult,
}: {
  mode: 'create' | 'optimize'
  /** 右栏「AI 优化」里点的那条要求，预先填好 */
  initial?: string
  kind: Kind
  base?: ComfyWorkflow
  onClose: () => void
  onResult: (w: ComfyWorkflow, note: string) => void
}) {
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  // 列表不再按游戏 / 网页分页：新生成的工作流归哪类在弹窗里选，默认跟当前工作流
  const [kind, setKind] = useState<Kind>(kind0)
  const examples =
    mode === 'create'
      ? kind === 'game'
        ? [
            t('二次元手游的技能图标，描边粗、颜色饱和'),
            t('写实风格的武器图标，金属质感'),
            t('卡牌游戏的卡框，九宫格拉伸'),
          ]
        : [t('SaaS 官网的扁平插画，蓝紫配色'), t('电商活动横幅，留出放标题的位置')]
      : OPTIMIZE_TIPS()
  const run = async () => {
    setBusy(true)
    try {
      const r = await api.assistComfyWorkflow({ kind, instruction: text, base })
      // AI 新生成的记一下来源；优化沿用原来的（导入的工作流优化后还算导入的）
      onResult(mode === 'create' ? { ...r.workflow, origin: 'ai' } : r.workflow, r.note)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title={mode === 'create' ? t('AI 生成工作流') : t('AI 优化「{name}」', { name: base?.name ?? '' })}
      footer={
        <>
          <span className="cf:flex-1 cf:text-footnote cf:text-subtle">
            {t('用「AI 辅助」里设置的 Agent；ComfyUI 在运行时会按它装的节点来写')}
          </span>
          <Button onClick={() => void run()} disabled={busy || !text.trim()}>
            {busy ? <Loader2 className="cf:h-3.5 cf:w-3.5 cf:animate-spin" /> : <Sparkles className="cf:h-3.5 cf:w-3.5" />}
            {busy ? t('生成中…') : mode === 'create' ? t('生成') : t('优化')}
          </Button>
        </>
      }
    >
      {mode === 'create' && <KindPick value={kind} onChange={setKind} />}
      <Textarea
        autoFocus
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={mode === 'create' ? t('想生成什么样的资源、什么风格？') : t('想怎么改？')}
      />
      <div className="cf:flex cf:flex-wrap cf:gap-1.5">
        {examples.map((x) => (
          <button
            key={x}
            onClick={() => setText(x)}
            className="chip-idle cf:cursor-pointer cf:rounded-full cf:px-2.5 cf:py-1 cf:text-footnote cf:text-muted cf:transition-colors cf:hover:text-accent-text"
          >
            {x}
          </button>
        ))}
      </div>
    </Modal>
  )
}

/** 导入 ComfyUI 里「导出（API）」得到的 JSON，自动换上占位符 */
function ImportModal({
  kind: kind0,
  onClose,
  onResult,
}: {
  kind: Kind
  onClose: () => void
  onResult: (w: ComfyWorkflow) => void
}) {
  const [kind, setKind] = useState<Kind>(kind0)
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const go = () => {
    try {
      const raw = JSON.parse(text) as Record<string, unknown>
      if (Array.isArray((raw as { nodes?: unknown }).nodes))
        return setError(t('这是界面格式的工作流。请在 ComfyUI 里用「导出（API）」再导出一次。'))
      const graph = autoPlaceholders(((raw as { graph?: unknown }).graph ?? raw) as ComfyWorkflow['graph'])
      onResult({
        id: newId(),
        name: name.trim() || t('导入的工作流'),
        kind,
        use: 'any',
        description: '',
        model: '',
        assets: [],
        extra: '',
        graph,
        origin: 'import',
        updatedAt: '',
      })
    } catch (e) {
      setError(t('JSON 解析失败：{error}', { error: (e as Error).message }))
    }
  }
  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('从 ComfyUI 导入工作流')}
      footer={
        <>
          <span className="cf:flex-1 cf:text-footnote cf:text-danger">{error}</span>
          <Button onClick={go} disabled={!text.trim()}>
            <Plus className="cf:h-3.5 cf:w-3.5" />
            {t('导入')}
          </Button>
        </>
      }
    >
      <p className="cf:text-footnote cf:leading-relaxed cf:text-subtle">
        {t(
          '在 ComfyUI 里打开工作流，菜单「工作流 → 导出（API）」，把得到的 JSON 贴在下面。描述、尺寸、种子会自动换成占位符。',
        )}
      </p>
      <KindPick value={kind} onChange={setKind} />
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('名称')} />
      <Textarea
        rows={12}
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setError('')
        }}
        className="cf:font-mono cf:text-footnote"
        placeholder='{ "3": { "class_type": "KSampler", "inputs": { ... } } }'
      />
    </Modal>
  )
}

/** 新工作流归游戏还是网页：决定 UI 设计里哪类项目会用到它 */
function KindPick({ value, onChange }: { value: Kind; onChange: (k: Kind) => void }) {
  return (
    <Segmented
      label={t('工作流分类')}
      size="sm"
      className="cf:self-start"
      value={value}
      onChange={onChange}
      options={[
        { id: 'game', label: t('游戏 UI') },
        { id: 'web', label: t('网页 UI') },
      ]}
    />
  )
}
