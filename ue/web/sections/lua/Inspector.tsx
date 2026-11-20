import { ChevronRight, Copy, RefreshCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { LuaKey } from '../../../server/luapath.ts'
import { op, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { useKept } from '../../keep.ts'
import { luaText } from '../../Lua.tsx'
import { ErrorText, Note, SearchBox } from '../../ui.tsx'
import { FnLayers } from './FnLayers.tsx'
import { rootText, type InspectRes, type LuaRoot } from './inspect-data.ts'
import { FieldRow } from './InspectRows.tsx'
import { ChainChips, ObjectHead, type ChainLayer } from './objects-tree/ObjectHead.tsx'
import type { BoundObj } from './objects-tree/tree-model.ts'
import { useOpenLua } from './open-file.ts'

type Filter = 'all' | 'fields' | 'functions' | 'upvalues'

/**
 * Lua 页「对象」页签右边的检视区（设计稿 Lua对象页重设计 效果图 1）：UELink 2.4 的 lua.inspect 一次读出
 * 这张表的字段、自己和元表链上继承的函数、函数用到的 upvalue、元表链。
 * 看绑定对象时顶上是对象卡；继承链是一排「Lua / UE」小块；函数按继承层分组。字段可改，函数可调；改完、调完重读这一层
 */
export function LuaInspector({
  root,
  obj,
  tick,
  onNav,
  onPick,
  onOpenObj,
  onWatch,
  onChanged,
}: {
  root: LuaRoot
  /** 树里这个对象的一项（状态、世界、类）；看的不是绑定对象时没有 */
  obj?: BoundObj
  tick: number
  onNav: (keys: LuaKey[]) => void
  /** 换一个起点看（点继承链上的模块） */
  onPick: (r: LuaRoot) => void
  onOpenObj: (path: string) => void
  onWatch: (r: LuaRoot) => void
  onChanged: () => void
}) {
  const { project, target } = useUe()
  const { ui, cn, toast } = h()
  const openLua = useOpenLua()
  const [kept, setFilter] = useKept<Filter | 'meta'>(`${project.id}/lua/inspFilter`, 'all')
  // 以前的「元表」页签换成了顶上的继承链：记着的旧值当「全部」
  const filter: Filter = kept === 'meta' ? 'all' : kept
  const [own, setOwn] = useKept(`${project.id}/lua/inspOwn`, false)
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(200)
  const data = useLoad(
    () => op<InspectRes>(project.id, 'lua.inspect', { path: root.path, keys: root.keys, limit }, target),
    [root.path, root.keys.join('\u0001'), target.instance, target.world, tick, limit],
  )
  const d = data.data
  const hit = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase())
  const fns = (d?.functions ?? []).filter((f) => (!own || f.from === 0) && hit(f.name))
  const fields = (d?.fields ?? []).filter((f) => hit(f.k))
  const ups = (d?.upvalues ?? []).filter((u) => hit(u.name))
  const chain = (d?.chain ?? []) as ChainLayer[]
  const show = (f: Filter) => filter === 'all' || filter === f
  const top = root.label ?? (root.path ? t('实例表') : '_G')
  const isObj = !!root.path

  return (
    <div className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:flex-col ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-3">
        {isObj && (
          <ObjectHead
            name={root.label ?? root.path.split(/[.:]/).pop() ?? root.path}
            path={root.path}
            obj={obj}
            src={d?.src}
            onOpenObj={onOpenObj}
            onOpenLua={openLua}
            onWatch={() => onWatch({ ...root })}
          />
        )}
        <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-1 ue:font-mono ue:text-footnote">
          {[top, ...root.keys].map((k, i) => (
            <span key={i} className="ue:flex ue:items-center ue:gap-1">
              {i > 0 && <ChevronRight className="ue:h-3 ue:w-3 ue:text-subtle" />}
              <button
                type="button"
                disabled={i === root.keys.length}
                onClick={() => onNav(root.keys.slice(0, i))}
                className={cn(
                  'ue:rounded-sm ue:px-1',
                  i === root.keys.length ? 'ue:text-fg' : 'ue:cursor-pointer ue:text-accent-text ue:hover:underline',
                )}
              >
                {typeof k === 'number' ? `[${k}]` : k}
              </button>
            </span>
          ))}
          <span className="ue:ml-auto" />
          <ui.IconButton icon={RefreshCw} size="xs" label={t('刷新')} onClick={() => void data.reload()} />
          <ui.IconButton
            icon={Copy}
            size="xs"
            label={t('复制 Lua 路径')}
            onClick={() => void navigator.clipboard.writeText(rootText(root)).then(() => toast.success(t('已复制')))}
          />
        </div>
        {!!chain.length && (
          <ChainChips
            top={root.keys.length ? String(root.keys[root.keys.length - 1]) : top}
            chain={chain}
            onModule={(m) => onPick({ path: '', keys: ['package', 'loaded', m], label: m })}
          />
        )}
        <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-3">
          <ui.Segmented
            size="sm"
            label={t('检视内容')}
            value={filter}
            onChange={setFilter}
            options={[
              { id: 'all' as const, label: t('全部') },
              { id: 'fields' as const, label: `${t('字段')} ${d?.total ?? d?.fields?.length ?? 0}` },
              { id: 'functions' as const, label: `${t('函数')} ${d?.functions?.length ?? 0}` },
              { id: 'upvalues' as const, label: `upvalue ${d?.upvalues?.length ?? 0}` },
            ]}
          />
          <div className="ue:w-56">
            <SearchBox placeholder={t('筛字段和函数')} onSearch={setQ} allowEmpty live />
          </div>
          <label className="ue:flex ue:cursor-pointer ue:items-center ue:gap-1.5 ue:text-footnote ue:text-muted">
            <input
              type="checkbox"
              checked={own}
              onChange={(e) => setOwn(e.target.checked)}
              className="ue:accent-accent"
            />
            {t('只看自己的函数')}
          </label>
        </div>
      </div>
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
        <div className="ue:px-4">
          <ErrorText>{data.error}</ErrorText>
        </div>
        {d?.note && (
          <div className="ue:px-4 ue:py-2">
            <Note tone="info">{d.note}</Note>
          </div>
        )}
        {data.loading && !d && <p className="ue:px-4 ue:py-2 ue:text-footnote ue:text-subtle">{t('读取中…')}</p>}
        {d && d.value.t !== 'table' && (
          <div className="ue:px-4 ue:py-2 ue:font-mono ue:text-footnote ue:text-fg">{luaText(d.value)}</div>
        )}
        {show('fields') && !!fields.length && (
          <Group title={t('字段（{n}）', { n: q ? fields.length : (d?.total ?? fields.length) })}>
            {fields.map((f, i) => (
              <FieldRow
                key={`${f.k}\u0001${i}`}
                root={root}
                f={f}
                onDown={(k) => onNav([...root.keys, k])}
                onOpenObj={onOpenObj}
                onWatch={(k) => onWatch({ ...root, keys: [...root.keys, k] })}
                onChanged={onChanged}
              />
            ))}
            {d?.more && !q && (
              <div className="ue:px-4 ue:py-2">
                <ui.Button size="sm" variant="secondary" onClick={() => setLimit((n) => n + 200)}>
                  {t('再列 {n} 项', { n: 200 })}
                </ui.Button>
              </div>
            )}
          </Group>
        )}
        {show('functions') && !!fns.length && (
          <FnLayers root={root} fns={fns} chain={chain} onChanged={onChanged} onOpen={openLua} />
        )}
        {show('upvalues') && !!ups.length && (
          <Group title={t('模块里的 local（upvalue，只读）')}>
            {ups.map((u) => (
              <div
                key={`${u.fn}\u0001${u.name}`}
                className="ue:flex ue:items-center ue:gap-3 ue:border-b ue:border-line/60 ue:px-4 ue:py-1.5 ue:font-mono ue:text-footnote"
              >
                <span className="ue:w-[36%] ue:shrink-0 ue:truncate ue:pl-4.5 ue:text-fg">{u.name}</span>
                <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-muted">
                  {u.v !== undefined ? JSON.stringify(u.v) : u.t}
                </span>
                <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{t('用在 {fn}', { fn: u.fn })}</span>
              </div>
            ))}
          </Group>
        )}
        {d && d.value.t === 'table' && !fields.length && !fns.length && !ups.length && (
          <p className="ue:p-6 ue:text-center ue:text-footnote ue:text-subtle">{q ? t('没有对得上的') : t('空表')}</p>
        )}
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="ue:sticky ue:top-0 ue:z-1 ue:border-b ue:border-line ue:bg-card ue:px-4 ue:py-1 ue:text-caption ue:font-medium ue:text-muted">
        {title}
      </h3>
      {children}
    </section>
  )
}
