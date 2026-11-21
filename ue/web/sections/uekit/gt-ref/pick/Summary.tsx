import {
  identLeaves,
  isIdentGroup,
  propLabel,
  type GtIdentItem,
  type GtIdentNode,
  type GtRef,
} from '../../../../../shared/gt-script/index.ts'
import { t } from '../../../../host.ts'
import { PathChips } from '../../../../path-chips/PathChips.tsx'
import { classShort, identText, identTreeText, inText } from '../describe.ts'
import { stateName } from '../IdentList.tsx'

/** 一条标识去掉属性名之后的比较（`= 1001`、`包含 杂货`）：属性名另用小块画 */
function compareOf(it: GtIdentItem): string {
  const all = identText(it)
  const label = propLabel(it.prop, { t })
  if (all === label) return t('是')
  return all.startsWith(label) ? all.slice(label.length).trim() : all
}

/**
 * 底栏「存进脚本：」那一行（效果图 3、4）：类、在哪找、每条标识。存的只有这些，运行时按它重新找，不存那个对象本身
 */
export function Summary({
  cls,
  inn,
  ident,
  part,
}: {
  cls: string
  inn: GtRef['in']
  /** 存盘写法的唯一标识（normalizeIdent 过的） */
  ident: GtIdentNode[]
  /** 动作落点的部件（选对象面板 withPart 时） */
  part?: string
}) {
  if (!cls) return <span className="ue:text-footnote ue:text-subtle">{t('先定类，再挑唯一标识组')}</span>
  return (
    <span className="ue:inline-flex ue:min-w-0 ue:flex-wrap ue:items-center ue:gap-1.5 ue:text-footnote ue:text-subtle">
      {t('存进脚本：')}
      <span className="ue:font-mono ue:text-fg">{classShort(cls)}</span>
      {inn !== undefined && <span>· {inText(inn)}</span>}
      {ident.some(isIdentGroup) ? (
        // 有条件组（2.1.6）：小块摆不下且 / 或、括号，整句写出来
        <span className="ue:text-fg">· {identTreeText(ident)}</span>
      ) : (
        identLeaves(ident).map((it, i) => (
          <span key={`${it.prop}#${i}`} className="ue:inline-flex ue:items-center ue:gap-1">
            ·{it.not && <span className="ue:text-warning">{t('非')}</span>}
            <PathChips path={it.prop} small stateName={stateName} />
            <span className="ue:text-fg">{compareOf(it)}</span>
          </span>
        ))
      )}
      {!ident.length && <span>· {t('只按类认')}</span>}
      {part && (
        <span className="ue:inline-flex ue:items-center ue:gap-1">
          · {t('部件')}
          <PathChips path={`@/${part.split('.').join('/')}`} small />
        </span>
      )}
    </span>
  )
}
