import { Camera, Plus, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { GamepadIcon } from '../icon.tsx'
import { h, t } from '../host.ts'
import { connLine, JumpEntry } from '../Side.tsx'
import { useUe } from '../ctx.tsx'
import { SplitHandle, usePane } from '../split.tsx'
import { SlotCtx, useSlot } from './slot.tsx'
import { TargetChips } from './TargetChips.tsx'

/**
 * UE 页左边：图标轨 + 二级面板（设计稿 designs/UE页左侧导航重设计-设计稿.md 方案 B，用户 2026-11-18 定）。
 * 图标轨一个分区一个图标，徽标变成角标；二级面板顶上是项目卡和目标卡（方案 C 的样子），
 * 下面放这一页自己的导航（分区页面用 <SubNav> 放进来），页面没放时列出同组的分区。
 * 二级面板可收起，收不收按分区记在本机（日志页常开、画布页常收）。分区要整页时（GameTest 编辑页）二级面板收起，图标轨留着
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

const closedKey = (section: string) => `ue:side-closed:${section}`
function readClosed(section: string) {
  try {
    return localStorage.getItem(closedKey(section)) === '1'
  } catch {
    return false
  }
}
function saveClosed(section: string, closed: boolean) {
  try {
    if (closed) localStorage.setItem(closedKey(section), '1')
    else localStorage.removeItem(closedKey(section))
  } catch {}
}

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
  projectCard,
  wide,
  onShot,
  onJump,
  onAdd,
  children,
}: {
  sections: RailSection[]
  current: RailSection
  counts: Record<string, NavCount>
  onPick: (id: string) => void
  projectCard: ReactNode
  /** 分区要整页（GameTest 编辑页）：二级面板收起 */
  wide: boolean
  onShot: () => void
  onJump: () => void
  /** 不是从项目工具打开时（可以换项目）才有「添加 UE 项目」 */
  onAdd?: () => void
  children: ReactNode
}) {
  const { ui, cn } = h()
  const { state } = useUe()
  const Rail = ui.SectionRail!
  const Action = ui.RailAction!
  const Panel = ui.SidePanel!
  const Label = ui.SidePanelLabel!
  const Row = ui.SidePanelRow!
  const [closed, setClosed] = useState(() => readClosed(current.id))
  useEffect(() => setClosed(readClosed(current.id)), [current.id])
  const toggle = (c: boolean) => {
    setClosed(c)
    saveClosed(current.id, c)
  }
  const pane = usePane('side', '240px', 200)
  const paneRef = useRef<HTMLDivElement>(null)
  const slot = useSlot()
  const open = !closed && !wide
  const conn = connLine(state)
  const items = sections.map((s) => ({
    id: s.id,
    label: s.label,
    icon: s.icon,
    group: s.group,
    end: END.has(s.id),
    badge: railBadge(s.id, counts[s.id]),
  }))
  const siblings = sections.filter((s) => s.group === current.group)
  return (
    <div className="ue:flex ue:h-full ue:min-h-0 ue:w-full ue:min-w-0 ue:flex-1 ue:flex-col ue:bg-bg ue:md:flex-row">
      <Rail
        items={items}
        current={current.id}
        onPick={onPick}
        label={t('UE 页分区')}
        top={
          <Action
            icon={GamepadIcon}
            label={open ? t('收起二级面板 · {s}', { s: conn.text }) : t('展开二级面板 · {s}', { s: conn.text })}
            dot={
              conn.tone === 'ok' ? 'ok' : conn.tone === 'danger' ? 'danger' : conn.tone === 'warn' ? 'warn' : 'muted'
            }
            on={open}
            onClick={() => toggle(open)}
          />
        }
        bottom={<Action icon={Camera} label={t('截视口')} onClick={onShot} />}
      />
      {open && (
        <div
          ref={paneRef}
          style={pane.style('calc(100% - 520px)')}
          className="ue:relative ue:flex ue:min-h-0 ue:shrink-0 ue:md:w-(--ue-w) ue:md:max-w-(--ue-max)"
        >
          <Panel title={current.label} onCollapse={() => toggle(true)} className="ue:w-full ue:flex-1">
            {projectCard}
            <TargetChips />
            <JumpEntry onClick={onJump} />
            {/* 分区页面的 <SubNav> 用门户渲染进这里：页面在右边的 main 里，插槽的 Provider 包在 main 外面 */}
            <div ref={slot.setEl} className="ue:flex ue:flex-col ue:gap-0.5 ue:empty:hidden" />
            {!slot.used && siblings.length > 1 && (
              <div className="ue:flex ue:flex-col ue:gap-0.5">
                <Label>{current.group}</Label>
                {siblings.map((s) => (
                  <Row
                    key={s.id}
                    icon={s.icon}
                    label={s.label}
                    on={s.id === current.id}
                    onClick={() => onPick(s.id)}
                    meta={counts[s.id]?.text}
                    tone={counts[s.id]?.tone}
                    title={counts[s.id]?.title}
                  />
                ))}
              </div>
            )}
            {onAdd && (
              <button
                type="button"
                onClick={onAdd}
                className={cn(
                  'ue:mt-auto ue:flex ue:h-8 ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-lg ue:px-2 ue:text-body ue:text-muted ue:hover:bg-hover ue:hover:text-fg',
                )}
              >
                <Plus className="ue:h-4 ue:w-4" strokeWidth={1.75} /> {t('添加 UE 项目')}
              </button>
            )}
          </Panel>
          <SplitHandle pane={pane} paneRef={paneRef} reserve={() => 520} edge />
        </div>
      )}
      <SlotCtx.Provider value={slot.value}>
        <main className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-1 ue:flex-col ue:overflow-hidden">{children}</main>
      </SlotCtx.Provider>
    </div>
  )
}
