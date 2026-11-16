import { h, t } from '../../host.ts'

/**
 * 一个场景最近几次运行的历史条（GameTest 1.2 的 gt.history）：一格一次，绿通过、红失败，最新在最右；
 * 没跑满 10 次的空格留浅底，长度固定，列表里一列对齐。marks 是 UE 给的串，最新在前（p 通过、f 失败）
 */
export function GtHistoryBar({ marks, keep = 10 }: { marks?: string; keep?: number }) {
  const { cn } = h()
  const runs = (marks ?? '').slice(0, keep).split('').reverse()
  const passed = runs.filter((m) => m === 'p').length
  const cells = [...Array<string>(keep - runs.length).fill(''), ...runs]
  return (
    <span
      className="ue:inline-flex ue:h-2.5 ue:shrink-0 ue:items-stretch ue:gap-px"
      title={
        runs.length
          ? t('最近 {n} 次：通过 {p}，失败 {f}（最新在右）', { n: runs.length, p: passed, f: runs.length - passed })
          : t('还没有运行记录')
      }
    >
      {cells.map((m, i) => (
        <span
          key={i}
          className={cn(
            'ue:w-[3px] ue:rounded-[1px]',
            m === 'p' ? 'ue:bg-success' : m === 'f' ? 'ue:bg-danger' : 'ue:bg-sel',
          )}
        />
      ))}
    </span>
  )
}
