import { CircleStop, Loader2, PauseCircle } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { h, t } from '../../../host.ts'

/** 编辑页里正在跑的这个脚本：外壳从 GameTest 页的作业状态里取 */
export interface EditRun {
  /** 已经做完的步数、计划的步数（不知道时为 0） */
  done: number
  planned: number
  failed: number
  onStop: () => void
}

/**
 * 运行中的横条（效果图 6）：转圈 + 用时 + 第几步 + 进度条，右边「停止」。
 * 每一步的高亮在流程图上（gt.flow 推送），这里只给一眼能看的总进度。
 * children 放在「停止」左边（调试按钮：断点、暂停、单步，gt-debug 的 RunControls）；停在断点上时换成暂停的样子
 */
export function RunBanner({ run, paused, children }: { run: EditRun; paused?: boolean; children?: ReactNode }) {
  const { ui, cn } = h()
  const [start] = useState(() => Date.now())
  const [now, setNow] = useState(start)
  useEffect(() => {
    // 用时每秒刷新一次：只是显示，不去问 UE
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const sec = Math.floor((now - start) / 1000)
  const pct = run.planned > 0 ? Math.min(100, Math.round((run.done / run.planned) * 100)) : 0
  return (
    <div
      className={cn(
        'ue:flex ue:min-h-11 ue:flex-wrap ue:items-center ue:gap-3 ue:border-b ue:border-line ue:px-4 ue:py-1.5',
        paused ? 'ue:bg-warning/8' : 'ue:bg-run/8',
      )}
    >
      {paused ? (
        <PauseCircle className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-warning" />
      ) : (
        <Loader2 className="ue:h-4 ue:w-4 ue:shrink-0 ue:animate-spin ue:text-run" />
      )}
      <span className="ue:text-body ue:font-medium ue:text-fg">{paused ? t('已暂停') : t('运行中')}</span>
      <span className="ue:font-mono ue:text-footnote ue:text-muted ue:tabular-nums">
        {`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`}
        {' · '}
        {run.planned > 0
          ? t('第 {n} / {m} 步', { n: run.done + 1, m: run.planned })
          : t('第 {n} 步', { n: run.done + 1 })}
        {run.failed > 0 && ` · ${t('{n} 步失败', { n: run.failed })}`}
      </span>
      {run.planned > 0 && (
        <span className="ue:h-1 ue:w-48 ue:overflow-hidden ue:rounded-full ue:bg-line">
          <span className="ue:block ue:h-full ue:bg-run" style={{ width: `${pct}%` }} />
        </span>
      )}
      <div className="ue:ml-auto ue:flex ue:items-center ue:gap-2">
        {children}
        <ui.Button size="sm" variant="danger" onClick={run.onStop}>
          <CircleStop className="ue:h-3.5 ue:w-3.5" />
          {t('停止')}
        </ui.Button>
      </div>
    </div>
  )
}
