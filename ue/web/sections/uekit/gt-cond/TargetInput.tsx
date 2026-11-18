import { ASSET_KINDS } from '../../../asset-icons.ts'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { t } from '../../../host.ts'
import { useSearchIndex } from '../../../jump/index-data.ts'
import { SuggestInput } from '../../../SuggestInput.tsx'
import { matchWidgets } from '../gt-widget-match.ts'

/**
 * 控件选择器输入框（WBP_X:Root/Btn、$item>BtnClaim）：还没写冒号时从资源索引里按名字挑界面（按继承 UUserWidget 认，
 * 和阻挡界面下拉同一份索引），挑中填成「界面:.」；写了冒号以后就是手填路径
 */
export function TargetInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const { project } = useEditCtx()
  const index = useSearchIndex(project)
  const suggest = (q: string) => {
    if (q.includes(':') || q.startsWith('$')) return { rows: [], total: 0 }
    const m = matchWidgets(index.idx, q, 30)
    const { icon, tone } = ASSET_KINDS['umg-widget']
    return {
      total: m.total,
      rows: m.rows.map((w) => ({
        key: w.pkg,
        value: `${w.value}:.`,
        label: w.name,
        detail: w.pkg,
        icon,
        tone,
        dim: !w.sure,
      })),
    }
  }
  return (
    <SuggestInput
      value={value}
      onChange={onChange}
      suggest={suggest}
      inputClassName="ue:font-mono"
      placeholder={placeholder ?? t('界面:路径，例如 WBP_Shop:Root/BtnBuy')}
      empty={t('写界面名找 WBP，或直接写选择器')}
    />
  )
}
