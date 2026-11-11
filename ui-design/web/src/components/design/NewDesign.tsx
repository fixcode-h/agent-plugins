import { useEffect, useRef, useState } from 'react'
import { Gamepad2, Globe, ImageUp, Layers, Palette as PaletteIcon, Plus } from 'lucide-react'
import { t } from '@shared/i18n'
import { toast } from '@/lib/toast'
import { api } from '@/lib/api'
import { artToPng, restoreApi } from '@/lib/api-restore'
import { useNav } from '@/lib/data'
import { useDesignData } from '@/lib/design-store'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { DesignProjectDialog } from '@/components/design/DesignProjectDialog'

/**
 * 新建设计：名称、类型、项目、尺寸；游戏 UI 还可以选「照原画还原」，先选一张原画（从 DesignPage 拆出来）
 */

export const SIZES = [
  { v: '1920x1080', label: '1920 × 1080（16:9）' },
  { v: '2560x1440', label: '2560 × 1440（16:9）' },
  { v: '1280x720', label: '1280 × 720（16:9）' },
  { v: '2340x1080', label: `2340 × 1080（${t('手机横屏')}）` },
  { v: '1080x1920', label: `1080 × 1920（${t('竖屏')}）` },
]
/** 网页的常用尺寸：桌面、笔记本、平板、手机 */
const WEB_SIZES = [
  { v: '1440x900', label: `1440 × 900（${t('桌面')}）` },
  { v: '1280x800', label: `1280 × 800（${t('笔记本')}）` },
  { v: '1920x1080', label: `1920 × 1080（${t('大屏')}）` },
  { v: '768x1024', label: `768 × 1024（${t('平板')}）` },
  { v: '390x844', label: `390 × 844（${t('手机')}）` },
]

