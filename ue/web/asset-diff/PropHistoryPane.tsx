import { History, Loader2, Undo2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PropRef } from '../../shared/asset-diff/prop-history.ts'
import type { HistEntry } from '../../server/asset-diff/history.ts'
import { ppost } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { SplitHandle, usePane } from '@panel/web/src/components/ui/split-pane'
import { fmtValue, fullValue } from './format.ts'
import { Mark } from './PropGrid.tsx'
import { useDiffPrefs } from './prefs.ts'

/**
 * 属性的来历（设计稿「UE资源版本差异-修复与强化」3.6）：右边一个可拖宽的窄栏，从当前看的那一版往回逐版读这个属性，
 * 读到「这个值是哪一版改成这样的」就停，要更早的点「继续往回」；一次最多读几版在设置 → 组件「版本差异」。
 * 能「跳到那一版」；看的是编辑器里那份、而且是类默认值时能「改回这个值」（走现有改属性）
 */
export function PropHistoryPane({
  pkg,
  propRef,
  label,
  start,
  onClose,
  onJump,
  onSet,
}: {
  pkg: string
  propRef: PropRef
  label: string
  /** 从哪一版往回：live / disk / 提交号 */
  start: string
  onClose: () => void
  onJump: (rev: string) => void
  onSet?: (value: unknown) => void
}) {
  const { project } = useUe()
  const { ui, cn } = h()
  const { historyMax } = useDiffPrefs()
  const pane = usePane('asset-diff.prop-history', '22rem', 240)
  const ref = useRef<HTMLElement>(null)
  const [entries, setEntries] = useState<HistEntry[]>([])
  const [next, setNext] = useState<number | undefined>(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refKey = JSON.stringify(propRef)
  const load = (offset: number, reset = false) => {
    setBusy(true)
    setError('')
    ppost<{ entries: HistEntry[]; next?: number }>(project.id, 'asset-prop-history', {
      path: pkg,
      ref: propRef,
      start,
      offset,
      max: historyMax,
    })
      .then((r) => {
        setEntries((old) => [...(reset ? [] : old), ...r.entries])
        setNext(r.next)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }
  useEffect(() => {
    setEntries([])
    load(0, true)
    // 换了属性或起点才重读；load 每次渲染都是新的
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [refKey, start, project.id, pkg])
  const origin = entries.findLast((e) => e.changed)
  return (
    <>
      <SplitHandle pane={pane} paneRef={ref} side="right" reserve={() => 360} />
      <section
        ref={ref}
        className="ue:flex ue:min-h-0 ue:shrink-0 ue:flex-col ue:overflow-auto ue:border-l ue:border-line"
        style={pane.style('60%')}
      >
        <div className="ue:flex ue:h-9 ue:shrink-0 ue:items-center ue:gap-1.5 ue:border-b ue:border-line ue:px-3">
          <History className="ue:h-3.5 ue:w-3.5 ue:text-subtle" />
          <span className="ue:min-w-0 ue:truncate ue:text-footnote ue:font-medium" title={label}>
            {t('来历：{name}', { name: label })}
          </span>
          <span className="ue:ml-auto">
            <ui.IconButton icon={X} size="sm" label={t('关闭')} onClick={onClose} />
          </span>
        </div>
        <ul className="ue:flex ue:flex-col ue:divide-y ue:divide-line/60 ue:text-footnote">
          {entries.map((e) => (
            <li
              key={e.rev}
              className={cn('ue:flex ue:flex-col ue:gap-1 ue:px-3 ue:py-2', e === origin && 'ue:bg-sel')}
            >
              <div className="ue:flex ue:items-center ue:gap-1.5">
                <button
                  type="button"
                  className="ue:cursor-pointer ue:font-mono ue:text-fg ue:hover:underline"
                  title={t('跳到这一版')}
                  onClick={() => onJump(e.rev)}
                >
                  {e.rev === 'live' ? t('编辑器里') : e.rev === 'disk' ? t('本地') : e.label}
                </button>
                {e.author && <span className="ue:truncate ue:text-caption ue:text-subtle">{e.author}</span>}
                <span className="ue:ml-auto ue:flex ue:shrink-0 ue:items-center ue:gap-1">
                  {e.changed && <Mark kind={entries.at(-1) === e && !next ? 'add' : 'mod'}>{t('改成这个')}</Mark>}
                  {onSet && e.found && e.rev !== start && (
                    <ui.IconButton icon={Undo2} size="sm" label={t('改回这个值')} onClick={() => onSet(e.value)} />
                  )}
                </span>
              </div>
              {e.message && <p className="ue:line-clamp-2 ue:text-caption ue:text-subtle">{e.message}</p>}
              <code
                className={cn('ue:block ue:truncate ue:font-mono', e.found ? 'ue:text-fg' : 'ue:text-subtle')}
                title={e.found ? fullValue(e.value) : undefined}
              >
                {e.found ? fmtValue(e.value) : t('（这一版没有这一项）')}
              </code>
            </li>
          ))}
        </ul>
        <div className="ue:flex ue:flex-col ue:gap-2 ue:px-3 ue:py-2.5 ue:text-footnote ue:text-subtle">
          {busy && (
            <span className="ue:flex ue:items-center ue:gap-1.5">
              <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" />
              {t('逐版往回读（读过的版本有缓存）…')}
            </span>
          )}
          {error && <span className="ue:text-danger">{error}</span>}
          {!busy && next !== undefined && entries.length > 0 && (
            <ui.Button size="sm" variant="secondary" onClick={() => load(next)}>
              {t('继续往回')}
            </ui.Button>
          )}
          {!busy && !error && next === undefined && entries.length > 0 && (
            <span>{t('到头了：再往前没有这一项或没有更早的版本')}</span>
          )}
        </div>
      </section>
    </>
  )
}
