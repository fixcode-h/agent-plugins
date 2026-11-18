import { ChevronRight, Folder, ListTree, Loader2, Monitor, Plus, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAction } from '../../api.ts'
import { h, t } from '../../host.ts'
import { ErrorText } from '../../ui.tsx'
import { buildRows, type TreeRow } from './gt-key-tree.ts'
import { loadKeyRules, writeKeyRules } from './gt-key-rules-io.ts'
import { tidyKeyRules, type GtKeyRule } from './GtKeyRules.tsx'

/** 行高固定，只画滚到的那几十行：规则上千条也不卡 */
const ROW = 32
const OVERSCAN = 12

/**
 * 条目规则面板（GameTest 1.5.0 那批）：场景根 `_settings.json` 的 itemKeys，按「屏 → 容器 → 条目」树形列出，
 * 能搜（条目类、容器、字段），选中一条在右边改、删，也能手加。直接读写磁盘，编辑器没开也能整理。
 * 规则一般是录制弹窗、步骤详情里勾「记成规则」加的；录制时点到这些条目直接按规则认，不再问。
 */
export function GtKeyRulesPanel({ project, root, onClose }: { project: string; root: string; onClose: () => void }) {
  const { ui, cn, toast } = h()
  const { busy, run } = useAction()
  const [rules, setRules] = useState<GtKeyRule[]>()
  const [dirty, setDirty] = useState(false)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [sel, setSel] = useState<number>()
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    loadKeyRules(project, root)
      .then((r) => alive && setRules(r))
      .catch((e: Error) => alive && setErr(e.message))
    return () => {
      alive = false
    }
  }, [project, root])

  const { rows, total } = useMemo(
    () => buildRows(rules ?? [], query, collapsed, { any: t('任何容器'), noScreen: t('没写屏') }),
    [rules, query, collapsed],
  )

  const toggle = (id: string) =>
    setCollapsed((old) => {
      const next = new Set(old)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const change = (next: GtKeyRule[]) => {
    setRules(next)
    setDirty(true)
  }
  const patch = (i: number, p: Partial<GtKeyRule>) =>
    rules && change(rules.map((r, k) => (k === i ? { ...r, ...p } : r)))
  const remove = (indexes: number[]) => {
    if (!rules) return
    const drop = new Set(indexes)
    change(rules.filter((_, k) => !drop.has(k)))
    setSel(undefined)
  }
  const add = () => {
    const next = [...(rules ?? []), { entry: '', by: [] }]
    change(next)
    setQuery('')
    setSel(next.length - 1)
  }
  const save = () =>
    run('save', async () => {
      setErr('')
      try {
        const saved = await writeKeyRules(project, root, tidyKeyRules(rules ?? []))
        setRules(saved)
        setDirty(false)
        setSel(undefined)
        toast.success(t('已保存 {n} 条规则，下次录制生效', { n: saved.length }))
      } catch (e) {
        setErr((e as Error).message)
      }
    })

  const current = sel !== undefined ? rules?.[sel] : undefined
  return (
    <ui.Modal
      open
      size="xl"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('条目规则')}
      footer={
        <>
          <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-footnote ue:text-subtle">
            {dirty ? t('有改动没保存') : t('存在场景根的 _settings.json，全组共用')}
          </span>
          <ui.Button variant="secondary" onClick={onClose}>
            {dirty ? t('不保存') : t('关闭')}
          </ui.Button>
          <ui.Button disabled={!!busy || !dirty} onClick={save}>
            {t('保存')}
          </ui.Button>
        </>
      }
    >
      <p className="ue:text-footnote ue:leading-relaxed ue:text-subtle">
        {t(
          '录制时点到列表、格子里的这些条目，直接按规则里的字段认，不再暂停问。录制弹窗、步骤详情里勾「记成规则」会加到这里；容器不写就是这类条目在哪个容器里都这样认。',
        )}
      </p>
      <div className="ue:flex ue:items-center ue:gap-2">
        <div className="ue:relative ue:flex-1">
          <Search className="ue:pointer-events-none ue:absolute ue:top-1/2 ue:left-2.5 ue:h-3.5 ue:w-3.5 ue:-translate-y-1/2 ue:text-subtle" />
          <ui.Input
            size="sm"
            className="ue:pl-8"
            value={query}
            placeholder={t('搜条目类、容器或字段')}
            onChange={(e: { target: { value: string } }) => setQuery(e.target.value)}
          />
        </div>
        <span className="ue:shrink-0 ue:text-footnote ue:text-subtle ue:tabular-nums">
          {query ? t('{n} / {m} 条', { n: total, m: rules?.length ?? 0 }) : t('{n} 条', { n: rules?.length ?? 0 })}
        </span>
        <ui.Button size="sm" variant="secondary" disabled={!rules} onClick={add}>
          <Plus className="ue:h-3.5 ue:w-3.5" /> {t('添加')}
        </ui.Button>
      </div>
      <ErrorText>{err}</ErrorText>
      <div className="ue:grid ue:h-[min(60vh,560px)] ue:min-h-0 ue:gap-3 ue:md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {!rules ? (
          <div className="ue:flex ue:items-center ue:justify-center ue:rounded-lg ue:border ue:border-line">
            {!err && <Loader2 className="ue:h-4 ue:w-4 ue:animate-spin ue:text-subtle" />}
          </div>
        ) : (
          <VirtualTree
            rows={rows}
            empty={query ? t('没有对得上的规则') : t('还没有规则')}
            render={(r) =>
              r.kind === 'group' ? (
                <button
                  type="button"
                  onClick={() => toggle(r.id)}
                  className="ue:flex ue:h-full ue:w-full ue:items-center ue:gap-1.5 ue:pr-3 ue:text-left ue:hover:bg-hover"
                  style={{ paddingLeft: 8 + r.depth * 16 }}
                >
                  <ChevronRight
                    className={cn(
                      'ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle ue:transition-transform',
                      r.open && 'ue:rotate-90',
                    )}
                  />
                  {r.depth === 0 ? (
                    <Monitor className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
                  ) : (
                    <Folder className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
                  )}
                  <span className="ue:truncate ue:font-mono ue:text-footnote ue:text-fg">{r.label}</span>
                  <span className="ue:ml-auto ue:shrink-0 ue:text-caption ue:text-subtle ue:tabular-nums">
                    {r.count}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setSel(r.index)}
                  className={cn(
                    'ue:grid ue:h-full ue:w-full ue:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] ue:items-center ue:gap-2 ue:pr-3 ue:text-left ue:hover:bg-hover',
                    sel === r.index && 'ue:bg-accent-soft',
                  )}
                  style={{ paddingLeft: 8 + r.depth * 16 + 20 }}
                >
                  <span className="ue:truncate ue:font-mono ue:text-footnote ue:text-fg">
                    {r.rule.entry || t('（没填条目类）')}
                  </span>
                  <span className="ue:truncate ue:font-mono ue:text-footnote ue:text-muted">
                    {r.rule.by.join(', ')}
                  </span>
                </button>
              )
            }
          />
        )}
        <div className="ue:flex ue:min-h-0 ue:flex-col ue:gap-3 ue:overflow-auto ue:rounded-lg ue:border ue:border-line ue:p-3">
          {current && sel !== undefined ? (
            <>
              <Field label={t('条目类')} hint={t('列表条目的控件类，带不带 _C 都行')}>
                <ui.Input
                  size="sm"
                  className="ue:font-mono"
                  value={current.entry}
                  placeholder="WBP_BagSlot"
                  onChange={(e: { target: { value: string } }) => patch(sel, { entry: e.target.value })}
                />
              </Field>
              <Field
                label={t('按什么认')}
                hint={t('条件左边的写法，多个用逗号连（都要满足），如 Data.ItemId、@lua.cfgId、@text')}
              >
                <ui.Input
                  size="sm"
                  className="ue:font-mono"
                  value={current.by.join(', ')}
                  placeholder="Data.ItemId"
                  onChange={(e: { target: { value: string } }) => patch(sel, { by: e.target.value.split(',') })}
                />
              </Field>
              <Field
                label={t('只管这个容器')}
                hint={t('选择器前缀，如 WBP_Bag:Root/ItemList；不填 = 在哪个容器里都这样认')}
              >
                <ui.Input
                  size="sm"
                  className="ue:font-mono"
                  value={current.container ?? ''}
                  onChange={(e: { target: { value: string } }) => patch(sel, { container: e.target.value })}
                />
              </Field>
              <div className="ue:mt-auto ue:flex">
                <ui.Button size="sm" variant="ghost" className="ue:text-danger" onClick={() => remove([sel])}>
                  <Trash2 className="ue:h-3.5 ue:w-3.5" /> {t('删除这条')}
                </ui.Button>
              </div>
            </>
          ) : (
            <div className="ue:flex ue:flex-1 ue:flex-col ue:items-center ue:justify-center ue:gap-2 ue:text-center ue:text-footnote ue:text-subtle">
              <ListTree className="ue:h-5 ue:w-5" />
              {t('选左边的一条规则查看和修改')}
            </div>
          )}
        </div>
      </div>
    </ui.Modal>
  )
}

