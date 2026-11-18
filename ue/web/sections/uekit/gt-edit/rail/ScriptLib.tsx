import { ChevronRight, CircleDot, Folder, FolderOpen, GripVertical, Pencil } from 'lucide-react'
import { useMemo, useState } from 'react'
import { h, t } from '../../../../host.ts'
import { GT_STEPS_MIME } from '../../gt-flow/dnd.ts'
import type { EditRailProps } from './EditRail.tsx'

type Scenario = EditRailProps['scenarios'][number]

const norm = (p: string) => p.replace(/\\/g, '/')
const dirOf = (p: string) => {
  const i = norm(p).lastIndexOf('/')
  return i < 0 ? '' : norm(p).slice(0, i)
}
const baseName = (p: string) => norm(p).split('/').pop() ?? p
/** call 的 script 相对场景根，.json 可省（gt-blocks/call.tsx） */
const scriptOf = (rel: string) => norm(rel).replace(/\.json$/i, '')
const isRecorded = (s: Scenario) => !!s.tags?.includes('recorded')

/**
 * 脚本库（效果图 1 左栏下半）：按文件夹分组的场景，点一下打开，拖进流程图就是一步「调用脚本」。
 * 只分一层（文件夹按完整相对路径当组名）：左栏窄，嵌套缩进放不下；当前脚本不能拖（自己调自己）
 */
export function ScriptLib({
  scenarios,
  current,
  onOpen,
  q,
}: Pick<EditRailProps, 'scenarios' | 'current' | 'onOpen'> & { q: string }) {
  const { cn } = h()
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const cur = norm(current)
  const groups = useMemo(() => {
    const m = new Map<string, Scenario[]>()
    const hit = (s: Scenario) => !q || `${s.name} ${norm(s.relativePath)}`.toLowerCase().includes(q)
    for (const s of scenarios.filter(hit)) {
      const d = dirOf(s.relativePath)
      m.set(d, [...(m.get(d) ?? []), s])
    }
    // 根目录的放最前，其余按名字
    return [...m.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
  }, [scenarios, q])

  if (!groups.length)
    return (
      <div className="ue:px-1 ue:py-1 ue:text-footnote ue:text-subtle">{q ? t('没有对上的脚本') : t('还没有脚本')}</div>
    )

  const toggle = (d: string) =>
    setClosed((s) => {
      const next = new Set(s)
      if (!next.delete(d)) next.add(d)
      return next
    })

  const row = (s: Scenario, indent: boolean) => {
    const self = norm(s.relativePath) === cur
    const rec = isRecorded(s)
    const Icon = rec ? CircleDot : Pencil
    return (
      <button
        key={s.relativePath}
        type="button"
        role="treeitem"
        aria-selected={self}
        title={self ? t('正在编辑的脚本，不能调用自己') : t('拖进流程图就是「调用脚本」')}
        draggable={!self}
        onDragStart={(e) => {
          e.dataTransfer.setData(GT_STEPS_MIME, JSON.stringify([{ action: 'call', script: scriptOf(s.relativePath) }]))
          e.dataTransfer.effectAllowed = 'copy'
        }}
        onClick={() => onOpen(s.relativePath)}
        style={{ paddingLeft: indent ? 18 : 2 }}
        className="ue:group ue:flex ue:h-7 ue:w-full ue:shrink-0 ue:cursor-pointer ue:select-none ue:items-center ue:gap-1.5 ue:rounded-(--c-row-radius) ue:pr-2 ue:text-left ue:text-body ue:text-fg ue:transition-colors ue:hover:bg-sel/60 ue:aria-selected:bg-sel ue:aria-selected:font-semibold"
      >
        <GripVertical
          aria-hidden
          className={cn('ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle', self ? 'ue:invisible' : 'ue:opacity-60')}
        />
        <Icon className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0', rec ? 'ue:text-danger' : 'ue:text-subtle')} />
        <span className="ue:min-w-0 ue:flex-1 ue:truncate">{s.name || baseName(s.relativePath)}</span>
        <span className="ue:shrink-0 ue:text-caption ue:font-normal ue:text-subtle ue:tabular-nums">
          {rec ? t('录制 · {n} 步', { n: s.steps }) : t('编写')}
        </span>
      </button>
    )
  }

  return (
    <div role="tree" aria-label={t('脚本库')} className="ue:flex ue:flex-col ue:gap-px">
      {groups.map(([d, list]) => {
        if (!d) return list.map((s) => row(s, false))
        // 搜索时全部展开，不然对上的藏在折叠的文件夹里
        const open = !!q || !closed.has(d)
        const FIcon = open ? FolderOpen : Folder
        return (
          <div key={d} className="ue:flex ue:flex-col ue:gap-px">
            <button
              type="button"
              role="treeitem"
              aria-expanded={open}
              title={d}
              onClick={() => toggle(d)}
              className="ue:flex ue:h-7 ue:w-full ue:shrink-0 ue:cursor-pointer ue:select-none ue:items-center ue:gap-1.5 ue:rounded-(--c-row-radius) ue:pl-0.5 ue:pr-2 ue:text-left ue:text-body ue:font-medium ue:text-muted ue:transition-colors ue:hover:bg-sel/60"
            >
              <FIcon className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
              <span className="ue:min-w-0 ue:flex-1 ue:truncate">{d}</span>
              <ChevronRight
                aria-hidden
                className={cn(
                  'ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle ue:transition-transform',
                  open && 'ue:rotate-90',
                )}
              />
              <span className="ue:shrink-0 ue:text-caption ue:font-normal ue:text-subtle ue:tabular-nums">
                {list.length}
              </span>
            </button>
            {open && list.map((s) => row(s, true))}
          </div>
        )
      })}
    </div>
  )
}
