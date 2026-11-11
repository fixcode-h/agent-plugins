import {
  AppWindow,
  Axis3d,
  Bone,
  Box,
  Camera,
  Circle,
  Flashlight,
  Image,
  Keyboard,
  Lightbulb,
  MoveRight,
  Move,
  PersonStanding,
  Pill,
  Puzzle,
  Sparkles,
  Spline,
  Square,
  Stamp,
  Sun,
  Volume2,
  type LucideIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Caret } from './details/controls.tsx'
import { h, t } from './host.ts'

export interface Comp {
  path: string
  name: string
  class: string
  parent: string
  root: boolean
  /** 场景组件（有变换、能挂接）；桥接 1.5.0 起有，旧桥接按「没父组件又不是根」认成非场景组件 */
  scene?: boolean
  /** 怎么来的：native（C++ 构造函数）、blueprint（蓝图组件列表）、script（构造脚本）、instance（关卡里加的） */
  created?: 'native' | 'blueprint' | 'script' | 'instance'
}

/** 按类名挑图标，和 UE 组件面板的意思对上（骨骼网格、静态网格、弹簧臂、灯、相机…），认不出的用拼图 */
const ICONS: [RegExp, LucideIcon][] = [
  [/SkeletalMesh|SkinnedMesh|Poseable/i, Bone],
  [/StaticMesh|InstancedStatic|Mesh/i, Box],
  [/SpringArm/i, Spline],
  [/Camera/i, Camera],
  [/SpotLight/i, Flashlight],
  [/DirectionalLight|SkyLight/i, Sun],
  [/Light/i, Lightbulb],
  [/Capsule/i, Pill],
  [/Sphere/i, Circle],
  [/BoxComponent|Box/i, Square],
  [/Audio|Sound/i, Volume2],
  [/Niagara|Particle/i, Sparkles],
  [/Widget/i, AppWindow],
  [/Movement/i, Move],
  [/Input/i, Keyboard],
  [/Arrow/i, MoveRight],
  [/Billboard|Sprite/i, Image],
  [/Decal/i, Stamp],
  [/Scene|Transform/i, Axis3d],
]
const iconOf = (cls: string) => ICONS.find(([re]) => re.test(cls))?.[1] ?? Puzzle

const ORIGIN: Record<string, () => string> = {
  native: () => 'C++',
  blueprint: () => t('蓝图'),
  script: () => t('构造脚本'),
  instance: () => t('实例'),
}

/**
 * 组件树（照 UE 的组件面板）：最上面是 Actor 自己，场景组件按挂接关系缩进、有子组件的带展开箭头，
 * 移动组件这类非场景组件放在分隔线下面；右边小字标组件是在 C++ 里、蓝图里还是关卡里加的
 */
export function CompTree({
  actor,
  items,
  selected,
  onSelect,
}: {
  actor: string
  items: Comp[]
  selected: string
  onSelect: (path: string) => void
}) {
  const { cn } = h()
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const paths = new Set(items.map((c) => c.path))
  const isScene = (c: Comp) => c.scene ?? (c.root || !!c.parent)
  const scene = items.filter(isScene)
  const other = items.filter((c) => !isScene(c))
  const kids = (p: string) => scene.filter((c) => c.parent === p)
  // 根：根组件排第一，父组件不在列表里的也当根（挂到别的 Actor 上的）
  const roots = scene.filter((c) => !c.parent || !paths.has(c.parent)).sort((a, b) => Number(b.root) - Number(a.root))

  const row = (c: Comp, depth: number, seen: Set<string>): ReactNode => {
    const ch = seen.has(c.path) ? [] : kids(c.path)
    const open = !closed[c.path]
    const Icon = iconOf(c.class)
    const next = new Set(seen).add(c.path)
    return (
      <li key={c.path}>
        <div
          role="treeitem"
          aria-selected={selected === c.path}
          aria-expanded={ch.length ? open : undefined}
          tabIndex={0}
          onClick={() => onSelect(c.path)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSelect(c.path)
            else if (e.key === 'ArrowLeft' && ch.length) setClosed((x) => ({ ...x, [c.path]: true }))
            else if (e.key === 'ArrowRight' && ch.length) setClosed((x) => ({ ...x, [c.path]: false }))
          }}
          title={`${c.name} (${c.class})`}
          style={{ paddingLeft: 6 + depth * 16 }}
          className={cn(
            'ue:flex ue:h-7 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:pr-2 ue:text-footnote ue:outline-none ue:transition-colors ue:focus-visible:bg-hover',
            selected === c.path ? 'ue:bg-sel ue:text-fg' : 'ue:text-fg ue:hover:bg-hover',
          )}
        >
          {ch.length ? (
            <button
              type="button"
              aria-label={open ? t('收起') : t('展开')}
              onClick={(e) => {
                e.stopPropagation()
                setClosed((x) => ({ ...x, [c.path]: open }))
              }}
              className="ue:flex ue:h-4 ue:w-4 ue:shrink-0 ue:cursor-pointer ue:items-center ue:justify-center ue:text-muted ue:hover:text-fg"
            >
              <Caret open={open} />
            </button>
          ) : (
            <span className="ue:w-4 ue:shrink-0" />
          )}
          <Icon className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-muted" />
          <span className="ue:min-w-0 ue:truncate">
            {c.name}
            {c.root && <span className="ue:text-subtle"> ({t('根')})</span>}
          </span>
          {c.created && (
            <span className="ue:ml-auto ue:shrink-0 ue:pl-2 ue:text-caption ue:text-subtle">
              {ORIGIN[c.created]?.()}
            </span>
          )}
        </div>
        {ch.length > 0 && open && (
          <ul role="group" className="ue:motion-safe:animate-fade">
            {ch.map((k) => row(k, depth + 1, next))}
          </ul>
        )}
      </li>
    )
  }

  const self = actor.split('.').pop() ?? actor
  return (
    <ul role="tree" aria-label={t('组件')} className="ue:py-1">
      <li>
        <div
          role="treeitem"
          aria-selected={!selected}
          tabIndex={0}
          onClick={() => onSelect('')}
          onKeyDown={(e) => e.key === 'Enter' && onSelect('')}
          className={cn(
            'ue:flex ue:h-7 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:px-2 ue:text-footnote ue:outline-none ue:transition-colors ue:focus-visible:bg-hover',
            !selected ? 'ue:bg-sel ue:text-fg' : 'ue:text-fg ue:hover:bg-hover',
          )}
        >
          <PersonStanding className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-muted" />
          <span className="ue:truncate ue:font-medium">{self}</span>
          <span className="ue:shrink-0 ue:text-subtle">{t('（自我）')}</span>
        </div>
      </li>
      {roots.map((c) => row(c, 0, new Set()))}
      {other.length > 0 && (
        <>
          <li aria-hidden className="ue:mx-2 ue:my-1 ue:border-t ue:border-line" />
          {other.map((c) => row(c, 0, new Set()))}
        </>
      )}
    </ul>
  )
}
