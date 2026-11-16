import { CheckCircle2, CircleAlert, CircleMinus, CircleX, Download, Hammer, Play, Stethoscope } from 'lucide-react'
import { useState } from 'react'
import type { DiagItem, DiagState } from '../../../server/editor-tools/diagnose.ts'
import { pget, ppost, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'

/**
 * UELink 卡片里的「连接诊断」（设计稿「UE 插件优化与扩展」UELink 小项）：连不上时一页说清卡在哪一步，
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

/** 卡片里的那一块：按钮 + 结果。onAction 交给卡片（安装、编译和卡片自己的按钮走同一套作业输出） */
export function LinkDiagnose({ onAction }: { onAction: (a: 'install' | 'build') => void }) {
  const { project, reload } = useUe()
  const { ui } = h()
  const { busy, run } = useAction()
  const [res, setRes] = useState<{ items: DiagItem[]; at: string }>()
  const check = () => run('diag', async () => setRes(await pget(project.id, 'tools/diagnose')))
  const bad = res?.items.filter((i) => i.state === 'fail' || i.state === 'warn').length ?? 0
  return (
    <div className="ue:flex ue:flex-col ue:gap-2 ue:border-t ue:border-line ue:pt-3">
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
        <span className="ue:text-body ue:font-medium ue:text-fg">{t('连接诊断')}</span>
        <span className="ue:min-w-0 ue:flex-1 ue:text-footnote ue:text-subtle">
          {res
            ? bad
              ? t('{n} 项要处理', { n: bad })
              : t('都正常')
            : t('连不上 UE 时查一遍：装没装、编译过没有、名片、端口、令牌、版本、推送通道')}
        </span>
        <ui.Button size="sm" variant="secondary" disabled={busy === 'diag'} onClick={() => void check()}>
          <Stethoscope className="ue:h-3.5 ue:w-3.5" /> {busy === 'diag' ? t('诊断中…') : res ? t('重新诊断') : t('诊断')}
        </ui.Button>
      </div>
      {res && (
        <DiagList
          items={res.items}
          busy={!!busy}
          onAction={(a) => {
            if (a === 'launch')
              void run('launch', async () => {
                await ppost(project.id, 'editor')
                reload()
              })
            else onAction(a)
          }}
        />
      )}
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
