import { Pause, Play, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { op, pget, ppost, show, useLoad } from '../api.ts'
import { STACK } from '../split.tsx'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Card, ErrorText, PageHead, useTargetInfo } from '../ui.tsx'

interface Item {
  path: string
  prop: string
  label?: string
}

/** 折线最多留多少个点（1 秒一个，两分钟） */
const POINTS = 120

/**
 * 监视：在属性面板里固定的属性每秒刷新一次（一个请求取全部，桥接里每个值最多 500 字符），数值画小折线；
 * 页面不在前台、点了暂停时不刷。截视口挪到左栏底部的浮层（界面优化第 15 条）
 */
export function Watch() {
  const { project, target } = useUe()
  const { inst } = useTargetInfo()
  const { ui } = h()
  const local = useLoad(() => pget<{ watch: Item[] }>(project.id, 'local'), [project.id])
  const items = local.data?.watch ?? []
  const [paused, setPaused] = useState(false)
  const series = useRef(new Map<string, number[]>())
  const values = useLoad(
    async () => {
      if (!items.length || !inst || paused) return undefined
      const r = await op<{ values: { value?: unknown; error?: string }[] }>(
        project.id,
        'watch',
        { items },
        target,
        5000,
      )
      r.values.forEach((v, i) => {
        if (typeof v.value !== 'number') return
        const k = `${items[i].path}|${items[i].prop}`
        const s = series.current.get(k) ?? []
        s.push(v.value)
        if (s.length > POINTS) s.shift()
        series.current.set(k, s)
      })
      return r.values
    },
    [items.length, inst?.pid, paused, target.world],
    1000,
  )
  const remove = (i: number) => {
    const watch = items.filter((_, j) => j !== i)
    local.setData({ watch })
    void ppost(project.id, 'local', { watch })
  }

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead title={t('监视')} desc={t('在属性面板里点图钉固定属性，这里每秒刷新')}>
        <ui.Button size="sm" variant="secondary" onClick={() => setPaused((p) => !p)}>
          {paused ? <Play className="ue:h-3.5 ue:w-3.5" /> : <Pause className="ue:h-3.5 ue:w-3.5" />}{' '}
          {paused ? t('继续') : t('暂停')}
        </ui.Button>
      </PageHead>
      <div className={STACK}>
        <ErrorText>{values.error}</ErrorText>
        <Card title={t('固定的属性')} aside={items.length ? t('{n} 项', { n: items.length }) : undefined}>
          <ul className="ue:flex ue:flex-col ue:divide-y ue:divide-line">
            {items.map((it, i) => {
              const v = values.data?.[i]
              const s = series.current.get(`${it.path}|${it.prop}`) ?? []
              return (
                <li
                  key={`${it.path}|${it.prop}`}
                  className="ue:group ue:flex ue:items-center ue:gap-4 ue:px-4 ue:py-2.5"
                >
                  <div className="ue:min-w-0 ue:flex-1">
                    <div className="ue:font-mono ue:text-body ue:text-fg">{it.label || it.prop}</div>
                    <div className="ue:truncate ue:text-caption ue:text-subtle" title={it.path}>
                      {it.path}
                    </div>
                  </div>
                  {s.length > 1 && <Spark points={s} />}
                  <div
                    className="ue:w-40 ue:truncate ue:text-right ue:font-mono ue:text-body ue:text-fg"
                    title={v?.error}
                  >
                    {v?.error ? <span className="ue:text-danger">{t('读不到')}</span> : show(v?.value)}
                  </div>
                  <ui.IconButton
                    icon={Trash2}
                    tone="danger"
                    reveal="hover"
                    label={t('取消监视')}
                    size="xs"
                    onClick={() => remove(i)}
                  />
                </li>
              )
            })}
            {!items.length && (
              <li className="ue:p-6 ue:text-center ue:text-footnote ue:text-subtle">
                {t('还没有固定的属性。在 Actor、运行时对象的属性面板里点图钉')}
              </li>
            )}
          </ul>
        </Card>
      </div>
    </div>
  )
}

function Spark({ points }: { points: number[] }) {
  const w = 120
  const hgt = 28
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const d = points.map((p, i) => `${(i / (POINTS - 1)) * w},${hgt - 2 - ((p - min) / span) * (hgt - 4)}`).join(' ')
  return (
    <svg width={w} height={hgt} className="ue:shrink-0 ue:text-accent" aria-hidden="true">
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}
