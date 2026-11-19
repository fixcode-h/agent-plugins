import { sourceOf } from '../../../../shared/forge-doc/include.ts'
import { lineOf, type PathSeg } from '../../../../shared/forge-doc/locate.ts'
import { t } from '../../../host.ts'
import { useFragmentAt, type ForgeExpanded } from '../forge-config/use-expanded.ts'
import { ErrorBox, Hint, Loading } from '../forge-parts.tsx'
import { ForgeMarkupView } from './ForgeMarkupView.tsx'

/**
 * AssetForge 右栏的「标记视图」页签：按展开 include 之后的文档画标签（ForgeMarkupView），
 * 点标签 / 属性时找到它在哪份文件（主文件或片段）的哪一行，交给 onFocus 切到「配置原文」定位。
 */
export function ForgeMarkupTab({
  loading,
  error,
  text,
  expanded,
  main,
  onFocus,
}: {
  loading: boolean
  error: string
  text?: string
  expanded?: ForgeExpanded
  /** 主文件（相对配置根） */
  main?: string
  onFocus: (file: string, line: number) => void
}) {
  const fragmentAt = useFragmentAt(expanded)
  if (error) return <ErrorBox>{error}</ErrorBox>
  if (text === undefined) return loading ? <Loading /> : <Hint>{t('没有配置原文')}</Hint>
  if (!expanded) return <Loading />
  if (expanded.doc === undefined) return <Hint>{t('配置读不懂，画不出标记视图：先在「配置原文」把它修好')}</Hint>
  const jump = (path: PathSeg[]) => {
    if (!main) return
    const src = sourceOf(expanded, path, main)
    const lines = expanded.files.get(src.file)?.lines
    const line = lines && lineOf(lines, src.path)
    if (line) onFocus(src.file, line)
  }
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-2 ue:p-4">
      <p className="ue:text-caption ue:text-subtle">{t('按配置画成标签，只读；点标签或属性跳到配置原文对应的行')}</p>
      {expanded.errors.map((e) => (
        <p key={e} className="ue:text-footnote ue:text-danger">
          {e}
        </p>
      ))}
      <ForgeMarkupView
        doc={expanded.doc}
        fragmentAt={expanded.origins.length ? fragmentAt : undefined}
        onJump={jump}
        onOpenFragment={(file) => onFocus(file, 1)}
      />
    </div>
  )
}
