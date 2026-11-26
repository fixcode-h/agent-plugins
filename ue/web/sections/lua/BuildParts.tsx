import { Layers, LoaderCircle, Zap } from 'lucide-react'
import type { LuaBuildRun } from '../../../server/types.ts'
import { useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Badge } from '../../ui.tsx'
import type { BuildCurrent } from './build-store.ts'
import { useLuaBuild } from './build-store.ts'

/** 「增量编译 3 个文件」「全编译 214 个文件」 */
export function buildTitle(r: LuaBuildRun) {
  return r.mode === 'full' ? t('全编译 {n} 个文件', { n: r.fileCount }) : t('增量编译 {n} 个文件', { n: r.fileCount })
}

/** 状态标签（meta=false），或者右边的「10:43:22 · 2.1 秒 · 退出码 1」（meta=true） */
export function BuildStatus({ run, meta }: { run: LuaBuildRun; meta?: boolean }) {
  if (meta) {
    const parts = [new Date(run.startedAt).toLocaleTimeString()]
    if (run.endedAt) parts.push(t('{s} 秒', { s: ((run.endedAt - run.startedAt) / 1000).toFixed(1) }))
    if (run.code !== undefined && run.status !== 'running') parts.push(t('退出码 {code}', { code: run.code }))
    if (run.by === 'agent') parts.push(t('Agent 发起'))
    return <span className="ue:font-mono ue:text-caption">{parts.join(' · ')}</span>
  }
  if (run.status === 'running') return <Badge tone="run">{t('编译中')}</Badge>
  if (run.status === 'ok') return <Badge tone="ok">{t('成功')}</Badge>
  if (run.status === 'stopped') return <Badge>{t('已停止')}</Badge>
  return <Badge tone="danger">{t('失败')}</Badge>
}

/** 输出：命令行一种颜色，认出了报错的行标红 */
export function BuildOutput({ run }: { run: BuildCurrent }) {
  const { cn } = h()
  // 认报错是在服务端按报错格式做的；这里只按「文件名:行号」把对应的输出行标红，不另写一套规则
  const marks = run.errors.map((e) => `${e.file.split('/').pop()}:${e.line}`)
  return (
    <>
      {run.droppedLines > 0 && (
        <div className="ue:text-term-subtle">
          {t('… 前面 {n} 行没显示，完整输出在 {file}', { n: run.droppedLines, file: run.logFile })}
        </div>
      )}
      {run.lines.map((l, i) => (
        <div
          key={i + run.droppedLines}
          className={cn(
            'ue:whitespace-pre-wrap ue:break-all',
            l.startsWith('> ') && i === 0 && !run.droppedLines
              ? 'ue:text-term-cmd'
              : marks.some((m) => l.includes(m)) && 'ue:text-danger',
          )}
        >
          {l || ' '}
        </div>
      ))}
    </>
  )
}

/**
 * Lua 页页头的「增量编译 · N」「全编译」（tabs.ts 的 LUA_HEAD_ACTIONS）。点了切到「编译」页签看输出；
 * 没选项目工具时按钮灰掉，悬停说去哪选
 */
export function LuaBuildHead() {
  const { project, go } = useUe()
  const b = useLuaBuild(project.id)
  const { busy, run } = useAction()
  const { ui } = h()
  const cfg = b.snap?.config
  if (!cfg) return null
  const n = b.picked.length
  const start = (mode: 'full' | 'incremental') =>
    run(mode, async () => {
      go('lua', 'build')
      await b.start(mode)
    })
  const spin = <LoaderCircle className="ue:h-3.5 ue:w-3.5 ue:motion-safe:animate-spin" />
  const mode = b.snap?.current?.mode
  return (
    <>
      <ui.Button
        size="sm"
        variant="secondary"
        disabled={!cfg.incrementalTool || b.running || !n || !!busy}
        title={
          !cfg.incrementalTool
            ? t('还没选增量编译用哪个项目工具：到「编译」页签左边选')
            : !n
              ? t('上次编译成功以来没有改过的文件')
              : t('只编勾上的 {n} 个改过的文件', { n })
        }
        onClick={() => void start('incremental')}
      >
        {b.running && mode === 'incremental' ? spin : <Zap className="ue:h-3.5 ue:w-3.5" />}
        {n ? t('增量编译 · {n}', { n }) : t('增量编译')}
      </ui.Button>
      <ui.Button
        size="sm"
        variant="secondary"
        disabled={!cfg.fullTool || b.running || !!busy}
        title={!cfg.fullTool ? t('还没选全编译用哪个项目工具：到「编译」页签左边选') : undefined}
        onClick={() => void start('full')}
      >
        {b.running && mode === 'full' ? spin : <Layers className="ue:h-3.5 ue:w-3.5" />}
        {t('全编译')}
      </ui.Button>
    </>
  )
}
