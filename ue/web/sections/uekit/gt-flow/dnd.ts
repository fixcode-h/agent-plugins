import type { GtStep } from '../../../../shared/gt-script/index.ts'

/**
 * 往流程图上拖步骤的数据格式：节点面板、脚本库（拖进来就是 call，按住 Alt 是展开成副本）都把要插的步骤数组
 * JSON 放进这个类型，连线上的「+」和空槽占位接住后插到那里
 */
export const GT_STEPS_MIME = 'application/x-gt-steps'

export function readDrop(e: { dataTransfer: DataTransfer | null }): GtStep[] | undefined {
  const raw = e.dataTransfer?.getData(GT_STEPS_MIME)
  if (!raw) return undefined
  try {
    const v = JSON.parse(raw) as unknown
    const arr = Array.isArray(v) ? v : [v]
    return arr.every((s) => s && typeof s === 'object' && typeof (s as GtStep).action === 'string')
      ? (arr as GtStep[])
      : undefined
  } catch {
    return undefined
  }
}

/** 拖的时候按着 Alt：脚本库拖进来的「调用脚本」展开成一份副本（拖动开始时按着、或松手时按着都算） */
export const GT_COPY_MIME = 'application/x-gt-copy'
export const wantsCopy = (e: { altKey: boolean; dataTransfer: DataTransfer | null }) =>
  e.altKey || !!e.dataTransfer?.types.includes(GT_COPY_MIME)

export const canDrop = (e: { dataTransfer: DataTransfer | null }) => !!e.dataTransfer?.types.includes(GT_STEPS_MIME)
