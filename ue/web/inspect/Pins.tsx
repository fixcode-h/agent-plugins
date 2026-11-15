import { Pin } from 'lucide-react'
import { useEffect } from 'react'
import { pget, ppost, useLoad } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { refName } from '../details/model.ts'
import { h, t } from '../host.ts'

export interface Pinned {
  path: string
  label: string
}

/** 别处固定 / 取消固定后叫一声：浏览栏底部的「固定的对象」和导航条上的按钮各读一份，要一起变 */
const subs = new Set<() => void>()

/**
 * 固定的对象（存在服务端的本机数据 local.pinned，跟项目走）：导航条的「固定」按钮切换，浏览栏底部列出来
 */
export function usePins() {
  const { project } = useUe()
  const local = useLoad(
    () => pget<{ pinned?: Pinned[] }>(project.id, 'local').then((r) => r.pinned ?? []),
    [project.id],
    0,
    `${project.id}/pins`,
  )
  useEffect(() => {
    const f = () => void local.reload()
    subs.add(f)
    return () => void subs.delete(f)
    // 只在挂载时登记
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const list = local.data ?? []
  return {
    list,
    has: (path: string) => list.some((p) => p.path === path),
    toggle: async (path: string) => {
      const next = list.some((p) => p.path === path)
        ? list.filter((p) => p.path !== path)
        : [...list, { path, label: refName(path) }]
      local.setData(next)
      await ppost(project.id, 'local', { pinned: next })
      subs.forEach((f) => f())
    },
  }
}

/** 浏览栏底部「固定的对象」（对象页三个页签都显示，图 1）：点了在检视区打开，没有固定的不画 */
export function Pins({ selected, onOpen }: { selected: string; onOpen: (path: string) => void }) {
  const { list } = usePins()
  const { cn } = h()
  if (!list.length) return null
  return (
    <div className="ue:flex ue:shrink-0 ue:flex-col ue:gap-2 ue:border-t ue:border-line ue:p-3">
      <span className="ue:text-footnote ue:text-subtle">{t('固定的对象')}</span>
      <div className="ue:flex ue:max-h-28 ue:flex-wrap ue:gap-1.5 ue:overflow-auto">
        {list.map((p) => (
          <button
            key={p.path}
            type="button"
            title={p.path}
            onClick={() => onOpen(p.path)}
            className={cn(
              'ue:flex ue:h-7 ue:max-w-full ue:cursor-pointer ue:items-center ue:gap-1.5 ue:rounded-md ue:border ue:px-2 ue:font-mono ue:text-footnote ue:text-fg ue:hover:bg-hover',
              selected === p.path ? 'ue:border-accent ue:bg-sel' : 'ue:border-line',
            )}
          >
            <Pin className="ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle" />
            <span className="ue:truncate">{p.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
