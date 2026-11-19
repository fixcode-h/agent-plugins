import { Camera, Search, type LucideIcon } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { h, t } from '../host.ts'
import { useUe } from '../ctx.tsx'
import { SplitHandle, usePane } from '../split.tsx'
import { SlotCtx, useSlot } from './slot.tsx'

/**
 * UE 页左边：图标轨 + 二级面板（设计稿 designs/UE页左侧导航重设计-设计稿.md 方案 B，用户 2026-11-18 定）。
 * 图标轨一个分区一个图标，徽标变成角标；顶上是「回到项目」和跳转搜索，底部是截视口。
 * 二级面板只放这一页自己的导航（分区页面用 <SubNav> 放进来），页面没放就整列不画、主区占满
 * （用户 2026-11-18 定：项目卡去掉、目标卡挪进概览、没具体内容的二级面板不要）。宽度随内容，够显示文字就好。
 * 页面把整栏列表放进来时（对象页的大纲，用户 2026-11-18 定），二级面板加宽、可拖，列表占满面板。
 * 二级面板不给收起按钮（用户 2026-11-19 定：有内容就一直在，没内容本来就不画）。
 * 分区要整页时（GameTest 编辑页）二级面板收起，图标轨留着
 */
export interface RailSection {
  id: string
  label: string
  icon: LucideIcon
  group: string
}
export type NavCount = { text: string; tone?: 'danger' | 'warn'; title?: string } | undefined

/** 项目组（UE 插件、权限与设置）放到图标轨底部：偶尔才去 */
const END = new Set(['plugins', 'bridge'])

/** 图标下面的小字：名字长的给个短的，图标轨窄放不下 */
const SHORT: Record<string, () => string> = {
  assetforge: () => 'Forge',
  gametest: () => t('测试'),
  logs: () => t('日志'),
  history: () => t('记录'),
  plugins: () => t('插件'),
  bridge: () => t('设置'),
}

/** 二级面板的宽度：随内容，太窄不好点、太宽挤主区 */
const SIDE_MIN = 200
const SIDE_MAX = 300

/** 左栏的数字换成图标轨的角标：错误写数字，待处理黄点，可升级强调色点；「3 项」这种只是信息，不画 */
function railBadge(id: string, c: NavCount) {
  if (!c) return undefined
  const text = c.title ?? c.text
  if (c.tone === 'danger') return { count: parseInt(c.text, 10) || 1, tone: 'danger' as const, text }
  if (c.tone === 'warn') return { tone: 'warn' as const, text }
  if (id === 'plugins') return { tone: 'accent' as const, text }
  return undefined
}

export function RailLayout({
  sections,
  current,
  counts,
  onPick,
  pinned,
  wide,
  onShot,
  onJump,
  children,
}: {
  sections: RailSection[]
  current: RailSection
  counts: Record<string, NavCount>
  onPick: (id: string) => void
  /** 从项目工具打开（项目由面板定）：图标轨顶上是「回到项目」 */
  pinned: boolean
  /** 分区要整页（GameTest 编辑页）：二级面板收起 */
  wide: boolean
  onShot: () => void
  onJump: () => void
  children: ReactNode
}) {
  const { ui } = h()
  const { project } = useUe()
  const Rail = ui.SectionRail!
  const Action = ui.RailAction!
  const Panel = ui.SidePanel!
  const Back = ui.ProjectBackRail
  const slot = useSlot()
  const pane = usePane('side-list', '300px', 220)
  const paneRef = useRef<HTMLDivElement>(null)
  const open = !wide
  const items = sections.map((s) => ({
    id: s.id,
    label: s.label,
    icon: s.icon,
    group: s.group,
    end: END.has(s.id),
    short: SHORT[s.id]?.(),
    badge: railBadge(s.id, counts[s.id]),
  }))
  return (
    <div className="ue:flex ue:h-full ue:min-h-0 ue:w-full ue:min-w-0 ue:flex-1 ue:flex-col ue:bg-bg ue:md:flex-row">
      <Rail
        items={items}
        current={current.id}
        onPick={onPick}
        label={t('UE 页分区')}
        top={
          <>
            {pinned && Back && <Back projectId={project.id} name={project.name} />}
            <Action icon={Search} short={t('搜索')} label={t('跳转：双击 Shift 或 Ctrl+K')} onClick={onJump} />
          </>
        }
        bottom={<Action icon={Camera} short={t('截图')} label={t('截视口')} onClick={onShot} />}
      />
      {/* 插槽一直挂着（页面要先有插槽才能把导航放进来），没有页面放东西时整列不显示 */}
      {open && (
        <div
          ref={paneRef}
          style={slot.wide ? pane.style('calc(100% - 520px)') : { minWidth: SIDE_MIN, maxWidth: SIDE_MAX }}
          className={
            !slot.used
              ? 'ue:hidden'
              : slot.wide
                ? 'ue:relative ue:flex ue:min-h-0 ue:shrink-0 ue:md:w-(--ue-w) ue:md:max-w-(--ue-max)'
                : 'ue:flex ue:min-h-0 ue:w-max ue:shrink-0'
          }
        >
          <Panel
            title={current.label}
            className={slot.wide ? 'ue:w-full ue:flex-1 ue:md:overflow-hidden' : 'ue:w-full ue:flex-1'}
          >
            {/* 分区页面的 <SubNav> 用门户渲染进这里：页面在右边的 main 里，插槽的 Provider 包在 main 外面 */}
            <div
              ref={slot.setEl}
              className={
                slot.wide ? 'ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-1.5' : 'ue:flex ue:flex-col ue:gap-0.5'
              }
            />
          </Panel>
          {slot.wide && <SplitHandle pane={pane} paneRef={paneRef} reserve={() => 520} edge />}
        </div>
      )}
      <SlotCtx.Provider value={slot.value}>
        <main className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-1 ue:flex-col ue:overflow-hidden">{children}</main>
      </SlotCtx.Provider>
    </div>
  )
}
