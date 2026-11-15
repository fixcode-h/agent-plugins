import * as D from '@radix-ui/react-dialog'
import { useEffect, useMemo, useState } from 'react'
import { toast } from '@/lib/toast'
import { ArrowLeft, Check, Download, FileInput, LayoutGrid, Loader2, Network, RefreshCw, Search } from 'lucide-react'
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_READY,
  TEMPLATE_SORTS,
  TEMPLATE_SOURCES,
  emptyTemplateQuery,
  filterTemplates,
  templateCategoryTitle,
  type ComfyTemplateDetail,
  type ComfyTemplateMeta,
  type TemplateAsset,
  type TemplateQuery,
} from '@shared/comfy-templates'
import type { ComfyWorkflow, LocalStatus } from '@shared/local-image'
import { t, uiLocale } from '@shared/i18n'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { EmptyPanel } from '@/components/ui/empty-panel'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { ComfyGraphView } from '@/components/comfy/ComfyGraphView'

type Catalog = { templates: ComfyTemplateMeta[]; updatedAt: string; cached: boolean }
type Detail = ComfyTemplateDetail & { preview?: ComfyWorkflow['graph'] }

const gbText = (gb: number) => (gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(gb * 1024)} MB`)
const bytesText = (n: number) =>
  n <= 0 ? '' : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`

const SOURCE_LABEL: Record<string, string> = { builtin: t('面板内置'), comfy: t('ComfyUI 官方') }

/**
 * ComfyUI 模板商店：左侧分类、顶部搜索和筛选、中间卡片列表，点开一个模板看节点图和依赖。
 * 卡片里的模板来自面板内置（本机模型）和 ComfyUI 官方模板索引；依赖可以一键下载到本机。
 */
