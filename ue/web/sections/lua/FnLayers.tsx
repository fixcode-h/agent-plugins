import { ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { h, t } from '../../host.ts'
import { Badge } from '../../ui.tsx'
import type { LuaFn, LuaRoot } from './inspect-data.ts'
import type { SelfChoice } from './CallForm.tsx'
import { FnRow } from './InspectRows.tsx'
import type { ChainLayer } from './objects-tree/ObjectHead.tsx'
import { baseName, parseSrc } from './objects-tree/tree-model.ts'

/**
 * 检视区的函数，按继承层分组（设计稿效果图 1）：自己的、每一层 Lua 模块、每一层 UE 类各一组，
 * Lua 写的默认展开，UE 导出的（C 函数，没有参数名）默认收起。同一层的文件写在组标题上，行里只写行号
 */
export function FnLayers({
  root,
  fns,
  chain,
  choice,
  onChanged,
  onOpen,
}: {
  root: LuaRoot
  fns: LuaFn[]
  /** tidyChain 过的（名字可读、下标和函数的 from 对得上） */
  chain: (ChainLayer & { dup?: boolean })[]
  choice?: SelfChoice
  onChanged: () => void
  onOpen: (file: string, line?: number) => void
}) {
  const { cn } = h()
  const [flip, setFlip] = useState<Record<number, boolean>>({})
  const layers = [...new Set(fns.map((f) => f.from))].sort((a, b) => a - b)
  return (
    <>
      {layers.map((from) => {
        const list = fns.filter((f) => f.from === from)
        const layer = from > 0 ? chain[from - 1] : undefined
        const ue = layer?.kind === 'ue' || (!!layer && !layer.name && list.every((f) => !f.src))
        const open = flip[from] ? ue : !ue
        const files = [...new Set(list.map((f) => (f.src ? parseSrc(f.src).file : '')).filter(Boolean))]
        let title: ReactNode = t('自己的')
        if (layer)
          title = (
            <>
              <Badge tone={ue ? 'run' : 'accent'}>{ue ? 'UE' : 'Lua'}</Badge>
              <span className="ue:font-mono" title={layer.path}>
                {layer.name || t('（没认出的元表）')}
              </span>
            </>
          )
        return (
          <section key={from}>
            <button
              type="button"
              onClick={() => setFlip((x) => ({ ...x, [from]: !x[from] }))}
              className="ue:sticky ue:top-0 ue:z-1 ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:border-b ue:border-line ue:bg-card ue:px-4 ue:py-1 ue:text-left ue:text-caption ue:font-medium ue:text-muted ue:hover:text-fg"
            >
              <ChevronRight className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:transition-transform', open && 'ue:rotate-90')} />
              {title}
              <span className="ue:text-subtle">{list.length}</span>
              <span className="ue:ml-auto ue:truncate ue:font-mono ue:font-normal ue:text-subtle" title={files[0]}>
                {files.length === 1 ? baseName(files[0]) : ue ? t('C++ 导出，没有参数名') : ''}
              </span>
            </button>
            {open &&
              list.map((fn) => (
                <FnRow key={`${fn.from}\u0001${fn.name}`} root={root} fn={fn} choice={choice} onChanged={onChanged} onOpen={onOpen} />
              ))}
          </section>
        )
      })}
    </>
  )
}
