import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { h, t } from './host.ts'
import { Card } from './ui.tsx'

/**
 * 设置页的共用排版：一节一张卡片，卡片里一行一个设置项（左边名字和说明，右边控件）。
 * 照面板设置页的 Row（web/src/components/settings/parts.tsx）画：同一个设置页里，插件自己的表单和面板画的
 * 插件参数（host.ui.PluginParams）挨着放，字号、行高、控件宽度要一致。用户 2026-11-18 嫌 GameTest 设置页
 * 「名字、输入框、长说明」三行一摞太乱，改成这种两栏的行。
 */

/** 一个设置项。stack：控件太宽（多行文本、列表）时放到说明下面占满整行 */
export function SettingRow({
  title,
  desc,
  children,
  stack,
}: {
  title: ReactNode
  desc?: ReactNode
  children: ReactNode
  stack?: boolean
}) {
  const { cn } = h()
  return (
    <div
      className={cn(
        'ue:flex ue:flex-col ue:gap-3 ue:px-4 ue:py-3.5',
        !stack && 'ue:sm:min-h-14 ue:sm:flex-row ue:sm:items-center ue:sm:justify-between ue:sm:gap-8',
      )}
    >
      <div className="ue:flex ue:min-w-0 ue:flex-col ue:gap-0.5">
        <span className="ue:text-prose ue:font-medium ue:text-fg">{title}</span>
        {desc && <span className="ue:text-body ue:leading-relaxed ue:text-subtle">{desc}</span>}
      </div>
      <div className={cn('ue:min-w-0', !stack && 'ue:sm:w-[280px] ue:sm:shrink-0')}>{children}</div>
    </div>
  )
}

/**
 * 一节设置：卡片标题 + 可选的一段说明 + 一行一行的设置项（细线分隔）。
 * framed：放在弹窗里时卡片外面没有分隔线，自己描一圈边
 */
export function SettingGroup({
  title,
  aside,
  desc,
  children,
  framed,
}: {
  title: ReactNode
  aside?: ReactNode
  desc?: ReactNode
  children: ReactNode
  framed?: boolean
}) {
  return (
    <Card
      title={title}
      aside={aside}
      className={framed ? 'ue:overflow-hidden ue:rounded-(--c-row-radius) ue:border ue:border-line' : undefined}
    >
      {desc && <p className="ue:px-4 ue:pt-3 ue:text-body ue:leading-relaxed ue:text-subtle">{desc}</p>}
      <div className="ue:flex ue:flex-col ue:divide-y ue:divide-line">{children}</div>
    </Card>
  )
}

/** 一节里的规则列表（条目怎么认、阻挡界面）：每条一个小框，没有时一行虚线占位 */
export function SettingList({ count, children }: { count: number; children: ReactNode }) {
  return (
    <div className="ue:flex ue:flex-col ue:gap-2 ue:px-4 ue:py-3">
      {!count && (
        <p className="ue:rounded-(--c-row-radius) ue:border ue:border-dashed ue:border-line ue:px-3 ue:py-4 ue:text-center ue:text-footnote ue:text-subtle">
          {t('还没有规则')}
        </p>
      )}
      {children}
    </div>
  )
}

/** 节标题右边的「添加」 */
export function AddButton({ onClick }: { onClick: () => void }) {
  const { ui } = h()
  return (
    <ui.Button size="sm" variant="ghost" onClick={onClick}>
      <Plus className="ue:h-3.5 ue:w-3.5" /> {t('添加')}
    </ui.Button>
  )
}