function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <label className="ue:flex ue:flex-col ue:gap-1">
      <span className="ue:text-footnote ue:font-medium ue:text-fg">{label}</span>
      {children}
      <span className="ue:text-caption ue:leading-relaxed ue:text-subtle">{hint}</span>
    </label>
  )
}

/** 只画看得见的行：滚动时按 scrollTop 算出要画的区间，上下用空白撑出总高度 */
function VirtualTree({ rows, empty, render }: { rows: TreeRow[]; empty: string; render: (r: TreeRow) => ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ top: 0, height: 600 })
  useEffect(() => {
    const el = box.current
    if (!el) return
    const sync = () => setView({ top: el.scrollTop, height: el.clientHeight })
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const start = Math.max(0, Math.floor(view.top / ROW) - OVERSCAN)
  const end = Math.min(rows.length, Math.ceil((view.top + view.height) / ROW) + OVERSCAN)
  return (
    <div
      ref={box}
      onScroll={(e) => setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
      className="ue:min-h-0 ue:overflow-auto ue:rounded-lg ue:border ue:border-line"
    >
      {!rows.length ? (
        <p className="ue:px-3 ue:py-8 ue:text-center ue:text-footnote ue:text-subtle">{empty}</p>
      ) : (
        <div style={{ height: rows.length * ROW, position: 'relative' }}>
          {rows.slice(start, end).map((r, k) => (
            <div
              key={r.id}
              className="ue:border-b ue:border-line/55"
              style={{ position: 'absolute', top: (start + k) * ROW, left: 0, right: 0, height: ROW }}
            >
              {render(r)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
