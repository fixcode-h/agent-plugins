import { GitCompareArrows, MemoryStick, Trash2 } from 'lucide-react'
import { h, t } from '../../host.ts'
import { Badge, LinkBtn, fmtSize, fmtTime, type Tone } from '../../ui.tsx'
import { nameOf, type Active, type Capture } from './types.ts'

const KIND: Record<Capture['kind'], { label: () => string; tone: Tone }> = {
  csv: { label: () => t('帧数据'), tone: 'run' },
  memreport: { label: () => t('内存报告'), tone: 'ok' },
  trace: { label: () => 'trace', tone: 'accent' },
}

function dayOf(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const y = new Date(today)
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return t('今天')
  if (d.toDateString() === y.toDateString()) return t('昨天')
  return t('更早')
}

/**
 * 会话列表（性能页左栏）：最上面固定「实时」和「内存」，下面按天列出抓到的文件。
 * 勾两份同类的出「对比」；删除在行悬停时出现
 */
export function Sessions({
  items,
  totalKB,
  sel,
  onSel,
  picked,
  onPick,
  onCompare,
  onDelete,
  live,
}: {
  items: Capture[]
  totalKB: number
  sel: string
  onSel: (id: string) => void
  picked: string[]
  onPick: (c: Capture) => void
  onCompare: () => void
  onDelete: (c: Capture) => void
  live: { running: boolean; active?: Active; fps?: number; memGB?: number }
}) {
  const { cn, ui } = h()
  const row = (on: boolean) =>
    cn(
      'ue:group ue:mx-2 ue:flex ue:cursor-pointer ue:flex-col ue:gap-0.5 ue:rounded-lg ue:px-2.5 ue:py-2 ue:text-left',
      on ? 'ue:bg-sel' : 'ue:hover:bg-hover',
    )
  const groups: { day: string; list: Capture[] }[] = []
  for (const c of items) {
    const day = dayOf(c.at)
    const g = groups.at(-1)
    if (g && g.day === day) g.list.push(c)
    else groups.push({ day, list: [c] })
  }
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:items-center ue:gap-2 ue:px-4 ue:pt-3 ue:pb-1.5 ue:text-caption ue:text-subtle">
        {t('会话')}
        {picked.length === 2 && (
          <span className="ue:ml-auto">
            <LinkBtn onClick={onCompare}>
              <GitCompareArrows className="ue:h-3.5 ue:w-3.5" /> {t('对比选中的两份')}
            </LinkBtn>
          </span>
        )}
      </div>
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:overflow-auto ue:pb-2">
        <button type="button" className={row(sel === 'live')} onClick={() => onSel('live')}>
          <span className="ue:flex ue:items-center ue:gap-2 ue:text-body">
            <span
              className={cn(
                'ue:h-2 ue:w-2 ue:shrink-0 ue:rounded-full',
                live.active ? 'ue:bg-danger' : live.running ? 'ue:bg-success' : 'ue:bg-subtle/50',
              )}
            />
            <span className="ue:min-w-0 ue:flex-1 ue:truncate">
              <b className="ue:font-medium">{t('实时')}</b>
              <span className="ue:text-subtle">
                {' '}
                · {live.active ? t('正在录制') : live.running ? t('没在录制') : t('UE 没在运行')}
              </span>
            </span>
            {live.active ? (
              <Badge tone="danger">{Math.round(live.active.elapsed)}s</Badge>
            ) : (
              live.fps !== undefined && (
                <span className="ue:font-mono ue:text-caption ue:text-subtle">{live.fps} fps</span>
              )
            )}
          </span>
          <span className="ue:truncate ue:text-caption ue:text-subtle">
            {live.active ? live.active.label : t('读数、帧条和线程曲线，一直都有')}
          </span>
        </button>
        <button type="button" className={row(sel === 'mem')} onClick={() => onSel('mem')}>
          <span className="ue:flex ue:items-center ue:gap-2 ue:text-body">
            <MemoryStick className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-run" />
            <b className="ue:min-w-0 ue:flex-1 ue:font-medium">{t('内存')}</b>
            {live.memGB !== undefined && (
              <span className="ue:font-mono ue:text-caption ue:text-subtle">{live.memGB.toFixed(1)} GB</span>
            )}
          </span>
          <span className="ue:truncate ue:text-caption ue:text-subtle">{t('实时曲线 · 内存报告对比')}</span>
        </button>
        {groups.map((g) => (
          <div key={g.day} className="ue:flex ue:flex-col">
            <div className="ue:mx-4 ue:mt-3 ue:mb-0.5 ue:text-caption ue:text-subtle">{g.day}</div>
            {g.list.map((c) => (
              <div key={c.id} className={row(sel === c.id)} onClick={() => onSel(c.id)}>
                <span className="ue:flex ue:items-center ue:gap-2 ue:text-body">
                  <input
                    type="checkbox"
                    aria-label={t('选来对比')}
                    className="ue:cursor-pointer"
                    disabled={c.kind === 'trace'}
                    checked={picked.includes(c.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onPick(c)}
                  />
                  <Badge tone={KIND[c.kind].tone}>{KIND[c.kind].label()}</Badge>
                  <span className="ue:min-w-0 ue:flex-1 ue:truncate" title={c.file}>
                    {nameOf(c)}
                  </span>
                  <span onClick={(e) => e.stopPropagation()}>
                    <ui.IconButton
                      icon={Trash2}
                      tone="danger"
                      reveal="hover"
                      label={t('删除')}
                      size="xs"
                      onClick={() => onDelete(c)}
                    />
                  </span>
                </span>
                <span className="ue:flex ue:gap-2 ue:truncate ue:pl-6 ue:text-caption ue:text-subtle">
                  <span>{fmtTime(c.at)}</span>
                  <span>{fmtSize(c.sizeKB * 1024)}</span>
                  {c.marks?.length ? <span>{t('{n} 个书签', { n: c.marks.length })}</span> : null}
                  {c.by && <span>{c.by === 'user' ? t('你') : c.by}</span>}
                  {c.imported && <span>{t('导入的')}</span>}
                </span>
              </div>
            ))}
          </div>
        ))}
        {!items.length && (
          <p className="ue:mx-4 ue:mt-4 ue:text-footnote ue:leading-relaxed ue:text-subtle">
            {t('还没有抓取。点右上角「抓帧数据」录一段，或者让 Agent 用 ue_perf 抓')}
          </p>
        )}
      </div>
      <div className="ue:border-t ue:border-line ue:px-4 ue:py-2 ue:text-caption ue:text-subtle">
        {t('{n} 份 · 共 {size} · 存在 Saved/Profiling', { n: items.length, size: fmtSize(totalKB * 1024) })}
      </div>
    </div>
  )
}
