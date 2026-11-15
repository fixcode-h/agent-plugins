import { t } from '../../host.ts'
import type { ForgeEntry } from './Forge.tsx'

/** 桩，右栏会替换：多选摘要（选中 >1 份时主区显示） */
export function ForgeMulti({
  entries,
  onOpen,
}: {
  entries: ForgeEntry[]
  busy: boolean
  onOpen: (key: string) => void
}) {
  return (
    <div className="ue:flex ue:flex-col ue:gap-1 ue:p-6 ue:text-footnote">
      <p className="ue:font-medium ue:text-fg">{t('选中了 {n} 份配置', { n: entries.length })}</p>
      {entries.map((e) => (
        <button key={e.key} type="button" className="ue:text-left ue:text-muted" onClick={() => onOpen(e.key)}>
          {e.config ?? e.name}
        </button>
      ))}
    </div>
  )
}
