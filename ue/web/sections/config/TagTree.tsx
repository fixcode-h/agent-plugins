import { Copy, Tag, Tags } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { ppost, useAction, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { useKept } from '../../keep.ts'
import { copyText } from '../../menu.tsx'
import { setPending } from '../../pending.ts'
import { DockCol, DockHead } from '../../nav/slot.tsx'
import { PANE_FIXED, SPLIT_ROW, SplitHandle, usePane } from '../../split.tsx'
import { TreeList, type TreeLine } from '../../TreeList.tsx'
import { Badge, Card, ErrorText, Note, SearchBox } from '../../ui.tsx'

interface TagRow {
  tag: string
  comment?: string
  source?: string
}
interface TagsRes {
  items: TagRow[]
  total: number
  live: boolean
  note?: string
}
interface Node {
  name: string
  full: string
  row?: TagRow
  kids: Map<string, Node>
}

/** 按「.」拆成树；只有子 Tag 写了、父级没写的（隐式父级）也补出来 */
function buildTree(rows: TagRow[]) {
  const root: Node = { name: '', full: '', kids: new Map() }
  for (const r of rows) {
    let cur = root
    const parts = r.tag.split('.')
    parts.forEach((p, i) => {
      const full = parts.slice(0, i + 1).join('.')
      let next = cur.kids.get(p)
      if (!next) {
        next = { name: p, full, kids: new Map() }
        cur.kids.set(p, next)
      }
      cur = next
    })
    cur.row = r
  }
  return root
}

/**
 * GameplayTag 树：UE 开着时是进程里登记的全部 Tag（含 C++ 原生的、DataTable 里的），没开时读项目和插件的 Tag ini。
 * 选中一个看注释、来源，点「查引用」列出引用它的资源（只有资源注册表知道，编辑器没开时走后台编辑器）。
 * 筛选只在网页里筛已经取到的列表，边打边筛
 */
export function TagTree() {
  const { project, go } = useUe()
  const { ui } = h()
  const { busy, run } = useAction()
  const pane = usePane('tags', '40%', 260)
  const left = useRef<HTMLElement>(null)
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useKept<string[]>(`tags-open:${project.id}`, [])
  const [sel, setSel] = useKept(`tags-sel:${project.id}`, '')
  const [refs, setRefs] = useState<{ tag: string; items: string[]; total: number; loading?: boolean }>()
  const tags = useLoad(() => ppost<TagsRes>(project.id, 'tools/tags', {}), [project.id])
  const tree = useMemo(() => buildTree(tags.data?.items ?? []), [tags.data])
  const byName = useMemo(() => new Map((tags.data?.items ?? []).map((r) => [r.tag, r])), [tags.data])

  const lines = useMemo(() => {
    const out: TreeLine[] = []
    const f = filter.toLowerCase()
    // 筛选时只留自己或子孙对得上的，并且全部展开
    const hit = (n: Node): boolean => n.full.toLowerCase().includes(f) || [...n.kids.values()].some(hit)
    const walk = (n: Node, depth: number) => {
      for (const k of [...n.kids.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        if (f && !hit(k)) continue
        const expandable = k.kids.size > 0
        const isOpen = !!f || open.includes(k.full)
        out.push({
          key: k.full,
          depth,
          label: k.name,
          icon: Tag,
          iconTone: k.row ? 'ue:text-accent-text' : undefined,
          expandable,
          open: isOpen,
          selected: sel === k.full,
          title: k.row?.comment ? `${k.full}\n${k.row.comment}` : k.full,
          aside: expandable ? <span className="ue:text-caption ue:text-subtle">{k.kids.size}</span> : undefined,
          onToggle: () => setOpen((o) => (o.includes(k.full) ? o.filter((x) => x !== k.full) : [...o, k.full])),
          onSelect: () => {
            setSel(k.full)
            setRefs(undefined)
          },
        })
        if (expandable && isOpen) walk(k, depth + 1)
      }
    }
    walk(tree, 0)
    return out
    // setOpen、setSel 每次渲染都是新的，按数据变化重算就够
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, open, sel, filter])

  const row = byName.get(sel)
  const loadRefs = () =>
    run('refs', async () =>
      setRefs({
        tag: sel,
        ...(await ppost<{ items: string[]; total: number; loading?: boolean }>(project.id, 'tools/tags/refs', {
          tag: sel,
        })),
      }),
    )

  const aside =
    tags.data &&
    (tags.data.live ? (
      <Badge tone="ok">{t('{n} 个 · 进程里登记的', { n: tags.data.total })}</Badge>
    ) : (
      <Badge title={tags.data.note}>{t('{n} 个 · 只读了 ini', { n: tags.data.total })}</Badge>
    ))
  const col = (docked: boolean) => (
    <>
      {docked && <DockHead title="GameplayTag" aside={aside} />}
      <div className={docked ? 'ue:pb-2' : 'ue:border-b ue:border-line ue:p-3'}>
        <SearchBox placeholder={t('Tag 名包含…')} onSearch={setFilter} live />
      </div>
      <ErrorText>{tags.error}</ErrorText>
      {tags.data && !tags.data.live && (
        <p className="ue:px-3 ue:pt-2 ue:text-caption ue:text-subtle">
          {t('UE 没连上：只列出 ini 里写的 Tag，C++ 原生的和 DataTable 里的要开着编辑器才有')}
        </p>
      )}
      <TreeList lines={lines} label={t('GameplayTag 树')} />
    </>
  )

  return (
    <div className={SPLIT_ROW}>
      {/* Tag 树整栏放进左边二级面板（用户 2026-11-18 定） */}
      <DockCol
        body={col}
        fallback={
          <>
            <Card
              ref={left}
              className={PANE_FIXED}
              style={pane.style('70%')}
              bodyClass="ue:flex ue:min-h-0 ue:flex-col"
              title={<Tags className="ue:h-4 ue:w-4 ue:text-subtle" />}
              aside={
                tags.data &&
                (tags.data.live ? (
                  <Badge tone="ok">{t('{n} 个 · 进程里登记的', { n: tags.data.total })}</Badge>
                ) : (
                  <Badge title={tags.data.note}>{t('{n} 个 · 只读了 ini', { n: tags.data.total })}</Badge>
                ))
              }
            >
              {col(false)}
            </Card>
            <SplitHandle pane={pane} paneRef={left} reserve={() => 320} />
          </>
        }
      />
      <Card
        className="ue:min-w-0 ue:lg:flex-1"
        bodyClass="ue:overflow-auto"
        title={sel ? <span className="ue:truncate ue:font-mono">{sel}</span> : t('选一个 Tag')}
        aside={sel && <ui.IconButton icon={Copy} size="xs" label={t('复制 Tag 名')} onClick={() => copyText(sel)} />}
      >
        {!sel ? (
          <div className="ue:p-4">
            <Note tone="info">{t('左边选一个 Tag，看注释、来源和哪些资源引用了它')}</Note>
          </div>
        ) : (
          <div className="ue:flex ue:flex-col ue:gap-3 ue:p-4">
            <dl className="ue:grid ue:grid-cols-[6rem_1fr] ue:gap-x-3 ue:gap-y-1.5 ue:text-footnote">
              <dt className="ue:text-subtle">{t('注释')}</dt>
              <dd className="ue:text-fg">{row?.comment || '—'}</dd>
              <dt className="ue:text-subtle">{t('来源')}</dt>
              <dd className="ue:font-mono ue:text-fg">
                {row?.source || (row ? '—' : t('隐式父级（只因为有子 Tag 才存在）'))}
              </dd>
            </dl>
            <div className="ue:flex ue:items-center ue:gap-2">
              <ui.Button size="sm" variant="secondary" disabled={busy === 'refs'} onClick={() => void loadRefs()}>
                {busy === 'refs' ? t('查询中…') : t('查引用它的资源')}
              </ui.Button>
              {refs?.tag === sel && (
                <span className="ue:text-footnote ue:text-subtle">
                  {t('{n} 个资源', { n: refs.total })}
                  {refs.loading && ` · ${t('资源注册表还在扫盘，结果可能不全')}`}
                </span>
              )}
            </div>
            {refs?.tag === sel && (
              <ul className="ue:divide-y ue:divide-line ue:rounded-lg ue:border ue:border-line">
                {refs.items.map((p) => (
                  <li key={p}>
                    <button
                      type="button"
                      title={t('在资源页里找这个资源')}
                      onClick={() => {
                        setPending('assets', p)
                        go('assets')
                      }}
                      className="ue:flex ue:w-full ue:cursor-pointer ue:px-3 ue:py-1.5 ue:text-left ue:font-mono ue:text-footnote ue:text-accent-text ue:hover:bg-hover"
                    >
                      {p}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
