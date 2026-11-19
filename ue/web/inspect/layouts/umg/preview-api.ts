import { looksLikePath } from '../../../details/model.ts'
import type { DetailsApi } from '../../../details/rows.tsx'

const noop = () => undefined

/**
 * 只读细节面板的动作（近似预览的控件属性、关键帧）：不改值、不固定监视；资源引用能点时交给外面跳过去。
 * 和 AssetForge 按配置预览的那份一样的意思（那个文件在 AssetForge 目录里，这里不改它，另写一份）
 */
export function readOnlyApi(onOpen?: (path: string) => void): Omit<DetailsApi, 'q'> {
  return {
    busy: '',
    version: 0,
    changed: noop,
    isChanged: () => false,
    setValue: noop,
    arrayOp: noop,
    reset: noop,
    openRef: (p) => (onOpen && looksLikePath(p) ? () => onOpen(p) : undefined),
    loadFull: async () => undefined,
  }
}
