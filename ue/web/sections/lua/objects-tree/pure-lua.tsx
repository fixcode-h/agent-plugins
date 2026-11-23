import { Braces, Box, Sparkles, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { op } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import { t } from '../../../host.ts'
import { Hit } from '@panel/web/src/components/ui/tree/tree-search'
import type { TreeLine } from '@panel/web/src/components/ui/tree/tree-list'
import type { LuaRoot } from '../inspect-data.ts'
import { useLuaOp } from '../lua-data.ts'

/** lua.instances 的回包（UELink 2.20）：不给模块时 items 是各类的个数，给了是实例 */
interface ClassCount {
  module: string
  count: number
}
interface Instance {
  ref: string
  path: string
  module: string
  name?: string
}
interface Res<T> {
  items?: T[]
  total?: number
  truncated?: boolean
}

/**
 * Lua 页对象树里的「纯 Lua 实例」一组（用户 2026-11-21：纯 Lua 实例扩展到整个 UE 插件）：Lua 框架自己 new 的、不绑 UObject 的表。
 * 走 Lua 堆要几百毫秒，所以展开这一组时才找一次、点开某个类时才列它的实例；点实例在右边检视（起点是它的 luaref）。
 * 怎么认（类名字段、起点变量）在「权限与设置 → Lua」
 */
export function usePureLua(open: boolean, tick: number) {
  const { project, target } = useUe()
  const ok = useLuaOp('lua.instances')
  const [classes, setClasses] = useState<Res<ClassCount> & { error?: string }>()
  const [insts, setInsts] = useState<Record<string, Instance[] | string>>({})
  useEffect(() => {
    if (!ok || !open) return
    let live = true
    setInsts({})
    op<Res<ClassCount>>(project.id, 'lua.instances', { limit: 500 }, target, 60000).then(
      (r) => live && setClasses(r),
      (e: Error) => live && setClasses({ error: e.message }),
    )
    return () => {
      live = false
    }
  }, [ok, open, tick, project.id, target.instance, target.world])
  const loadClass = (module: string) => {
    if (insts[module]) return
    op<Res<Instance>>(project.id, 'lua.instances', { module, limit: 300 }, target, 60000).then(
      (r) => setInsts((m) => ({ ...m, [module]: r.items ?? [] })),
      (e: Error) => setInsts((m) => ({ ...m, [module]: e.message })),
    )
  }
  return { ok, classes, insts, loadClass }
}

export type PureLua = ReturnType<typeof usePureLua>

/** 往对象树里加这一组的行 */
export function pureLuaLines(o: {
  pure: PureLua
  lines: TreeLine[]
  section: (key: string, icon: LucideIcon, label: string, count: number | string, def?: boolean) => boolean
  isOpen: (key: string, def: boolean) => boolean
  toggle: (key: string, def: boolean) => void
  under: (path: string, keys: (string | number)[]) => boolean
  onSelect: (root: LuaRoot) => void
  q: string
}) {
  const { pure, lines } = o
  if (!pure.ok) return
  const c = pure.classes
  const count = c?.items ? String(c.total ?? 0) + (c.truncated ? '+' : '') : '…'
  if (!o.section('s:pure', Sparkles, t('纯 Lua 实例（不绑 UObject）'), count, false)) return
  const note = (key: string, text: string, tone = 'ue:text-subtle') =>
    lines.push({
      key,
      depth: 1,
      icon: Sparkles,
      label: <span className={`ue:text-caption ${tone}`}>{text}</span>,
      expandable: false,
      open: false,
      selected: false,
    })
  if (!c) return note('pure:loading', t('正在走 Lua 堆找…'))
  if (c.error) return note('pure:error', c.error, 'ue:text-danger')
  if (!c.items?.length) return note('pure:none', t('没找到：到「权限与设置 → Lua」填类名字段或起点变量，点「试一下」'))
  for (const cls of c.items) {
    const key = `pure:${cls.module}`
    const open = o.isOpen(key, false)
    lines.push({
      key,
      depth: 1,
      icon: Braces,
      iconTone: 'ue:text-accent-text',
      label: (
        <span className="ue:font-mono">
          <Hit text={cls.module} q={o.q} />
        </span>
      ),
      title: cls.module,
      aside: String(cls.count),
      expandable: true,
      open,
      selected: false,
      clickToggles: true,
      onToggle: () => {
        if (!open) pure.loadClass(cls.module)
        o.toggle(key, false)
      },
    })
    if (!open) continue
    const list = pure.insts[cls.module]
    if (!list) note(`${key}:loading`, t('读取中…'))
    else if (typeof list === 'string') note(`${key}:error`, list, 'ue:text-danger')
    else
      for (const it of list) {
        const label = it.name || it.ref
        lines.push({
          key: `${key}:${it.ref}`,
          depth: 2,
          icon: Box,
          label: <span className="ue:truncate ue:font-mono">{label}</span>,
          title: `${it.module}\n${it.path}`,
          aside: <span className="ue:font-mono">{it.path.split(/[.[]/).slice(-1)[0]}</span>,
          expandable: false,
          open: false,
          selected: o.under(it.ref, []),
          onSelect: () => o.onSelect({ path: it.ref, keys: [], label }),
        })
      }
  }
}
