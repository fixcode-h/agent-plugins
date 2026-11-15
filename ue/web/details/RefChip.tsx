import { CornerDownRight, Cpu, Package, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { h, t } from '../host.ts'
import { FIELD } from './controls.tsx'
import { isAssetPath, isRuntimePath, refName } from './model.ts'

/** 点引用时带的修饰键：Ctrl / Cmd + 点在资源页打开（不在当前页往下看） */
export interface OpenHow {
  ctrl?: boolean
}

/**
 * 属性里的对象引用值（设计稿第 6 节）：可点的小卡片，资源引用前面是包裹图标、运行时对象是芯片图标，
 * 末尾一个 ↳ 表示点了在这里往下看；悬停提示怎么点。空引用显示「无」，能改的给一个清空（设成 None）
 */
export function RefChip({
  path,
  disabled,
  onOpen,
  onClear,
  hover,
}: {
  path: string
  disabled?: boolean
  onOpen?: (how: OpenHow) => void
  onClear?: () => void
  /** 设置 →「组件」示例里固定画成悬停的样子 */
  hover?: boolean
}) {
  const { cn, ui } = h()
  const none = !path || path === 'None'
  const asset = !none && !isRuntimePath(path)
  const Icon = asset ? Package : Cpu
  const can = !none && !!onOpen
  const tip = none
    ? undefined
    : `${path}\n${
        can ? (isAssetPath(path) ? t('点开在这里看资源的属性 · Ctrl+点在资源页打开') : t('点开在这里看它的属性')) : ''
      }`.trim()
  return (
    <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-1">
      <button
        type="button"
        title={tip}
        disabled={!can}
        onClick={can ? (e) => onOpen!({ ctrl: e.ctrlKey || e.metaKey }) : undefined}
        className={cn(
          FIELD,
          // 引用不能改时照样能点开看，只是底色按只读画
          disabled
            ? 'ue:border-transparent ue:bg-hover ue:text-muted'
            : 'ue:border-line ue:bg-card ue:text-fg ue:dark:bg-field',
          'ue:w-auto ue:max-w-full ue:min-w-0 ue:gap-1.5 ue:text-left ue:text-footnote',
          none && 'ue:w-56 ue:text-subtle',
          can && 'ue:cursor-pointer ue:text-accent-text ue:hover:border-accent/60 ue:hover:bg-accent-soft',
          can && hover && 'ue:border-accent/60 ue:bg-accent-soft',
        )}
      >
        {!none && <Icon className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0', asset ? 'ue:text-warning' : 'ue:text-run')} />}
        <span className="ue:min-w-0 ue:truncate">{none ? t('无') : refName(path)}</span>
        {can && <CornerDownRight className="ue:h-3 ue:w-3 ue:shrink-0 ue:opacity-70" />}
      </button>
      {!none && onClear && !disabled && <ui.IconButton icon={X} label={t('清空引用')} size="xs" onClick={onClear} />}
    </div>
  )
}

/** 设置 →「组件」里的示例：资源、实例、空值、悬停、只读 */
export function RefChipSpecimen() {
  const noop = () => undefined
  const row = (label: string, el: ReactNode) => (
    <div className="ue:grid ue:grid-cols-[7rem_1fr] ue:items-center ue:gap-3">
      <span className="ue:text-footnote ue:text-subtle">{label}</span>
      {el}
    </div>
  )
  return (
    <div className="ue:flex ue:w-full ue:max-w-md ue:flex-col ue:gap-2">
      {row(t('资源'), <RefChip path="/Game/Env/SM_Floor.SM_Floor" onOpen={noop} onClear={noop} />)}
      {row(
        t('运行时实例'),
        <RefChip path="/Game/Maps/UEDPIE_0_Main.Main:PersistentLevel.BP_PlayerController_C_0" onOpen={noop} />,
      )}
      {row(t('空值'), <RefChip path="None" onOpen={noop} />)}
      {row(t('悬停'), <RefChip path="/Game/Env/MI_Floor.MI_Floor" onOpen={noop} hover />)}
      {row(t('只读'), <RefChip path="/Game/Env/M_Basic.M_Basic" disabled onOpen={noop} />)}
    </div>
  )
}
