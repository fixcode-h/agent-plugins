import { FilePenLine } from 'lucide-react'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { showChanges, useIsDirty } from './store.ts'

/**
 * 资源头上的「改动」：这个资源在编辑器里有没保存的改动时才出现，点了切到「改动」页（磁盘上 → 编辑器里）。
 * 只在资源页出现：保存只放在资源页（用户 2026-11-15 定，对象页里不再放一套保存）
 */
export function ChangesButton({ path }: { path: string }) {
  const { section } = useUe()
  const { ui } = h()
  const dirty = useIsDirty(path)
  if (section !== 'assets' || !dirty) return null
  return (
    <ui.Button
      size="sm"
      variant="ghost"
      onClick={() => showChanges(path)}
      title={t('看这个资源没保存的改动：磁盘上的文件 → 编辑器里现在的内容')}
    >
      <span className="ue:h-1.5 ue:w-1.5 ue:shrink-0 ue:rounded-full ue:bg-warning" />
      <FilePenLine className="ue:h-3.5 ue:w-3.5" />
      {t('改动')}
    </ui.Button>
  )
}
