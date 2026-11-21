import { Box, ChevronRight, ExternalLink, Eye, FileText } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { h, t } from '../../../host.ts'
import { Badge } from '../../../ui.tsx'
import type { InspectRes } from '../inspect-data.ts'
import { StateBadge, worldName } from './parts.tsx'
import { baseName, isClassObj, parseSrc, stateOf, type BoundObj } from './tree-model.ts'

/** 元表链的一层：UELink 2.19 起带 kind（lua = 模块，ue = UnLua 给 UE 类建的元表） */
export type ChainLayer = NonNullable<InspectRes['chain']>[number] & { kind?: 'lua' | 'ue' }

/**
 * 检视区顶上的对象卡（设计稿效果图 1）：名字和状态、UE 类、世界、Lua 文件、对象路径，
 * 「在对象页打开」「打开 .lua」「监视」。只在看绑定对象的实例表时出现（全局、模块表没有这些）
 */
export function ObjectHead({
  name,
  path,
  obj,
  src,
  onOpenObj,
  onOpenLua,
  onWatch,
}: {
  name: string
  path: string
  /** 树里这个对象的一项（有状态、世界）；树还没读到时没有 */
  obj?: BoundObj
  /** lua.inspect 回的定义位置（自己的第一个 Lua 函数） */
  src?: string
  onOpenObj: (path: string) => void
  onOpenLua: (file: string, line?: number) => void
  onWatch: () => void
}) {
  const { ui } = h()
  const file = src ? parseSrc(src) : undefined
  const meta: [string, ReactNode][] = []
  if (obj?.class) meta.push([t('UE 类'), <span className="ue:font-mono">{obj.class}</span>])
  if (obj?.world) meta.push([t('世界'), worldName(obj.world)])
  if (obj?.module) meta.push([t('Lua 模块'), <span className="ue:font-mono">{obj.module}</span>])
  if (obj?.ownerName) meta.push([t('归属'), <span className="ue:font-mono">{obj.ownerName}</span>])
  // 纯 Lua 实例（lua.instances 给的 luaref）不是 UObject：没有对象页可开，引用只在这次游戏里有效
  const pure = path.startsWith('luaref:')
  meta.push([
    pure ? t('引用') : t('对象'),
    <span className="ue:font-mono">{pure ? path : path.split(/[.:]/).slice(-2).join('.')}</span>,
  ])
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5">
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
        <Box className="ue:h-4 ue:w-4 ue:text-subtle" />
        <span className="ue:font-mono ue:text-body ue:font-medium ue:text-fg">{name}</span>
        {obj && <StateBadge state={stateOf(obj)} />}
        {obj && isClassObj(obj) && (
          <Badge
            tone="run"
            title={t('这是类（UClass）不是实例：没开始玩时 UnLua 只给类建了表。调 UE 函数时 self 要选一个实例')}
          >
            {t('类对象')}
          </Badge>
        )}
        {pure && (
          <Badge tone="run" title={t('Lua 框架自己 new 的表，不绑 UObject；模块重载或被回收后要重新找')}>
            {t('纯 Lua 实例')}
          </Badge>
        )}
        <span className="ue:ml-auto" />
        {!pure && (
          <ui.Button size="sm" variant="secondary" onClick={() => onOpenObj(path)}>
            <ExternalLink className="ue:h-3.5 ue:w-3.5" /> {t('在对象页打开')}
          </ui.Button>
        )}
        {file?.line !== undefined && (
          <ui.Button size="sm" variant="secondary" onClick={() => onOpenLua(file.file)}>
            <FileText className="ue:h-3.5 ue:w-3.5" /> {t('打开 .lua')}
          </ui.Button>
        )}
        <ui.Button size="sm" variant="ghost" onClick={onWatch}>
          <Eye className="ue:h-3.5 ue:w-3.5" /> {t('监视')}
        </ui.Button>
      </div>
      <div className="ue:flex ue:flex-wrap ue:gap-x-4 ue:gap-y-0.5 ue:text-caption ue:text-muted" title={path}>
        {meta.map(([k, v]) => (
          <span key={k} className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
            <span className="ue:text-subtle">{k}</span>
            <span className="ue:truncate">{v}</span>
          </span>
        ))}
        {file?.line !== undefined && (
          <span className="ue:flex ue:items-center ue:gap-1.5" title={file.file}>
            <span className="ue:text-subtle">{t('Lua 文件')}</span>
            <span className="ue:font-mono">{baseName(file.file)}</span>
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * 继承链（元表 __index 往上）：「实例表 › [Lua] 模块 › [UE] 类 › …」。点 Lua 那几层在检视区打开那个模块表；
 * UE 那几层只显示类名（资源路径在悬停提示里）。chain 要先过 tidyChain：重复的层不显示，超过 6 层折起中间的
 */
export function ChainChips({
  top,
  chain,
  onModule,
}: {
  top: string
  chain: (ChainLayer & { dup?: boolean })[]
  onModule: (name: string) => void
}) {
  const { cn } = h()
  const [all, setAll] = useState(false)
  const list = chain.filter((c) => !c.dup)
  const hidden = !all && list.length > 6 ? list.length - 4 : 0
  const shown = hidden ? [...list.slice(0, 3), undefined, list[list.length - 1]] : list
  const chip =
    'ue:inline-flex ue:h-6 ue:items-center ue:gap-1.5 ue:rounded-md ue:border ue:border-line ue:px-2 ue:font-mono ue:text-caption'
  return (
    <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-1">
      <span className="ue:mr-1 ue:text-caption ue:text-subtle">{t('继承')}</span>
      <span className={cn(chip, 'ue:bg-sel ue:text-fg')}>{top}</span>
      {shown.map((c, i) => {
        if (!c)
          return (
            <span key="more" className="ue:flex ue:items-center ue:gap-1">
              <ChevronRight className="ue:h-3 ue:w-3 ue:text-subtle" />
              <button
                type="button"
                onClick={() => setAll(true)}
                className={cn(chip, 'ue:cursor-pointer ue:border-dashed ue:text-muted ue:hover:bg-hover')}
              >
                {t('还有 {n} 层', { n: hidden })}
              </button>
            </span>
          )
        const lua = c.kind === 'lua' || (!c.kind && !!c.name && !c.name.startsWith('/'))
        const body = (
          <>
            {c.name && <Badge tone={lua ? 'accent' : 'run'}>{lua ? 'Lua' : 'UE'}</Badge>}
            <span className={c.name ? (c.reflected ? 'ue:text-muted' : 'ue:text-fg') : 'ue:text-subtle'}>
              {c.name || t('（没认出的元表）')}
            </span>
          </>
        )
        const tip = [c.path, c.reflected ? t('按反射补上的父类，没有 Lua 这边的函数') : ''].filter(Boolean).join('\n')
        return (
          <span key={i} className="ue:flex ue:items-center ue:gap-1">
            <ChevronRight className="ue:h-3 ue:w-3 ue:text-subtle" />
            {lua && c.name ? (
              <button
                type="button"
                title={t('检视这个模块表')}
                onClick={() => onModule(c.name)}
                className={cn(chip, 'ue:cursor-pointer ue:bg-card ue:hover:bg-hover')}
              >
                {body}
              </button>
            ) : (
              <span className={cn(chip, 'ue:bg-card')} title={tip || c.src}>
                {body}
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}