export function NewDesign({ projectId }: { projectId?: string }) {
  const { designProjects: projects, setDesigns } = useDesignData()
  const { go } = useNav()
  const [creatingProject, setCreatingProject] = useState(false)
  const [pid, setPid] = useState(projectId || projects[0]?.id || '')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<'game' | 'web'>('game')
  const [size, setSize] = useState('1920x1080')
  const [busy, setBusy] = useState(false)
  /** 游戏 UI 的两种做法：和 AI 对话从零设计，或者照一张原画一比一还原 */
  const [mode, setMode] = useState<'chat' | 'restore'>('chat')
  const [art, setArt] = useState<Awaited<ReturnType<typeof artToPng>>>()
  const pick = useRef<HTMLInputElement>(null)
  const restore = mode === 'restore'
  useEffect(() => {
    if (!pid && projects[0]) setPid(projects[0].id)
  }, [pid, projects])
  useEffect(() => {
    if (projectId) setPid(projectId)
  }, [projectId])

  const create = async () => {
    const [X, Y] = size.split('x').map(Number)
    setBusy(true)
    try {
      const d = await api.createDesign({
        projectId: pid,
        kind,
        title: title.trim() || t('未命名界面'),
        designSize: { X, Y },
      })
      // 还原模式：建好设计马上传原画，进去就是第一步「原画」等确认
      if (restore && art) await restoreApi.source(d.id, art)
      setDesigns((list) => [
        ...list,
        {
          id: d.id,
          projectId: d.projectId,
          kind: d.kind,
          title: d.title,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        },
      ])
      go({ page: 'design', id: d.id })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ud:flex ud:min-h-0 ud:flex-1 ud:flex-col ud:items-center ud:overflow-y-auto ud:px-4 ud:py-12 ud:md:py-20">
      <div className="ud:w-full ud:max-w-[560px]">
        <span className="ud:mb-4 ud:grid ud:h-11 ud:w-11 ud:place-items-center ud:rounded-xl ud:bg-accent-soft ud:text-accent-text">
          <PaletteIcon className="ud:h-5 ud:w-5" />
        </span>
        <h1 className="ud:font-serif ud:text-display ud:font-semibold ud:tracking-tight">{t('UI 设计')}</h1>
        <p className="ud:mt-2 ud:text-body ud:leading-relaxed ud:text-muted">
          {kind === 'web'
            ? t(
                '用对话设计网页界面：AI 用自动布局搭好页面、生成插图和图标，最后导出成 HTML / CSS 和图片，直接用浏览器打开。',
              )
            : t(
                '用对话设计游戏界面：AI 搭好 UMG 控件树、生成每一张图片，最后导出成 WidgetTree 的 JSON 和贴图，导入 UE 生成 Widget Blueprint。',
              )}
        </p>
        <DesignProjectDialog open={creatingProject} onOpenChange={setCreatingProject} onSaved={(p) => setPid(p.id)} />
        {!projects.length ? (
          <div className="ud:mt-8 ud:rounded-xl ud:bg-panel ud:p-5 ud:text-body ud:text-muted">
            {t('设计放在 UI 项目里（和 Agent 的项目分开）。先建一个项目吧，一般一个游戏一个项目。')}
            <Button className="ud:mt-3" onClick={() => setCreatingProject(true)}>
              <Plus className="ud:h-4 ud:w-4" />
              {t('新建 UI 项目')}
            </Button>
          </div>
        ) : (
          <div className="ud:mt-8 ud:flex ud:flex-col ud:gap-5 ud:rounded-2xl ud:bg-card ud:p-6 ud:shadow-card">
            <label className="ud:flex ud:flex-col ud:gap-1.5">
              <span className="ud:text-body ud:font-medium">{t('名称')}</span>
              <Input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !busy && pid && void create()}
                placeholder={kind === 'web' ? t('例如：首页、登录页、商品详情') : t('例如：主菜单、背包、战斗 HUD')}
              />
            </label>
            <div className="ud:flex ud:flex-col ud:gap-1.5">
              <span className="ud:text-body ud:font-medium">{t('类型')}</span>
              <Segmented
                label={t('类型')}
                value={kind}
                onChange={(k) => {
                  setKind(k)
                  setSize(k === 'web' ? WEB_SIZES[0].v : SIZES[0].v)
                }}
                options={[
                  { id: 'game', label: t('游戏 UI（UE5 UMG）') },
                  { id: 'web', label: t('网页 UI（HTML / CSS）') },
                ]}
              />
            </div>
            <div className="ud:flex ud:flex-col ud:gap-1.5">
              <span className="ud:text-body ud:font-medium">{t('做法')}</span>
              <Segmented
                label={t('做法')}
                value={mode}
                onChange={setMode}
                options={[
                  { id: 'chat', label: t('和 AI 对话设计') },
                  { id: 'restore', label: t('照原画还原') },
                ]}
              />
              {restore && (
                <>
                  <span className="ud:text-footnote ud:text-subtle">
                    {t(
                      '上传一张画好的界面原画：按步骤拆出元素、从原画抠切图、搭成位置锁定的控件树，每一步你确认了才往下走。',
                    )}
                  </span>
                  <input
                    ref={pick}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,.psd"
                    className="ud:hidden"
                    data-restore-art
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f)
                        artToPng(f)
                          .then((a) => {
                            setArt(a)
                            // 原画的宽高比和预设尺寸都对不上时，设计稿就用原画的尺寸
                            if (!title.trim()) setTitle(f.name.replace(/\.\w+$/, ''))
                          })
                          .catch((err) => toast.error(t('读不出这张图：{error}', { error: (err as Error).message })))
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => pick.current?.click()}
                    className="ud:mt-1 ud:flex ud:h-28 ud:cursor-pointer ud:items-center ud:justify-center ud:gap-3 ud:overflow-hidden ud:rounded-xl ud:border ud:border-dashed ud:border-line-strong ud:bg-panel ud:text-body ud:text-muted ud:transition-colors ud:hover:bg-hover ud:hover:text-fg"
                  >
                    {art?.psd ? (
                      <>
                        <Layers className="ud:h-6 ud:w-6" />
                        <span className="ud:text-footnote">
                          {art.name}
                          <br />
                          {t('PSD：按图层还原，位置和切图直接取自图层')}
                        </span>
                      </>
                    ) : art ? (
                      <>
                        <img src={art.data} alt="" className="ud:h-full ud:max-w-[60%] ud:object-contain" />
                        <span className="ud:text-footnote">
                          {art.name}
                          <br />
                          {art.width} × {art.height}
                        </span>
                      </>
                    ) : (
                      <>
                        <ImageUp className="ud:h-5 ud:w-5" />
                        {t('选择原画（PNG、JPG、WebP 或 PSD）')}
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
            <div className="ud:grid ud:grid-cols-1 ud:gap-4 ud:sm:grid-cols-2">
              <div className="ud:flex ud:flex-col ud:gap-1.5">
                <span className="ud:text-body ud:font-medium">{t('项目')}</span>
                <Select
                  aria-label={t('项目')}
                  value={pid}
                  onChange={(e) => (e.target.value === '+new' ? setCreatingProject(true) : setPid(e.target.value))}
                  options={[
                    ...projects.map((p) => ({ value: p.id, label: p.name })),
                    { value: '+new', label: t('新建 UI 项目…') },
                  ]}
                />
              </div>
              <div className="ud:flex ud:flex-col ud:gap-1.5">
                <span className="ud:text-body ud:font-medium">{t('设计尺寸')}</span>
                <Select
                  aria-label={t('设计尺寸')}
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  options={(kind === 'web' ? WEB_SIZES : SIZES).map((s) => ({ value: s.v, label: s.label }))}
                />
              </div>
            </div>
            <div className="ud:flex ud:justify-end">
              <Button onClick={() => void create()} disabled={busy || !pid || (restore && !art)}>
                {kind === 'web' ? <Globe className="ud:h-4 ud:w-4" /> : <Gamepad2 className="ud:h-4 ud:w-4" />}
                {restore ? t('开始还原') : t('开始设计')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
