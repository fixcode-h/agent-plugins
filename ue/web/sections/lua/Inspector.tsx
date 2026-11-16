import { ChevronRight, Copy, RefreshCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { LuaKey } from '../../../server/luapath.ts'
import { op, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { useKept } from '../../keep.ts'
import { luaText } from '../../Lua.tsx'
import { Badge, ErrorText, Note } from '../../ui.tsx'
import { rootText, type InspectRes, type LuaRoot } from './inspect-data.ts'
import { FieldRow, FnRow } from './InspectRows.tsx'

type Filter = 'all' | 'fields' | 'functions' | 'upvalues' | 'meta'

/**
 * Lua 页「对象」页签右边的检视区（设计稿「UE 插件优化与扩展」四.1、效果图 3）：UELink 2.4 的 lua.inspect 一次读出
 * 这张表的字段、自己和元表链上继承的函数、函数用到的 upvalue、元表链。字段可改，函数可调；改完、调完重读这一层
 */
export function LuaInspector({
  root,
  tick,
  onNav,
  onOpenObj,
  onWatch,
  onChanged,
}: {
  root: LuaRoot
  tick: number
  onNav: (keys: LuaKey[]) => void
  onOpenObj: (path: string) => void
  onWatch: (r: LuaRoot) => void
  onChanged: () => void
}) {
  const { project, target } = useUe()
  const { ui, cn, toast } = h()
  const [filter, setFilter] = useKept<Filter>(`${project.id}/lua/inspFilter`, 'all')
  const [own, setOwn] = useKept(`${project.id}/lua/inspOwn`, false)
  const [limit, setLimit] = useState(200)
  const data = useLoad(
    () => op<InspectRes>(project.id, 'lua.inspect', { path: root.path, keys: root.keys, limit }, target),
    [root.path, root.keys.join('\u0001'), target.instance, target.world, tick, limit],
  )
  const d = data.data
  const fns = (d?.functions ?? []).filter((f) => !own || f.from === 0)
  const show = (f: Filter) => filter === 'all' || filter === f
  const top = root.label ?? (root.path ? t('实例表') : '_G')

  return (
    <div className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:flex-col ue:gap-1.5 ue:border-b ue:border-line ue:px-4 ue:py-2">
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
        {(!!d?.chain?.length || d?.src) && (
          <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-1.5 ue:text-caption ue:text-subtle">
            {d?.chain?.map((c, i) => (
              <Badge key={i} tone={i === 0 ? 'accent' : 'muted'} title={c.src}>
                {c.name || t('（匿名元表）')}
              </Badge>
            ))}
            {d?.src && <span className="ue:font-mono">{d.src}</span>}
          </div>
        )}
        <div className="ue:flex ue:items-center ue:gap-3">
          <ui.Segmented
            size="sm"
            label={t('检视内容')}
            value={filter}
            onChange={setFilter}
            options={[
              { id: 'all' as const, label: t('全部') },
              { id: 'fields' as const, label: t('字段') },
              { id: 'functions' as const, label: t('函数') },
              { id: 'upvalues' as const, label: 'upvalue' },
              { id: 'meta' as const, label: t('元表') },
            ]}
          />
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
        {show('fields') && !!d?.fields?.length && (
          <Group title={t('字段（{n}）', { n: d.total ?? d.fields.length })}>
            {d.fields.map((f, i) => (
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
            {d.more && (
              <div className="ue:px-4 ue:py-2">
                <ui.Button size="sm" variant="secondary" onClick={() => setLimit((n) => n + 200)}>
                  {t('再列 {n} 项', { n: 200 })}
                </ui.Button>
              </div>
            )}
          </Group>
        )}
        {show('functions') && !!fns.length && (
          <Group title={t('函数（{n}）', { n: fns.length })}>
            {fns.map((fn) => (
              <FnRow key={`${fn.from}\u0001${fn.name}`} root={root} fn={fn} onChanged={onChanged} />
            ))}
          </Group>
        )}
        {show('upvalues') && !!d?.upvalues?.length && (
          <Group title={t('模块里的 local（upvalue，只读）')}>
            {d.upvalues.map((u) => (
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
        {show('meta') && !!d?.chain?.length && (
          <Group title={t('元表链（__index 往上）')}>
            {d.chain.map((c, i) => (
              <div key={i} className="ue:flex ue:items-center ue:gap-3 ue:border-b ue:border-line/60 ue:px-4 ue:py-1.5">
                <span className="ue:w-6 ue:shrink-0 ue:text-right ue:text-caption ue:text-subtle">{i + 1}</span>
                {c.name ? (
                  <button
                    type="button"
                    onClick={() => onWatch({ path: '', keys: ['package', 'loaded', c.name], label: c.name })}
                    className="ue:cursor-pointer ue:font-mono ue:text-body ue:text-accent-text ue:hover:underline"
                    title={t('加到监视')}
                  >
                    {c.name}
                  </button>
                ) : (
                  <span className="ue:font-mono ue:text-body ue:text-muted">{t('（匿名元表）')}</span>
                )}
                <span className="ue:ml-auto ue:truncate ue:font-mono ue:text-caption ue:text-subtle">{c.src}</span>
              </div>
            ))}
          </Group>
        )}
        {d && d.value.t === 'table' && !d.fields?.length && !fns.length && (
          <p className="ue:p-6 ue:text-center ue:text-footnote ue:text-subtle">{t('空表')}</p>
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
