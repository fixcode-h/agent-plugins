import { History as HistoryIcon, Undo2 } from 'lucide-react'
import type { HistoryItem } from '../../../server/types.ts'
import { useUe } from '../../ctx.tsx'
import { t } from '../../host.ts'
import { Card, LinkBtn } from '../../ui.tsx'
import { Skeleton } from '../perf/parts.tsx'
import { TimelineRow } from './parts.tsx'

interface Ev {
  key: string
  at: number
  tag: string
  tone: 'danger' | 'warn' | 'accent' | 'muted'
  text: string
  sub?: string
  onClick: () => void
  undo?: HistoryItem
}

/**
 * 窄屏上下排时固定成 10 行的高度（最多列 10 条），条数变了版面不跳，带报错第二行的多了就在里面滚；
 * 宽屏两栏时（用户 2026-11-21）占满左栏剩下的高度，由 Card 的内容区滚动
 */
const TIMELINE_BODY = 'ue:h-[23rem] ue:overflow-auto ue:lg:h-auto ue:lg:overflow-visible'

const hms = (ms: number) =>
  ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'

/**
 * 「最近发生的」（设计稿三.1）：日志里的错误和警告、你和 Agent 的修改、崩溃放一条时间线，新的在上；
 * 点一行跳到对应分区，还在生效的修改行尾能直接撤回。数据是徽标请求和操作记录里已有的，不另外取
 */
export function Timeline({
  history,
  busy,
  onUndo,
  className,
}: {
  /** 外框的类名：概览两栏布局里让它占满左栏剩下的高度 */
  className?: string
  /** 还没取到时是 undefined，显示占位 */
  history?: HistoryItem[]
  busy: boolean
  onUndo: (it: HistoryItem) => void
}) {
  const { badges, go } = useUe()
  const ex = badges?.overview
  const evs: Ev[] = [
    ...(ex?.logs ?? []).map((l, i) => ({
      key: `log:${i}:${l.at ?? ''}`,
      at: l.at ?? 0,
      tag: l.level === 'error' ? t('错误') : t('警告'),
      tone: l.level === 'error' ? ('danger' as const) : ('warn' as const),
      text: l.category ? `${l.category}: ${l.text}` : l.text,
      onClick: () => go('logs', l.level === 'error' ? 'error' : ''),
    })),
    ...(history ?? []).slice(0, 8).map((it) => ({
      key: `h:${it.id}`,
      at: Date.parse(it.at),
      tag: it.actor.kind === 'user' ? t('你') : 'Agent',
      tone: it.actor.kind === 'user' ? ('muted' as const) : ('accent' as const),
      text: `${it.op} ${it.summary}`,
      sub: it.error,
      onClick: () => go('history'),
      undo: it.undo && !it.undone ? it : undefined,
    })),
    ...(ex?.crash
      ? [
          {
            key: `crash:${ex.crash.id}`,
            at: Date.parse(ex.crash.at),
            tag: t('崩溃'),
            tone: 'danger' as const,
            text: ex.crash.error.split('\n')[0] || ex.crash.id,
            onClick: () => go('logs', 'crash'),
          },
        ]
      : []),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 10)
  return (
    <Card
      className={className}
      bodyClass="ue:lg:overflow-auto"
      title={
        <>
          <HistoryIcon className="ue:h-4 ue:w-4" /> {t('最近发生的')}
        </>
      }
      aside={<LinkBtn onClick={() => go('history')}>{t('全部操作记录')}</LinkBtn>}
    >
      <div className={TIMELINE_BODY}>
        {!history && !ex ? (
          <Skeleton rows={6} />
        ) : (
          <ul className="ue:flex ue:flex-col ue:divide-y ue:divide-line">
            {evs.map((e) => (
              <TimelineRow
                key={e.key}
                time={hms(e.at)}
                tag={e.tag}
                tone={e.tone}
                text={e.text}
                sub={e.sub}
                onClick={e.onClick}
                aside={
                  e.undo ? (
                    <LinkBtn disabled={busy} onClick={() => onUndo(e.undo!)}>
                      <Undo2 className="ue:h-3 ue:w-3" /> {t('撤回修改')}
                    </LinkBtn>
                  ) : undefined
                }
              />
            ))}
            {!evs.length && (
              <li className="ue:px-4 ue:py-6 ue:text-center ue:text-footnote ue:text-subtle">
                {t('还没有动静。日志里的错误、你和 Agent 的修改都会按时间列在这里')}
              </li>
            )}
          </ul>
        )}
      </div>
    </Card>
  )
}
