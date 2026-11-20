import { Eye, RefreshCw, X } from 'lucide-react'
import { useState } from 'react'
import { op, useLoad } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { luaText, type LuaDesc } from '../../../Lua.tsx'
import { rootKey, rootText, type LuaRoot } from '../inspect-data.ts'

/** 监视：每一项读一次 lua.get 的值；tick 变了（改字段、调函数后）或点刷新时重读 */
export function WatchList({
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
          <span
            className="ue:max-w-[45%] ue:truncate ue:font-mono ue:text-caption ue:text-muted"
            title={vals.data?.[i]}
          >
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
