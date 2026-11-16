import {
  CheckCircle2,
  ChevronUp,
  CircleAlert,
  CircleMinus,
  CircleX,
  Download,
  Hammer,
  Play,
  Stethoscope,
} from 'lucide-react'
import type { DiagItem, DiagState } from '../../../server/editor-tools/diagnose.ts'
import { h, t } from '../../host.ts'

/**
 * UE 插件页的「连接诊断」（入口在状态条）（设计稿「UE 插件优化与扩展」UELink 小项）：连不上时一页说清卡在哪一步，
 * 每项一行，不正常的给怎么修，能直接做的给按钮（安装、编译、启动编辑器）。点了才查，不自动跑（要连端口、查进程）。
 */
const ICON: Record<DiagState, { icon: typeof CheckCircle2; tone: string }> = {
  ok: { icon: CheckCircle2, tone: 'ue:text-success' },
  warn: { icon: CircleAlert, tone: 'ue:text-warning' },
  fail: { icon: CircleX, tone: 'ue:text-danger' },
  skip: { icon: CircleMinus, tone: 'ue:text-subtle' },
}

/** 诊断结果列表（UELink 卡片和设置 →「组件」的示例共用） */
export function DiagList({
  items,
  busy,
  onAction,
}: {
  items: DiagItem[]
  busy?: boolean
  onAction?: (a: NonNullable<DiagItem['action']>) => void
}) {
  const { ui, cn } = h()
  const label = { install: t('安装 / 升级'), build: t('编译'), launch: t('启动编辑器') }
  const icon = { install: Download, build: Hammer, launch: Play }
  return (
    <ul className="ue:flex ue:flex-col ue:divide-y ue:divide-line ue:rounded-lg ue:border ue:border-line">
      {items.map((it) => {
        const { icon: Icon, tone } = ICON[it.state]
        const Act = it.action ? icon[it.action] : undefined
        return (
          <li key={it.id} className="ue:flex ue:items-start ue:gap-2.5 ue:px-3 ue:py-2">
            <Icon className={cn('ue:mt-0.5 ue:h-4 ue:w-4 ue:shrink-0', tone)} />
            <div className="ue:min-w-0 ue:flex-1">
              <div className="ue:flex ue:flex-wrap ue:items-baseline ue:gap-x-2">
                <span className="ue:text-body ue:text-fg">{it.title}</span>
                <span className="ue:min-w-0 ue:text-footnote ue:break-all ue:text-subtle">{it.detail}</span>
              </div>
              {it.fix && it.state !== 'ok' && (
                <p className="ue:mt-0.5 ue:text-footnote ue:text-muted">
                  {t('怎么修：')}
                  {it.fix}
                </p>
              )}
            </div>
            {Act && it.action && it.state !== 'ok' && onAction && (
              <ui.Button size="sm" variant="secondary" disabled={busy} onClick={() => onAction(it.action!)}>
                <Act className="ue:h-3.5 ue:w-3.5" /> {label[it.action]}
              </ui.Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** UE 插件页状态条下面展开的诊断结果（StatusStrip 点「连接诊断」后出现） */
export function DiagPanel({
  res,
  busy,
  onAction,
  onClose,
}: {
  res: { items: DiagItem[]; at: string }
  busy: boolean
  onAction: (a: NonNullable<DiagItem['action']>) => void
  onClose: () => void
}) {
  const { ui } = h()
  const bad = res.items.filter((i) => i.state === 'fail' || i.state === 'warn').length
  return (
    <div className="ue:flex ue:flex-col ue:gap-2 ue:bg-card ue:px-4 ue:py-3">
      <div className="ue:flex ue:items-center ue:gap-2">
        <Stethoscope className="ue:h-4 ue:w-4 ue:text-subtle" />
        <span className="ue:text-body ue:font-medium ue:text-fg">{t('连接诊断')}</span>
        <span className="ue:min-w-0 ue:flex-1 ue:text-footnote ue:text-subtle">
          {bad ? t('{n} 项要处理', { n: bad }) : t('都正常')}
        </span>
        <ui.Button size="sm" variant="ghost" onClick={onClose}>
          <ChevronUp className="ue:h-3.5 ue:w-3.5" /> {t('收起')}
        </ui.Button>
      </div>
      <DiagList items={res.items} busy={busy} onAction={onAction} />
    </div>
  )
}

/** 设置 →「组件」里的示例：各种状态各一行 */
export function DiagSpecimen() {
  const items: DiagItem[] = [
    { id: 'a', title: t('插件已安装'), state: 'ok', detail: '2.4.0' },
    {
      id: 'b',
      title: t('插件编译过'),
      state: 'warn',
      detail: t('源码比编好的模块新'),
      fix: t('关掉编辑器后点「编译」'),
      action: 'build',
    },
    {
      id: 'c',
      title: t('{who} · 令牌对得上', { who: 'editor 1234' }),
      state: 'fail',
      detail: t('端口通了但令牌不对'),
      fix: t('关掉多余的编辑器后重启'),
    },
    { id: 'd', title: t('进程写了名片'), state: 'skip', detail: t('没有在运行的 UE 进程'), action: 'launch' },
  ]
  return (
    <div className="ue:max-w-xl">
      <DiagList items={items} onAction={() => {}} />
    </div>
  )
}
