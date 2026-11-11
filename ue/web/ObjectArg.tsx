import { Search } from 'lucide-react'
import { useState } from 'react'
import { op, useLoad } from './api.ts'
import { ClassPicker, type ClassOpt } from './ClassPicker.tsx'
import { useUe } from './ctx.tsx'
import { h, t } from './host.ts'
import { Badge, ErrorText, KindBadge } from './ui.tsx'

interface Hit {
  path: string
  name: string
  class: string
  kind?: 'instance' | 'asset' | 'class' | 'unloaded'
  /** 从属性里找到的：在哪个属性里（Mesh、Items[2]、组件 X） */
  via?: string
  label?: string
}

/**
 * 函数执行弹窗里给对象参数选值：「搜索对象」先选类（只列能赋给参数的类，默认就是参数类型）再按名字前缀搜，
 * 运行时实例、资源和没加载的资源都列；「从对象的属性里选」列某个对象的属性里现在放着、能赋给这个参数的对象，
 * 来源默认是当前对象，也能换别的。选中后把路径填回参数
 */
export function ObjectArg({
  cls,
  clsPath,
  self,
  onPick,
}: {
  /** 参数要的类（UE 里的类名，不带 U / A 前缀） */
  cls: string
  clsPath?: string
  /** 当前对象（属性来源的默认值） */
  self: string
  onPick: (path: string) => void
}) {
  const { cn, ui } = h()
  const [tab, setTab] = useState<'search' | 'props'>('search')
  const base: ClassOpt = { name: cls, path: clsPath }
  const [pick, setPick] = useState<ClassOpt>(base)
  const [prefix, setPrefix] = useState('')
  const [src, setSrc] = useState(self)
  const [srcInput, setSrcInput] = useState(self)
  const { project, target } = useUe()
  const [q, setQ] = useState<{ cls: ClassOpt; prefix: string }>()
  const found = useLoad(
    () =>
      q
        ? op<{ items: Hit[]; more: boolean; partial?: boolean }>(
            project.id,
            'objects',
            { class: q.cls.path || q.cls.name, prefix: q.prefix, limit: 100, assets: true },
            target,
          )
        : Promise.resolve(undefined),
    [q],
  )
  const refs = useLoad(
    () =>
      tab === 'props' && src
        ? op<{ items: Hit[]; more: boolean }>(
            project.id,
            'object.refs',
            { path: src, class: clsPath || cls, limit: 300 },
            target,
          )
        : Promise.resolve(undefined),
    [tab, src],
  )
  const tabBtn = (id: typeof tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={cn(
        'ue:-mb-px ue:cursor-pointer ue:border-b-2 ue:px-1 ue:pb-1.5 ue:text-footnote',
        tab === id ? 'ue:border-accent ue:text-fg' : 'ue:border-transparent ue:text-subtle ue:hover:text-fg',
      )}
    >
      {label}
    </button>
  )
  const field =
    'ue:flex ue:h-8 ue:min-w-0 ue:flex-1 ue:items-center ue:gap-2 ue:rounded-lg ue:border ue:border-line-strong ue:bg-field ue:px-2.5 ue:focus-within:border-focus'
  const input =
    'ue:min-w-0 ue:flex-1 ue:bg-transparent ue:text-body ue:text-fg ue:outline-none ue:placeholder:text-subtle'
  const rows = (items: Hit[]) => (
    <ul className="ue:max-h-56 ue:overflow-auto ue:rounded-lg ue:border ue:border-line">
      {items.map((o) => (
        <li key={`${o.path}|${o.via ?? ''}`}>
          <button
            type="button"
            title={o.path}
            onClick={() => onPick(o.path)}
            className="ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:px-2.5 ue:py-1.5 ue:text-left ue:hover:bg-hover"
          >
            <span className="ue:min-w-0 ue:flex-1">
              <span className="ue:block ue:truncate ue:font-mono ue:text-footnote ue:text-fg">
                {o.via ? <span className="ue:text-subtle">{o.via} · </span> : null}
                {o.label || o.name}
              </span>
              <span className="ue:block ue:truncate ue:text-caption ue:text-subtle">
                {o.class} · {o.path}
              </span>
            </span>
            {/* 这里的「资源」是能直接赋值的资源本身，不是 Object 页那种容易点错的资源默认值 */}
            {o.kind === 'asset' ? <Badge tone="warn">{t('资源')}</Badge> : <KindBadge kind={o.kind} />}
          </button>
        </li>
      ))}
    </ul>
  )

  return (
    <div className="ue:flex ue:flex-col ue:gap-2 ue:rounded-lg ue:border ue:border-line ue:bg-panel ue:p-3">
      <div className="ue:flex ue:items-end ue:gap-3 ue:border-b ue:border-line">
        {tabBtn('search', t('搜索对象'))}
        {tabBtn('props', t('从对象的属性里选'))}
        <span className="ue:ml-auto ue:truncate ue:pb-1.5 ue:text-caption ue:text-subtle">
          {t('只列能赋给 {c} 的对象', { c: cls })}
        </span>
      </div>
      {tab === 'search' ? (
        <>
          <ClassPicker
            value={pick}
            common={[base]}
            free={false}
            placeholder={t('在 {c} 的子类里搜类名', { c: cls })}
            load={(s) =>
              op<{ items: { name: string; path: string; parent?: string }[] }>(
                project.id,
                'classes',
                { base: clsPath || cls, q: s, limit: 50 },
                target,
              ).then((r) => r.items.map((c) => ({ name: c.name, path: c.path, note: c.parent })))
            }
            onChange={(c) => {
              setPick(c)
              setQ({ cls: c, prefix: prefix.trim() })
            }}
          />
          <form
            className="ue:flex ue:items-center ue:gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setQ({ cls: pick, prefix: prefix.trim() })
            }}
          >
            <label className={field}>
              <Search className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
              <input
                autoFocus
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder={t('名字开头（可选）')}
                aria-label={t('名字开头')}
                className={input}
              />
              <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{t('前缀')}</span>
            </label>
            <ui.Button size="sm" variant="secondary" type="submit" disabled={found.loading}>
              {t('搜索')}
            </ui.Button>
          </form>
          <ErrorText>{found.error}</ErrorText>
          {found.data?.partial && <p className="ue:text-caption ue:text-subtle">{t('对象太多，只搜了一部分')}</p>}
          {found.data && (found.data.items.length ? rows(found.data.items) : <Empty />)}
          {found.data?.more && (
            <p className="ue:text-caption ue:text-subtle">
              {t('超过 {n} 个，只列前 {n} 个，再多输几个字', { n: found.data.items.length })}
            </p>
          )}
        </>
      ) : (
        <>
          <form
            className="ue:flex ue:items-center ue:gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setSrc(srcInput.trim())
            }}
          >
            <label className={field}>
              <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{t('来源')}</span>
              <input
                value={srcInput}
                onChange={(e) => setSrcInput(e.target.value)}
                placeholder={t('对象路径')}
                aria-label={t('来源对象')}
                className={cn(input, 'ue:font-mono ue:text-footnote')}
              />
            </label>
            {src !== self && (
              <ui.Button
                size="sm"
                variant="ghost"
                type="button"
                onClick={() => {
                  setSrcInput(self)
                  setSrc(self)
                }}
              >
                {t('当前对象')}
              </ui.Button>
            )}
            <ui.Button size="sm" variant="secondary" type="submit" disabled={refs.loading}>
              {t('换来源')}
            </ui.Button>
          </form>
          <ErrorText>{refs.error}</ErrorText>
          {refs.loading && !refs.data && <p className="ue:text-caption ue:text-subtle">{t('读取中…')}</p>}
          {refs.data && (refs.data.items.length ? rows(refs.data.items) : <Empty />)}
        </>
      )}
    </div>
  )
}

function Empty() {
  return <p className="ue:py-2 ue:text-center ue:text-footnote ue:text-subtle">{t('没有能赋给这个参数的对象')}</p>
}