export function TemplateStore({
  kind,
  status,
  onClose,
  onImport,
  onAdded,
}: {
  kind: 'game' | 'web'
  status?: LocalStatus
  onClose: () => void
  onImport: () => void
  onAdded: (wf: ComfyWorkflow) => void
}) {
  const [catalog, setCatalog] = useState<Catalog>()
  const [query, setQuery] = useState<TemplateQuery>(emptyTemplateQuery)
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      setCatalog(await api.comfyTemplates())
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])

  const categories = useMemo(() => {
    const list: { id: string; title: string }[] = TEMPLATE_CATEGORIES.map((c) => ({ id: c.id, title: c.title }))
    for (const m of catalog?.templates ?? [])
      if (!list.some((c) => c.id === m.category))
        list.push({ id: m.category, title: templateCategoryTitle(m.category) })
    return list
  }, [catalog])

  const list = useMemo(() => (catalog ? filterTemplates(catalog.templates, query) : []), [catalog, query])
  const count = (id: string) =>
    id === 'all' ? (catalog?.templates.length ?? 0) : (catalog?.templates.filter((m) => m.category === id).length ?? 0)

  const refresh = async () => {
    setRefreshing(true)
    try {
      setCatalog(await api.refreshComfyTemplates())
      toast.success(t('官方模板列表已更新'))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRefreshing(false)
    }
  }

  // 窄屏整页一起滚：分类、筛选条和列表都按内容高度排，筛选条不会把列表挤没、贴到窗口底边；宽屏才分栏各自滚
  return (
    // 全屏的一层：用 Radix Dialog 拿到焦点陷阱和 Esc 关闭，Tab 不会跑到下面被盖住的页面里
    <D.Root open onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        <D.Content
          aria-describedby={undefined}
          className="cf:fixed cf:inset-0 cf:z-30 cf:flex cf:flex-col cf:overflow-y-auto cf:bg-bg cf:text-fg cf:outline-none cf:lg:overflow-hidden"
        >
          <header className="cf:flex cf:flex-wrap cf:items-center cf:gap-3 cf:border-b cf:px-4 cf:py-3 cf:md:px-6">
            <div className="cf:min-w-0 cf:flex-1">
              <D.Title className="cf:flex cf:items-center cf:gap-2 cf:text-heading cf:font-semibold">
                <LayoutGrid className="cf:h-4 cf:w-4 cf:text-accent-text" />
                {t('模板商店')}
              </D.Title>
              <p className="cf:mt-0.5 cf:text-footnote cf:text-subtle">
                {t('从面板内置和 ComfyUI 官方模板里挑一个，看节点图和依赖；缺的模型可以直接下载。')}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={onImport}>
              <FileInput className="cf:h-3.5 cf:w-3.5" />
              {t('导入 ComfyUI 工作流')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={refreshing}>
              {refreshing ? <Loader2 className="cf:h-3.5 cf:w-3.5 cf:animate-spin" /> : <RefreshCw className="cf:h-3.5 cf:w-3.5" />}
              {t('刷新官方模板')}
            </Button>
            <Button size="sm" variant="secondary" onClick={onClose}>
              <ArrowLeft className="cf:h-3.5 cf:w-3.5" />
              {t('返回工作流')}
            </Button>
          </header>

          <div className="cf:flex cf:shrink-0 cf:flex-col cf:lg:min-h-0 cf:lg:flex-1 cf:lg:shrink cf:lg:flex-row">
            <aside className="cf:flex cf:max-h-[34vh] cf:shrink-0 cf:flex-col cf:gap-0.5 cf:overflow-y-auto cf:border-b cf:p-3 cf:lg:max-h-none cf:lg:w-[188px] cf:lg:border-r cf:lg:border-b-0">
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setQuery({ ...query, category: c.id })
                    setSelected('')
                  }}
                  aria-current={query.category === c.id}
                  className={cn(
                    'cf:flex cf:cursor-pointer cf:items-center cf:gap-2 cf:rounded-lg cf:px-2.5 cf:py-1.5 cf:text-left cf:text-body',
                    query.category === c.id ? 'cf:bg-sel cf:font-medium cf:text-fg' : 'cf:text-muted cf:hover:bg-sel/60',
                  )}
                >
                  <span className="cf:min-w-0 cf:flex-1 cf:truncate">{c.title}</span>
                  <span className="cf:font-mono cf:text-caption cf:text-subtle">{count(c.id)}</span>
                </button>
              ))}
              <p className="cf:mt-auto cf:px-2 cf:pt-3 cf:text-caption cf:leading-relaxed cf:text-subtle">
                {catalog?.cached
                  ? t('官方列表更新于 {time}', { time: new Date(catalog.updatedAt).toLocaleString(uiLocale()) })
                  : t('离线快照：联网后点「刷新官方模板」拿完整列表')}
              </p>
            </aside>

            <section className="cf:flex cf:flex-col cf:lg:min-h-0 cf:lg:flex-1">
              <div className="cf:flex cf:flex-wrap cf:items-center cf:gap-2 cf:border-b cf:px-4 cf:py-2.5">
                <div className="cf:relative cf:min-w-[180px] cf:flex-1">
                  <Search className="cf:pointer-events-none cf:absolute cf:top-1/2 cf:left-2.5 cf:h-3.5 cf:w-3.5 cf:-translate-y-1/2 cf:text-subtle" />
                  <Input
                    aria-label={t('搜索模板')}
                    value={query.query}
                    onChange={(e) => setQuery({ ...query, query: e.target.value })}
                    placeholder={t('搜索模板、模型或标签')}
                    className="cf:pl-8"
                  />
                </div>
                <Select
                  aria-label={t('来源')}
                  value={query.source}
                  onChange={(e) => setQuery({ ...query, source: e.target.value as TemplateQuery['source'] })}
                  options={TEMPLATE_SOURCES.map((x) => ({ value: x.id, label: x.title }))}
                />
                <Select
                  aria-label={t('依赖状态')}
                  value={query.ready}
                  onChange={(e) => setQuery({ ...query, ready: e.target.value as TemplateQuery['ready'] })}
                  options={TEMPLATE_READY.map((x) => ({ value: x.id, label: x.title }))}
                />
                <Select
                  aria-label={t('排序')}
                  value={query.sort}
                  onChange={(e) => setQuery({ ...query, sort: e.target.value as TemplateQuery['sort'] })}
                  options={TEMPLATE_SORTS.map((x) => ({ value: x.id, label: x.title }))}
                />
                <span className="cf:text-footnote cf:text-subtle">{t('{n} 个模板', { n: list.length })}</span>
              </div>

              <div className="cf:p-4 cf:lg:min-h-0 cf:lg:flex-1 cf:lg:overflow-y-auto">
                {selected ? (
                  <TemplateDetail
                    name={selected}
                    kind={kind}
                    status={status}
                    onBack={() => setSelected('')}
                    onAdded={onAdded}
                  />
                ) : loading ? (
                  <div className="grid cf:place-items-center cf:py-20 cf:text-subtle">
                    <Loader2 className="cf:h-5 cf:w-5 cf:animate-spin" />
                  </div>
                ) : error ? (
                  <div className="cf:rounded-xl cf:bg-danger/8 cf:p-4 cf:text-body cf:text-danger">
                    <p>{error}</p>
                    <Button size="sm" variant="ghost" className="cf:mt-2" onClick={() => void load()}>
                      {t('重试')}
                    </Button>
                  </div>
                ) : !list.length ? (
                  <p className="cf:py-16 cf:text-center cf:text-body cf:text-subtle">{t('没有符合条件的模板')}</p>
                ) : (
                  <div className="grid cf:gap-3 cf:sm:grid-cols-2 cf:xl:grid-cols-3 cf:2xl:grid-cols-4">
                    {list.map((m) => (
                      <TemplateCard key={m.name} item={m} onOpen={() => setSelected(m.name)} />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

function TemplateCard({ item, onOpen }: { item: ComfyTemplateMeta; onOpen: () => void }) {
  return (
    <Card as="button" interactive padding="sm" onClick={onOpen} className="cf:group cf:flex cf:flex-col cf:gap-2">
      <div className="cf:flex cf:items-start cf:gap-2">
        <span className="cf:line-clamp-2 cf:min-w-0 cf:flex-1 cf:text-body cf:leading-snug cf:font-medium">{item.title}</span>
        {item.available && (
          <span title={t('节点图已缓存，离线也能预览')} className="cf:shrink-0 cf:text-subtle">
            <Network className="cf:h-3.5 cf:w-3.5" />
          </span>
        )}
      </div>
      {item.description && <p className="cf:line-clamp-2 cf:text-footnote cf:leading-relaxed cf:text-subtle">{item.description}</p>}
      <div className="cf:flex cf:flex-wrap cf:gap-1">
        {[SOURCE_LABEL[item.source] ?? item.source, ...item.tags.slice(0, 2)].map((tag) => (
          <span key={tag} className="cf:rounded-sm cf:bg-sel cf:px-1.5 cf:py-px cf:text-caption cf:text-muted">
            {tag}
          </span>
        ))}
      </div>
      <div className="cf:mt-auto cf:flex cf:items-center cf:gap-2 cf:text-caption cf:text-subtle">
        <span className="cf:min-w-0 cf:flex-1 cf:truncate" title={item.models.join('、')}>
          {item.models.slice(0, 2).join(' · ') || t('没有模型信息')}
        </span>
        {item.size > 0 && <span className="cf:shrink-0 cf:font-mono">{bytesText(item.size)}</span>}
        <span
          title={item.ready === true ? t('依赖已就绪') : item.ready === false ? t('缺模型') : t('打开后检查依赖')}
          className={cn(
            'cf:h-1.5 cf:w-1.5 cf:shrink-0 cf:rounded-full',
            item.ready === true ? 'cf:bg-success' : item.ready === false ? 'cf:bg-warning' : 'cf:bg-line-strong',
          )}
        />
      </div>
    </Card>
  )
}

function TemplateDetail({
  name,
  kind,
  status,
  onBack,
  onAdded,
}: {
  name: string
  kind: 'game' | 'web'
  status?: LocalStatus
  onBack: () => void
  onAdded: (wf: ComfyWorkflow) => void
}) {
  const [detail, setDetail] = useState<Detail>()
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const job = status?.job
  const downloading = job?.status === 'running' && job.kind === 'download'
  const jobForThis = downloading && job?.model === `template:${detail?.template.title ?? ''}`
  const pct =
    jobForThis && job?.progress?.total ? Math.min(100, (job.progress.done / job.progress.total) * 100) : undefined

  useEffect(() => {
    let alive = true
    setDetail(undefined)
    setError('')
    api
      .comfyTemplate(name)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError((e as Error).message))
    return () => {
      alive = false
    }
    // 下载结束后重新取一次，看文件是不是都到齐了
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [name, job?.status])

  const graph = detail?.graph ?? detail?.preview
  const missing = detail?.assets.filter((a) => !a.have) ?? []
  const canDownload = missing.some((a) => !!a.url)
  const isImage = !detail?.template.output || detail.template.output === 'image'

  const download = async () => {
    if (!detail) return
    try {
      const r = await api.downloadComfyTemplate(detail.template.name)
      if (r.skipped) toast.warning(t('{n} 个文件没有下载地址，需要自己放到 ComfyUI/models', { n: r.skipped }))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const add = async () => {
    if (!detail) return
    setAdding(true)
    try {
      const wf = await api.addComfyTemplate(detail.template.name, kind)
      toast.success(t('已添加到工作流'))
      onAdded(wf)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="cf:mx-auto cf:flex cf:w-full cf:max-w-[1100px] cf:flex-col cf:gap-4">
      <div className="cf:flex cf:flex-wrap cf:items-center cf:gap-2">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft className="cf:h-3.5 cf:w-3.5" />
          {t('返回列表')}
        </Button>
        <span className="cf:flex-1" />
        {detail && (
          <>
            {missing.length > 0 && canDownload && (
              <Button size="sm" variant="secondary" onClick={() => void download()} disabled={!!jobForThis}>
                {jobForThis ? <Loader2 className="cf:h-3.5 cf:w-3.5 cf:animate-spin" /> : <Download className="cf:h-3.5 cf:w-3.5" />}
                {jobForThis ? t('下载中…') : t('下载缺失的模型（{n} 个）', { n: missing.length })}
              </Button>
            )}
            <Button size="sm" onClick={() => void add()} disabled={adding || !isImage}>
              {adding ? <Loader2 className="cf:h-3.5 cf:w-3.5 cf:animate-spin" /> : <Check className="cf:h-3.5 cf:w-3.5" />}
              {t('添加为工作流')}
            </Button>
          </>
        )}
      </div>

      {error && <div className="cf:rounded-xl cf:bg-danger/8 cf:p-4 cf:text-body cf:text-danger">{error}</div>}
      {!detail && !error && (
        <div className="grid cf:place-items-center cf:py-20 cf:text-subtle">
          <Loader2 className="cf:h-5 cf:w-5 cf:animate-spin" />
        </div>
      )}

      {detail && (
        <>
          <div>
            <div className="cf:flex cf:flex-wrap cf:items-center cf:gap-2">
              <h2 className="cf:text-subtitle cf:font-semibold">{detail.template.title}</h2>
              <span className="cf:rounded-sm cf:bg-sel cf:px-1.5 cf:py-px cf:text-caption cf:text-muted">
                {SOURCE_LABEL[detail.template.source] ?? detail.template.source}
              </span>
              <span className="cf:text-footnote cf:text-subtle">{templateCategoryTitle(detail.template.category)}</span>
            </div>
            <p className="cf:mt-1 cf:max-w-[820px] cf:text-body cf:leading-relaxed cf:text-muted">{detail.template.description}</p>
          </div>

          {!isImage && (
            <p className="cf:rounded-xl cf:bg-warning/8 cf:px-3 cf:py-2 cf:text-footnote cf:leading-relaxed cf:text-warning">
              {t('这是视频或音频模板，UI 设计只处理图片，添加后也不能用于这里的出图。')}
            </p>
          )}
          {detail.template.needsInput && (
            <p className="cf:rounded-xl cf:bg-panel cf:px-3 cf:py-2 cf:text-footnote cf:leading-relaxed cf:text-muted">
              {t('这个模板需要先喂一张图（图生图 / 编辑）。UI 设计目前只按文字出图，可以在 ComfyUI 网页里打开使用。')}
            </p>
          )}

          {jobForThis && pct !== undefined && (
            <div className="cf:flex cf:items-center cf:gap-3">
              <Progress label={t('下载进度')} value={pct} className="cf:flex-1" />
              <span className="cf:font-mono cf:text-footnote cf:text-subtle">
                {bytesText(job!.progress!.done)} / {bytesText(job!.progress!.total)}
              </span>
            </div>
          )}
          {jobForThis && job?.status === 'failed' && job.error && (
            <p className="cf:rounded-xl cf:bg-danger/8 cf:px-3 cf:py-2 cf:text-footnote cf:leading-relaxed cf:whitespace-pre-wrap cf:text-danger">
              {job.error}
            </p>
          )}

          <section className="cf:flex cf:flex-col cf:gap-1.5">
            <h3 className="cf:text-footnote cf:font-medium cf:text-muted">{t('节点图')}</h3>
            {graph ? (
              <ComfyGraphView graph={graph} readOnly onChange={() => {}} />
            ) : (
              <EmptyPanel size="md" className="cf:px-3 cf:text-footnote">
                {t('这个模板没有可预览的节点图')}
              </EmptyPanel>
            )}
          </section>

          <section className="cf:flex cf:flex-col cf:gap-2">
            <div className="cf:flex cf:items-center cf:gap-2">
              <h3 className="cf:text-footnote cf:font-medium cf:text-muted">{t('依赖的模型文件')}</h3>
              <span className="cf:text-caption cf:text-subtle">
                {detail.assets.length ? t('{n} 个文件', { n: detail.assets.length }) : t('没有识别到模型文件')}
              </span>
            </div>
            <div className="cf:flex cf:flex-col cf:divide-y cf:overflow-hidden cf:rounded-xl cf:bg-panel">
              {detail.assets.length ? (
                detail.assets.map((a) => <AssetRow key={`${a.dir}/${a.file}`} asset={a} />)
              ) : (
                <p className="cf:px-3 cf:py-3 cf:text-footnote cf:text-subtle">
                  {t('模板说明里没有列出模型文件；在 ComfyUI 里打开时会提示缺少什么。')}
                </p>
              )}
            </div>
            {missing.length > 0 && !canDownload && (
              <p className="cf:text-footnote cf:leading-relaxed cf:text-subtle">
                {t('缺失的文件没有下载地址，需要自己放到 ComfyUI 的 models 目录。')}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function AssetRow({ asset }: { asset: TemplateAsset }) {
  return (
    <div className="cf:flex cf:items-center cf:gap-3 cf:px-3 cf:py-2">
      <span className="cf:min-w-0 cf:flex-1">
        <span className="cf:block cf:truncate cf:font-mono cf:text-footnote" title={asset.file}>
          {asset.file}
        </span>
        <span className="cf:block cf:text-caption cf:text-subtle">
          {asset.dir}
          {asset.gb > 0 ? ` · ${gbText(asset.gb)}` : ''}
        </span>
      </span>
      {asset.have ? (
        <span className="cf:inline-flex cf:items-center cf:gap-1 cf:text-footnote cf:text-success">
          <Check className="cf:h-3 cf:w-3" />
          {t('已下载')}
        </span>
      ) : (
        <span className={cn('cf:text-footnote', asset.url ? 'cf:text-warning' : 'cf:text-subtle')}>
          {asset.url ? t('缺') : t('需要自己放')}
        </span>
      )}
    </div>
  )
}
