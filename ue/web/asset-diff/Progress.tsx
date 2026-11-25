import { CheckCircle2, Circle, CircleDot, CircleMinus, CircleX, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { DiffProgress, DiffStep } from '../../shared/asset-diff/progress.ts'
import { h, t } from '../host.ts'
import { useDiffPrefs } from './prefs.ts'

const ICON: Record<DiffStep['state'], { icon: typeof Circle; tone: string; spin?: boolean }> = {
  wait: { icon: Circle, tone: 'ue:text-subtle' },
  run: { icon: Loader2, tone: 'ue:text-fg', spin: true },
  ok: { icon: CheckCircle2, tone: 'ue:text-success' },
  skip: { icon: CircleMinus, tone: 'ue:text-subtle' },
  fail: { icon: CircleX, tone: 'ue:text-danger' },
}

const readerName = (r: { kind: string; pid: number }) =>
  r.kind === 'file'
    ? t('编辑器没开，直接读文件')
    : r.kind === 'background'
      ? t('后台编辑器 PID {pid} 读', { pid: r.pid })
      : t('编辑器 PID {pid} 读', { pid: r.pid })

/** 头部的「由谁读」小标签 */
export function ReaderChip({ reader }: { reader?: { kind: string; pid: number } }) {
  if (!reader) return null
  return (
    <span
      title={t('这一次由谁读资源结构')}
      className="ue:inline-flex ue:h-5.5 ue:items-center ue:gap-1 ue:rounded-(--c-badge-radius) ue:bg-sel ue:px-1.5 ue:text-caption ue:text-muted"
    >
      <CircleDot className="ue:h-3 ue:w-3 ue:text-success" />
      {readerName(reader)}
    </span>
  )
}

/**
 * 读取中（设计稿「UE资源版本差异-修复与强化」3.1）：每一步的状态和用时，正在跑的那步显示已等几秒；
 * 以前一律写「编辑器没开时第一次要起后台编辑器」，编辑器开着时也这么写，让人以为在等后台编辑器
 */
export function DiffLoading({
  progress,
  since,
  onCancel,
}: {
  progress?: DiffProgress
  since: number
  onCancel?: () => void
}) {
  const { ui, cn } = h()
  // UE 那一步等了这么久还没好，提示 UE 在忙（设置 → 组件「版本差异」里能调）
  const { busySec } = useDiffPrefs()
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const now = Date.now()
  const total = Math.round((now - (progress?.startedAt ?? since)) / 1000)
  const run = progress?.steps.find((s) => s.state === 'run')
  const runSec = run?.since ? Math.round((now - run.since) / 1000) : 0
  const ueBusy = !!run && run.id.startsWith('read') && runSec >= busySec
  return (
    <div className="ue:flex ue:max-w-3xl ue:flex-col ue:gap-3 ue:p-5">
      <div className="ue:overflow-hidden ue:rounded-lg ue:border ue:border-line ue:bg-card">
        <div className="ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-3.5 ue:py-2.5">
          <Loader2 className="ue:h-4 ue:w-4 ue:animate-spin" />
          <span className="ue:text-body ue:font-medium">{t('正在读两版的结构')}</span>
          <span className="ue:ml-auto ue:text-caption ue:text-subtle">{t('已等 {n} 秒', { n: total })}</span>
        </div>
        {!progress ? (
          <p className="ue:px-3.5 ue:py-2.5 ue:text-footnote ue:text-muted">{t('准备中…')}</p>
        ) : (
          <ul className="ue:divide-y ue:divide-line">
            {progress.steps.map((s) => {
              const { icon: Icon, tone, spin } = ICON[s.state]
              const sec = s.state === 'run' && s.since ? Math.round((now - s.since) / 1000) : 0
              return (
                <li key={s.id} className="ue:flex ue:items-start ue:gap-2.5 ue:px-3.5 ue:py-1.5 ue:text-footnote">
                  <Icon className={cn('ue:mt-0.5 ue:h-3.5 ue:w-3.5 ue:shrink-0', tone, spin && 'ue:animate-spin')} />
                  <span className={cn('ue:w-44 ue:shrink-0', s.state === 'wait' ? 'ue:text-subtle' : 'ue:text-fg')}>
                    {s.label}
                  </span>
                  <span className="ue:min-w-0 ue:flex-1 ue:break-all ue:text-muted">
                    {[
                      s.detail,
                      s.state === 'run' && sec > 1 ? t('已等 {n} 秒', { n: sec }) : '',
                      s.ms !== undefined && s.state === 'ok' ? t('{s} 秒', { s: (s.ms / 1000).toFixed(1) }) : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <div className="ue:flex ue:items-center ue:gap-2">
        {onCancel && (
          <ui.Button size="sm" variant="secondary" onClick={onCancel}>
            <X className="ue:h-3.5 ue:w-3.5" /> {t('取消')}
          </ui.Button>
        )}
        <span className={cn('ue:text-footnote', ueBusy ? 'ue:text-warning' : 'ue:text-subtle')}>
          {ueBusy
            ? t('UE 已经 {n} 秒没读完：可能在 PIE、加载或编译着色器，忙完会接着读；一直不动可以取消后到「UE 插件」做连接诊断', {
                n: runSec,
              })
            : t('读过的版本按文件内容记在数据目录，再看不用重读')}
        </span>
      </div>
    </div>
  )
}
