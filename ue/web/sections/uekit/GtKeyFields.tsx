import { Check, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { op, ppost } from '../../api.ts'
import { h, t } from '../../host.ts'
import { Badge, ErrorText } from '../../ui.tsx'
import { filterKeys, showValue, type KeyField, type KeysResult } from './gt-key.ts'

/**
 * 「这一格怎么认」的「全部字段」页（效果图 2）：gt.keys 按来源分组列出条目的每个字段和它在容器里命中几个，
 * 勾几个字段就是组合条件（都要满足）。录制中按 step 取按下那一刻的站点，录完按 target 在现在的界面里取。
 * 只列写得进选择器的字段（有 cond 的）才能勾；值里带 [ ] , > / = 的写不进，灰着显示。
 * 给了 cache（录制时存的 hint.fields，GameTest 1.6.0）就先用它：游戏没跑、界面关了也能挑，筛选在网页里做；
 * 想看游戏里现在的值再点「读游戏里现在的」。
 */
export function GtKeyFields({
  project,
  where,
  cache,
  picked,
  onPick,
}: {
  project: string
  where: { step: number } | { target: string }
  cache?: string
  picked: string[]
  onPick: (conds: string[]) => void
}) {
  const { ui, cn } = h()
  const [filter, setFilter] = useState('')
  const [live, setLive] = useState<KeysResult>()
  const [cached, setCached] = useState<KeysResult>()
  const [useCache, setUseCache] = useState(!!cache)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const whereKey = JSON.stringify(where)

  // 缓存只读一次，筛选在网页里做（全量，几百个字段也就几毫秒）
  useEffect(() => {
    if (!cache || !useCache) return
    let alive = true
    setLoading(true)
    ppost<KeysResult>(project, 'ext/gt/keyfields', { file: cache })
      .then((r) => alive && (setCached(r), setErr('')))
      .catch((e: Error) => alive && setErr(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [project, cache, useCache])
  const fromCache = useMemo(() => (cached ? filterKeys(cached, filter) : undefined), [cached, filter])

  useEffect(() => {
    if (useCache) return
    let alive = true
    setLoading(true)
    const timer = setTimeout(() => {
      op<KeysResult>(project, 'gt.keys', { ...where, filter: filter.trim(), limit: 200 })
        .then((r) => alive && (setLive(r), setErr('')))
        .catch((e: Error) => alive && setErr(e.message))
        .finally(() => alive && setLoading(false))
    }, 250)
    return () => {
      alive = false
      clearTimeout(timer)
    }
    // where 每次渲染是新对象：按它的 JSON 判断变没变
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [project, whereKey, filter, useCache])
  const data = useCache ? fromCache : live

  const toggle = (f: KeyField) => {
    if (!f.cond) return
    onPick(picked.includes(f.cond) ? picked.filter((c) => c !== f.cond) : [...picked, f.cond].slice(-3))
  }

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-col ue:gap-2">
      <div className="ue:flex ue:items-center ue:gap-2">
        <ui.Input
          size="sm"
          className="ue:flex-1"
          value={filter}
          placeholder={t('按字段名或值筛')}
          onChange={(e: { target: { value: string } }) => setFilter(e.target.value)}
        />
        {loading && <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin ue:text-subtle" />}
        {data && (
          <span className="ue:shrink-0 ue:text-footnote ue:text-subtle ue:tabular-nums">
            {t('{n} 个字段', { n: data.total })}
          </span>
        )}
      </div>
      {cache && (
        <div className="ue:flex ue:items-center ue:gap-2 ue:text-footnote ue:text-subtle">
          <span className="ue:min-w-0 ue:flex-1 ue:truncate">
            {useCache ? t('录制时存下的字段，值和命中数是录制那一刻的') : t('游戏里现在的字段')}
          </span>
          <ui.Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setErr('')
              setUseCache(!useCache)
            }}
          >
            {useCache ? t('读游戏里现在的') : t('用录制时存的')}
          </ui.Button>
        </div>
      )}
      <ErrorText>{err}</ErrorText>
      {data?.luaNote && <p className="ue:text-footnote ue:text-subtle">{data.luaNote}</p>}
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:rounded-lg ue:border ue:border-line">
        {(data?.groups ?? []).map((g) => (
          <div key={g.source}>
            <div className="ue:sticky ue:top-0 ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line ue:bg-card ue:px-3 ue:py-1.5">
              <span className="ue:text-footnote ue:font-medium ue:text-fg">{g.title}</span>
              {g.class && <span className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">{g.class}</span>}
              {g.note && <span className="ue:ml-auto ue:truncate ue:text-caption ue:text-warning">{g.note}</span>}
            </div>
            {g.fields.map((f) => {
              const on = !!f.cond && picked.includes(f.cond)
              return (
                <label
                  key={f.by}
                  title={f.why}
                  className={cn(
                    'ue:grid ue:min-h-8 ue:grid-cols-[18px_minmax(0,1.2fr)_minmax(0,1fr)_auto] ue:items-center ue:gap-2 ue:border-b ue:border-line/55 ue:px-3',
                    f.cond ? 'ue:cursor-pointer ue:hover:bg-hover' : 'ue:opacity-55',
                    on && 'ue:bg-accent-soft',
                  )}
                >
                  <input
                    type="checkbox"
                    className="ue:accent-accent"
                    checked={on}
                    disabled={!f.cond}
                    onChange={() => toggle(f)}
                  />
                  <span className="ue:truncate ue:font-mono ue:text-footnote ue:text-fg">{f.by}</span>
                  <span className="ue:truncate ue:font-mono ue:text-footnote ue:text-muted">{showValue(f.v)}</span>
                  {f.unique ? (
                    <Badge tone="ok">
                      <Check className="ue:mr-0.5 ue:h-3 ue:w-3" />
                      {t('唯一')}
                    </Badge>
                  ) : (
                    <Badge tone="warn">{t('命中 {n} 个', { n: f.hits ?? 0 })}</Badge>
                  )}
                </label>
              )
            })}
          </div>
        ))}
        {data && !data.groups.length && (
          <p className="ue:px-3 ue:py-6 ue:text-center ue:text-footnote ue:text-subtle">{t('没有字段')}</p>
        )}
      </div>
      {(data?.hasMore || data?.truncated) && (
        <p className="ue:text-caption ue:text-subtle">{t('字段太多只列了前面一部分，用上面的筛选找')}</p>
      )}
    </div>
  )
}
