import { Camera, Pause, Play, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { op, pget, ppost, show, useAction, useLoad } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Card, ErrorText, PageHead, TargetPicker, useTargetInfo } from '../ui.tsx'

interface Item {
  path: string
  prop: string
  label?: string
}

/** 折线最多留多少个点（1 秒一个，两分钟） */
const POINTS = 120

/**
 * 监视：在属性面板里固定的属性每秒刷新一次（一个请求取全部，桥接里每个值最多 500 字符），数值画小折线；
 * 页面不在前台、点了暂停时不刷。下面是截视口
 */
export function Watch() {
  const { project, target, sub } = useUe()
  const { inst } = useTargetInfo()
  const { ui } = h()
  const { busy, run } = useAction()
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
  const [shot, setShot] = useState<{ png: string; width: number; height: number; world: string }>()
  const capture = () =>
    run('shot', async () => setShot(await op(project.id, 'screenshot', { maxWidth: 1600 }, target, 20000)))
  useEffect(() => {
    if (sub === 'shot' && inst) void capture()
    // 从概览「截视口」跳过来时截一次
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [sub, inst?.pid])

  const remove = (i: number) => {
    const watch = items.filter((_, j) => j !== i)
    local.setData({ watch })
    void ppost(project.id, 'local', { watch })
  }

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead title={t('监视')} desc={t('在属性面板里点图钉固定属性，这里每秒刷新')}>
        <TargetPicker />
        <ui.Button size="sm" variant="secondary" onClick={() => setPaused((p) => !p)}>
          {paused ? <Play className="ue:h-3.5 ue:w-3.5" /> : <Pause className="ue:h-3.5 ue:w-3.5" />}{' '}
          {paused ? t('继续') : t('暂停')}
        </ui.Button>
        <ui.Button size="sm" variant="secondary" disabled={!inst || busy === 'shot'} onClick={() => void capture()}>
          <Camera className="ue:h-3.5 ue:w-3.5" /> {t('截视口')}
        </ui.Button>
      </PageHead>
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-4 ue:overflow-auto ue:p-6">
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
        {shot && (
          <Card title={t('视口截图')} aside={`${shot.width}×${shot.height} · ${shot.world}`}>
            <img
              src={`data:image/png;base64,${shot.png}`}
              alt={t('视口截图')}
              className="ue:block ue:w-full ue:rounded-b-xl"
            />
          </Card>
        )}
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
