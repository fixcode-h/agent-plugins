import { Pin, PersonStanding, Puzzle, RefreshCw, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { op, pget, ppost, useLoad } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Props } from '../Props.tsx'
import { PANE_FILL, PANE_FIXED, SPLIT_ROW, SplitHandle, usePane } from '../split.tsx'
import { Card, ErrorText, PageHead, SearchBox, TargetPicker, useTargetInfo } from '../ui.tsx'

interface ActorRow {
  path: string
  name: string
  class: string
  label: string
  level: string
  player: boolean
}
interface Comp {
  path: string
  name: string
  class: string
  parent: string
  root: boolean
}
interface Local {
  recent: string[]
  pinned: { path: string; label: string }[]
}

/**
 * Actor（图 4）：不做场景树。左栏按名字前缀搜（点搜索才搜，空的不搜），最近搜过和固定的 Actor；
 * 中栏组件树；右栏属性
 */
export function Actors() {
  const { project, target, sub, go } = useUe()
  const { inst } = useTargetInfo()
  const { cn, ui } = h()
  const [q, setQ] = useState('')
  const [actor, comp] = sub.split('|')
  // 三栏：Actor 列表、组件两栏宽度可拖，属性表占剩下的、至少留 320px
  const listPane = usePane('actors.list', '26%', 200)
  const compPane = usePane('actors.comps', '22%', 180)
  const listRef = useRef<HTMLElement>(null)
  const compRef = useRef<HTMLElement>(null)
  const widthOf = (r: { current: HTMLElement | null }) => r.current?.getBoundingClientRect().width ?? 0
  const local = useLoad(() => pget<Local>(project.id, 'local'), [project.id])
  const found = useLoad(
    () =>
      q
        ? op<{ items: ActorRow[]; more: boolean; world: string }>(
            project.id,
            'actors',
            { prefix: q, limit: 200 },
            target,
          )
        : Promise.resolve(undefined),
    [q, target.instance, target.world],
  )
  const comps = useLoad(
    () =>
      actor ? op<{ items: Comp[] }>(project.id, 'components', { path: actor }, target) : Promise.resolve(undefined),
    [actor],
  )

  const search = (s: string) => {
    setQ(s)
    const recent = [s, ...(local.data?.recent ?? []).filter((x) => x !== s)].slice(0, 12)
    local.setData({ ...(local.data ?? { pinned: [] }), recent } as Local)
    void ppost(project.id, 'local', { recent })
  }
  const togglePin = (path: string, label: string) => {
    const pinned = local.data?.pinned ?? []
    const next = pinned.some((p) => p.path === path)
      ? pinned.filter((p) => p.path !== path)
      : [...pinned, { path, label }]
    local.setData({ ...(local.data ?? { recent: [] }), pinned: next } as Local)
    void ppost(project.id, 'local', { pinned: next })
  }

  // 组件按父子缩进：桥接给了每个场景组件的父组件路径
  const tree = (() => {
    const items = comps.data?.items ?? []
    const depth = (c: Comp, n = 0): number => {
      const p = items.find((x) => x.path === c.parent)
      return p && n < 12 ? depth(p, n + 1) : n
    }
    return items.map((c) => ({ ...c, depth: depth(c) }))
  })()

  const chip =
    'ue:flex ue:h-7 ue:max-w-full ue:cursor-pointer ue:items-center ue:gap-1.5 ue:rounded-md ue:border ue:border-line ue:px-2 ue:font-mono ue:text-footnote ue:text-fg ue:hover:bg-hover'

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead title="Actor" desc={t('按名字前缀搜索，不列场景树')}>
        <TargetPicker />
        <ui.Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void found.reload()
            void comps.reload()
          }}
        >
          <RefreshCw className="ue:h-3.5 ue:w-3.5" /> {t('刷新')}
        </ui.Button>
      </PageHead>
      {!inst ? (
        <div className="ue:p-6">
          <ui.EmptyPanel>{t('UE 没在运行：Actor 只在运行中的编辑器或游戏里有')}</ui.EmptyPanel>
        </div>
      ) : (
        <div className={SPLIT_ROW}>
          <Card
            ref={listRef}
            className={PANE_FIXED}
            style={listPane.style(`calc(100% - ${compPane.size} - 352px)`)}
            bodyClass="ue:flex ue:min-h-0 ue:flex-col"
          >
            <div className="ue:flex ue:flex-col ue:gap-2 ue:border-b ue:border-line ue:p-3">
              <SearchBox
                placeholder={t('Actor 名字开头，例如 BP_Hero')}
                hint={t('前缀')}
                onSearch={search}
                busy={found.loading}
              />
              {found.data && (
                <span className="ue:text-footnote ue:text-subtle">
                  {found.data.more
                    ? t('匹配对象名和显示名开头 · 超过 {n} 个，只列前 {n} 个，再多输几个字', {
                        n: found.data.items.length,
                      })
                    : t('匹配对象名和显示名开头 · {n} 个', { n: found.data.items.length })}
                </span>
              )}
              <ErrorText>{found.error}</ErrorText>
            </div>
            <ul className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:p-1.5">
              {(found.data?.items ?? []).map((a) => (
                <li key={a.path}>
                  <button
                    type="button"
                    onClick={() => go('actors', a.path)}
                    className={cn(
                      'ue:flex ue:w-full ue:cursor-pointer ue:flex-col ue:rounded-lg ue:px-2.5 ue:py-1.5 ue:text-left ue:hover:bg-hover',
                      actor === a.path && 'ue:bg-sel',
                    )}
                  >
                    <span className="ue:flex ue:items-center ue:gap-1.5 ue:text-body ue:text-fg">
                      <PersonStanding className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
                      <span className="ue:truncate">{a.label || a.name}</span>
                      {a.player && <span className="ue:ml-auto ue:text-caption ue:text-subtle">{t('玩家')}</span>}
                    </span>
                    <span className="ue:truncate ue:pl-5 ue:text-caption ue:text-subtle">
                      {a.class} · {a.level}
                    </span>
                  </button>
                </li>
              ))}
              {!q && (
                <li className="ue:p-4 ue:text-center ue:text-footnote ue:text-subtle">
                  {t('输入名字开头点「搜索」；不列全部 Actor')}
                </li>
              )}
            </ul>
            {(!!local.data?.pinned.length || !!local.data?.recent.length) && (
              <div className="ue:flex ue:flex-col ue:gap-2 ue:border-t ue:border-line ue:p-3">
                {!!local.data?.pinned.length && (
                  <span className="ue:text-footnote ue:text-subtle">{t('固定的 Actor')}</span>
                )}
                <div className="ue:flex ue:flex-wrap ue:gap-1.5">
                  {local.data?.pinned.map((p) => (
                    <button
                      key={p.path}
                      type="button"
                      className={chip}
                      onClick={() => go('actors', p.path)}
                      title={p.path}
                    >
                      <Pin className="ue:h-3 ue:w-3 ue:text-subtle" /> <span className="ue:truncate">{p.label}</span>
                    </button>
                  ))}
                </div>
                {!!local.data?.recent.length && (
                  <span className="ue:text-footnote ue:text-subtle">{t('最近搜过')}</span>
                )}
                <div className="ue:flex ue:flex-wrap ue:gap-1.5">
                  {local.data?.recent.map((r) => (
                    <button key={r} type="button" className={chip} onClick={() => setQ(r)}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>
          <SplitHandle pane={listPane} paneRef={listRef} reserve={() => widthOf(compRef) + 352} />

          <Card
            ref={compRef}
            className={PANE_FIXED}
            style={compPane.style(`calc(100% - ${listPane.size} - 352px)`)}
            title={t('组件')}
            aside={
              actor && (
                <span className="ue:flex ue:items-center ue:gap-1">
                  <span className="ue:max-w-32 ue:truncate">{actor.split('.').pop()}</span>
                  <ui.IconButton
                    icon={local.data?.pinned.some((p) => p.path === actor) ? X : Pin}
                    label={local.data?.pinned.some((p) => p.path === actor) ? t('取消固定') : t('固定这个 Actor')}
                    size="xs"
                    onClick={() => togglePin(actor, actor.split('.').pop() ?? actor)}
                  />
                </span>
              )
            }
            bodyClass="ue:overflow-auto ue:p-1.5"
          >
            {!actor && (
              <p className="ue:p-4 ue:text-center ue:text-footnote ue:text-subtle">{t('先在左边选一个 Actor')}</p>
            )}
            <ErrorText>{comps.error}</ErrorText>
            {actor && (
              <button
                type="button"
                onClick={() => go('actors', actor)}
                className={cn(
                  'ue:flex ue:h-8 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-lg ue:px-2.5 ue:text-body ue:hover:bg-hover',
                  !comp && 'ue:bg-sel',
                )}
              >
                <PersonStanding className="ue:h-3.5 ue:w-3.5 ue:text-subtle" /> {t('（Actor 自身）')}
              </button>
            )}
            {tree.map((c) => (
              <button
                key={c.path}
                type="button"
                onClick={() => go('actors', `${actor}|${c.path}`)}
                style={{ paddingLeft: 10 + c.depth * 14 }}
                className={cn(
                  'ue:flex ue:h-8 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-lg ue:pr-2.5 ue:text-body ue:hover:bg-hover',
                  comp === c.path && 'ue:bg-sel',
                )}
                title={c.class}
              >
                <Puzzle className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
                <span className="ue:truncate">{c.name}</span>
              </button>
            ))}
          </Card>
          <SplitHandle pane={compPane} paneRef={compRef} reserve={() => widthOf(listRef) + 352} />

          <Card className={PANE_FILL} bodyClass="ue:flex ue:min-h-0 ue:flex-col">
            {actor ? (
              <Props
                key={comp || actor}
                path={comp || actor}
                onOpen={(p) => go(p.startsWith('/Game') ? 'assets' : 'objects', p)}
              />
            ) : (
              <p className="ue:p-6 ue:text-center ue:text-footnote ue:text-subtle">
                {t('选中 Actor 或组件后在这里看和改属性')}
              </p>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
