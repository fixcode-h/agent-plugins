import { Crosshair, MousePointerClick, Radio } from 'lucide-react'
import { op, useAction } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { isRuntimePath } from '../details/model.ts'
import { useEditorSelection, useFollow, useFollowEffect } from './use-selection.ts'

/**
 * 对象页、资源页左栏顶上的一条「编辑器选中 …」（设计稿「UE 插件优化与扩展」二 P0、效果图 1、3）：
 * 显示编辑器里选中的第一个 Actor（对象页）或资源（资源页），「定位」在面板里打开它；「跟随」开着时编辑器里点哪个面板跟到哪个；
 * 反方向「在编辑器里选中」把面板里正看着的对象在编辑器里选中并对焦。桥接旧（没有 editor.selection）或编辑器没开时整条不显示
 */
export function SelectionBar({
  page,
  current,
  onOpen,
  hideEmpty,
}: {
  page: 'objects' | 'assets'
  /** 面板里正在看的对象 / 资源路径 */
  current: string
  onOpen: (path: string) => void
  /** 编辑器里没选中东西时整条不显示（资源页：平时不占一行，用户 2026-11-19）；「跟随」开着照样记着，选中了再出来 */
  hideEmpty?: boolean
}) {
  const { project } = useUe()
  const { ui, cn, toast } = h()
  const sel = useEditorSelection()
  const [follow, setFollow] = useFollow(page)
  const { busy, run } = useAction()
  const first = page === 'objects' ? sel.data?.actors[0] : sel.data?.assets[0]
  const count = page === 'objects' ? (sel.data?.actorCount ?? 0) : (sel.data?.assets.length ?? 0)
  useFollowEffect(first?.path, follow, onOpen)
  if (!sel.supported || !sel.inst) return null
  if (hideEmpty && !first) return null

  const label: string = first
    ? ('label' in first && typeof first.label === 'string' && first.label) || first.name
    : page === 'objects'
      ? t('关卡里没选中 Actor')
      : t('内容浏览器里没选中资源')
  // 面板里正看着的东西能不能反过来在编辑器里选中：对象页是关卡里的 Actor，资源页是资源
  const canSelect = !!current && (page === 'assets' ? !isRuntimePath(current) : isRuntimePath(current))
  const selectInEditor = () =>
    run('select', async () => {
      const r = await op<{ missing?: string[] }>(
        project.id,
        'editor.select',
        page === 'assets' ? { assets: [current] } : { actors: [current], focus: true },
        { instance: sel.inst!.pid },
      )
      if (r.missing?.length) toast.error(t('编辑器里没找到：{p}', { p: r.missing.join('，') }))
    })

  return (
    <div className="ue:flex ue:min-h-9 ue:items-center ue:gap-1.5 ue:border-b ue:border-line ue:px-3 ue:py-1">
      <MousePointerClick className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
      <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{t('编辑器选中')}</span>
      <button
        type="button"
        disabled={!first}
        title={first?.path}
        onClick={() => first && onOpen(first.path)}
        className={cn(
          'ue:min-w-0 ue:flex-1 ue:truncate ue:text-left ue:text-footnote',
          first ? 'ue:cursor-pointer ue:text-fg ue:hover:text-accent-text' : 'ue:text-subtle',
        )}
      >
        {label}
        {count > 1 && <span className="ue:ml-1 ue:text-caption ue:text-subtle">{t('等 {n} 个', { n: count })}</span>}
      </button>
      {canSelect && (
        <ui.IconButton
          icon={Crosshair}
          size="xs"
          label={page === 'objects' ? t('在编辑器里选中并对焦') : t('在内容浏览器里定位')}
          disabled={busy === 'select'}
          onClick={selectInEditor}
        />
      )}
      <ui.Button
        size="xs"
        variant={follow ? 'secondary' : 'ghost'}
        aria-pressed={follow}
        title={t('开着时编辑器里点哪个，这里跟到哪个')}
        onClick={() => setFollow(!follow)}
      >
        <Radio className={cn('ue:h-3 ue:w-3', follow && 'ue:text-accent-text')} /> {t('跟随')}
      </ui.Button>
    </div>
  )
}
