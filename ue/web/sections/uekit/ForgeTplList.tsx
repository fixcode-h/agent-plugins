import { FolderCog } from 'lucide-react'
import { useMemo } from 'react'
import { h, t } from '../../host.ts'
import { kindMeta } from './kinds.ts'
import type { ForgeTemplate } from './forge-templates.ts'

/**
 * 新建配置弹窗左边的模板列表：项目模板（配置根 _templates/）在最上面一组，内置模板按资产类型分组。
 * 行的样子照左栏文件树（h-7、行圆角、选中 bg-sel），读不懂的项目模板置灰、悬停看原因。
 */
export function ForgeTplList({
  builtin,
  project,
  value,
  onChange,
}: {
  builtin: ForgeTemplate[]
  project: ForgeTemplate[]
  value: string
  onChange: (id: string) => void
}) {
  const { cn } = h()
  const groups = useMemo(() => {
    const m = new Map<string, ForgeTemplate[]>()
    for (const x of builtin) m.set(x.kind, [...(m.get(x.kind) ?? []), x])
    return [...m]
  }, [builtin])
  const row = (x: ForgeTemplate) => {
    const m = kindMeta(x.kind)
    return (
      <li key={x.id}>
        <button
          type="button"
          disabled={!!x.bad}
          title={x.bad ? t('读不懂这份模板：{e}', { e: x.bad }) : x.desc()}
          onClick={() => onChange(x.id)}
          aria-pressed={x.id === value}
          className={cn(
            'ue:flex ue:h-7 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-(--c-row-radius) ue:px-2 ue:text-left ue:text-body ue:transition-colors ue:hover:bg-sel/60 ue:disabled:cursor-not-allowed ue:disabled:text-subtle',
            x.id === value ? 'ue:bg-sel ue:font-semibold ue:text-fg' : 'ue:text-fg',
          )}
        >
          <m.icon className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0', m.tone)} />
          <span className="ue:min-w-0 ue:truncate">{x.label()}</span>
        </button>
      </li>
    )
  }
  const head = (label: string) => (
    <p className="ue:px-2 ue:pt-2 ue:pb-1 ue:text-caption ue:font-medium ue:text-subtle">{label}</p>
  )
  return (
    <ul
      aria-label={t('模板')}
      className="ue:flex ue:max-h-[52vh] ue:flex-col ue:gap-0.5 ue:overflow-y-auto ue:rounded-lg ue:border ue:border-line ue:p-1"
    >
      <li>{head(t('项目模板'))}</li>
      {project.length ? (
        project.map(row)
      ) : (
        <li className="ue:flex ue:gap-1.5 ue:px-2 ue:pb-1 ue:text-caption ue:leading-relaxed ue:text-subtle">
          <FolderCog className="ue:mt-0.5 ue:h-3.5 ue:w-3.5 ue:shrink-0" />
          <span>{t('配置根下 _templates/ 里的 JSON 会列在这里；右键一份配置「存为模板」就会放进去。')}</span>
        </li>
      )}
      {groups.map(([k, list]) => (
        <li key={k}>
          {head(kindMeta(k).label())}
          <ul className="ue:flex ue:flex-col ue:gap-0.5">{list.map(row)}</ul>
        </li>
      ))}
      <li className="ue:px-2 ue:pt-2 ue:pb-1 ue:text-caption ue:leading-relaxed ue:text-subtle">
        {t(
          '动画序列、骨骼、骨骼网格体、物理资产要先有资产，在资源页「导出到 JSON」；状态树建议导出一份照着改，或让 AI 写。',
        )}
      </li>
    </ul>
  )
}
