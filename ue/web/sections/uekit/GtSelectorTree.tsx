import { CornerDownRight } from 'lucide-react'
import { t } from '../../host.ts'
import { Badge } from '../../ui.tsx'
import { selectorTree } from './gt-selector-tree.ts'

/** 每层缩进的像素；层数多时封顶，深的选择器（十几层）也不会挤到右边看不见 */
const STEP = 12
const MAX_INDENT = 16 * STEP

/**
 * 步骤参数里的 target / toTarget 按树显示：一层一行，屏名、进入嵌套 WBP（`>`）、Slate 段（`>>`）、
 * 按位置写的段（容器里第几个）各带标记，最后一层（真正点的控件）加粗。原文在悬停提示里，右键可复制
 */
export function GtSelectorTree({ target }: { target: string }) {
  const nodes = selectorTree(target)
  return (
    <div className="ue:flex ue:min-w-0 ue:flex-col ue:gap-0.5 ue:font-mono" title={target}>
      {nodes.map((n, k) => {
        const last = k === nodes.length - 1
        return (
          <div
            key={k}
            className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5"
            style={{ paddingLeft: Math.min(n.depth * STEP, MAX_INDENT) }}
          >
            {n.depth > 0 && <CornerDownRight className="ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle" />}
            <span
              className={
                last ? 'ue:min-w-0 ue:break-all ue:font-medium ue:text-fg' : 'ue:min-w-0 ue:break-all ue:text-muted'
              }
            >
              {n.text}
            </span>
            {n.kind === 'screen' && <Badge>{t('界面')}</Badge>}
            {n.kind === 'hop' && <Badge title={t('「>」之后从这个嵌套界面自己的控件树根开始找')}>{t('进入')}</Badge>}
            {n.kind === 'slate' && <Badge>Slate</Badge>}
            {n.index !== undefined && (
              <Badge tone="accent" title={t('按位置写的：容器里顺序变了会指到别的控件')}>
                {t('第 {n} 个', { n: n.index + 1 })}
              </Badge>
            )}
          </div>
        )
      })}
    </div>
  )
}
