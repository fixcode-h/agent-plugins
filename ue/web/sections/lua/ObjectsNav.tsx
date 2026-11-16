import { Boxes, Eye, FileCode2, Globe, RefreshCw, X } from 'lucide-react'
import { useState } from 'react'
import { parseLuaPath } from '../../../server/luapath.ts'
import { op, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { useKept } from '../../keep.ts'
import { luaText, type LuaDesc, type LuaField } from '../../Lua.tsx'
import { ErrorText, SearchBox } from '../../ui.tsx'
import { rootKey, rootText, type LuaRoot } from './inspect-data.ts'

type Src = 'globals' | 'bound' | 'modules'
interface Bound {
  path: string
  name: string
  class: string
  module: string
}

/** 全局表里这些是 Lua 自带的库，不是项目的单例和管理器：左栏不列 */
const BUILTIN = new Set([
  '_G',
  'package',
  'string',
  'table',
  'math',
  'io',
  'os',
  'debug',
  'coroutine',
  'utf8',
  'bit32',
  'jit',
  'ffi',
  'UE',
  'UE4',
  'UnLua',
])

/**
 * Lua 对象页左栏：上面按路径直接跳；中间三个来源——全局表里的单例 / 管理器、绑了 Lua 的 UObject（lua.objects）、
 * 已加载的模块（package.loaded）；下面是监视列表（改完、调完或点刷新时重读，不轮询）
 */
export function LuaObjectsNav({
  current,
  tick,
  watch,
  onPick,
  onUnwatch,
}: {
  current: LuaRoot
  tick: number
  watch: LuaRoot[]
  onPick: (r: LuaRoot) => void
  onUnwatch: (r: LuaRoot) => void
}) {
  const { project, target } = useUe()
  const { ui, cn } = h()
  const [src, setSrc] = useKept<Src>(`${project.id}/lua/navSrc`, 'globals')
  const [q, setQ] = useState('')
  const [pathError, setPathError] = useState('')
  const list = useLoad(
    () =>
      src === 'bound'
        ? op<{ items: Bound[] }>(project.id, 'lua.objects', { limit: 200 }, target).then((r) =>
            r.items.map((b) => ({ key: b.path, label: b.name, sub: b.module, root: { path: b.path, keys: [], label: b.name } })),
          )
        : op<{ fields?: LuaField[] }>(
            project.id,
            'lua.get',
            { path: '', keys: src === 'modules' ? ['package', 'loaded'] : [], offset: 0, limit: 1000 },
            target,
          ).then((r) =>
            (r.fields ?? [])
              .filter((f) => f.t === 'table' && f.kt === 'string' && (src === 'modules' || !BUILTIN.has(f.k)))
              .sort((a, b) => a.k.localeCompare(b.k))
              .map((f) => ({
                key: f.k,
                label: f.k,
                sub: f.module,
                root: { path: '', keys: src === 'modules' ? ['package', 'loaded', f.k] : [f.k], label: src === 'modules' ? f.k : undefined },
              })),
          ),
    [project.id, src, target.instance, target.world],
  )
  const items = (list.data ?? []).filter((x) => !q || x.label.toLowerCase().includes(q.toLowerCase()))
  // 检视区走到下层时，左栏还亮着它的起点
  const under = (r: LuaRoot) =>
    r.path === current.path && r.keys.length <= current.keys.length && r.keys.every((k, i) => current.keys[i] === k)

  const openPath = (s: string) => {
    try {
      onPick({ path: '', keys: parseLuaPath(s) })
      setPathError('')
    } catch (e) {
      setPathError((e as Error).message)
    }
  }

  return (
    <div className="ue:flex ue:min-h-0 ue:w-72 ue:shrink-0 ue:flex-col ue:border-r ue:border-line">
      <div className="ue:flex ue:flex-col ue:gap-2 ue:border-b ue:border-line ue:p-3">
        <SearchBox placeholder={t('Lua 路径，例如 GameSystemManager.Bag')} onSearch={openPath} allowEmpty />
        <ErrorText>{pathError}</ErrorText>
        <ui.Segmented
          size="sm"
          label={t('对象来源')}
          value={src}
          onChange={setSrc}
          options={[
            { id: 'globals' as const, label: t('全局') },
            { id: 'bound' as const, label: t('绑定对象') },
            { id: 'modules' as const, label: t('模块') },
          ]}
        />
        <div className="ue:flex ue:items-center ue:gap-1">
          <div className="ue:min-w-0 ue:flex-1">
            <SearchBox placeholder={t('按名字筛')} onSearch={setQ} allowEmpty live />
          </div>
          <ui.IconButton icon={RefreshCw} size="sm" label={t('刷新')} onClick={() => void list.reload()} />
        </div>
      </div>
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:py-1">
        <div className="ue:px-3">
          <ErrorText>{list.error}</ErrorText>
        </div>
        {items.map((x) => {
          const Icon = src === 'bound' ? Boxes : src === 'modules' ? FileCode2 : Globe
          return (
            <button
              key={x.key}
              type="button"
              onClick={() => onPick(x.root)}
              className={cn(
                'ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:px-3 ue:py-1.5 ue:text-left',
                under(x.root) ? 'ue:bg-sel' : 'ue:hover:bg-hover',
              )}
            >
              <Icon className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
              <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono ue:text-footnote ue:text-fg">{x.label}</span>
              {x.sub && <span className="ue:max-w-[45%] ue:truncate ue:text-caption ue:text-subtle">{x.sub}</span>}
            </button>
          )
        })}
        {list.data && !items.length && (
          <p className="ue:px-3 ue:py-4 ue:text-center ue:text-caption ue:text-subtle">{t('没有对得上的')}</p>
        )}
      </div>
      <WatchList items={watch} tick={tick} onPick={onPick} onRemove={onUnwatch} />
    </div>
  )
}

/** 监视：每一项读一次 lua.get 的值；tick 变了（改字段、调函数后）或点刷新时重读 */
function WatchList({
  items,
  tick,
  onPick,
  onRemove,
}: {
  items: LuaRoot[]
  tick: number
  onPick: (r: LuaRoot) => void
  onRemove: (r: LuaRoot) => void
}) {
  const { project, target } = useUe()
  const { ui } = h()
  const [n, setN] = useState(0)
  const vals = useLoad(
    () =>
      Promise.all(
        items.map((r) =>
          op<{ value: LuaDesc }>(project.id, 'lua.get', { path: r.path, keys: r.keys, offset: 0, limit: 1 }, target)
            .then((x) => luaText(x.value))
            .catch((e: Error) => e.message),
        ),
      ),
    [items.map(rootKey).join('\u0002'), tick, n, target.instance, target.world],
  )
  if (!items.length) return null
  return (
    <div className="ue:max-h-[40%] ue:shrink-0 ue:overflow-auto ue:border-t ue:border-line">
      <div className="ue:flex ue:items-center ue:gap-1.5 ue:px-3 ue:py-1.5 ue:text-caption ue:font-medium ue:text-muted">
        <Eye className="ue:h-3.5 ue:w-3.5" /> {t('监视（{n}）', { n: items.length })}
        <span className="ue:ml-auto" />
        <ui.IconButton icon={RefreshCw} size="xs" label={t('刷新监视')} onClick={() => setN((x) => x + 1)} />
      </div>
      {items.map((r, i) => (
        <div key={rootKey(r)} className="ue:group ue:flex ue:items-center ue:gap-2 ue:px-3 ue:py-1">
          <button
            type="button"
            onClick={() => onPick(r)}
            className="ue:min-w-0 ue:flex-1 ue:cursor-pointer ue:truncate ue:text-left ue:font-mono ue:text-footnote ue:text-fg ue:hover:text-accent-text"
            title={rootText(r)}
          >
            {rootText(r)}
          </button>
          <span className="ue:max-w-[45%] ue:truncate ue:font-mono ue:text-caption ue:text-muted" title={vals.data?.[i]}>
            {vals.data?.[i] ?? '…'}
          </span>
          <span className="ue:opacity-0 ue:group-hover:opacity-100">
            <ui.IconButton icon={X} size="xs" label={t('不再监视')} onClick={() => onRemove(r)} />
          </span>
        </div>
      ))}
    </div>
  )
}
