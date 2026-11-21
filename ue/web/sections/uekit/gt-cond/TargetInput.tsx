import { TriangleAlert } from 'lucide-react'
import type { GtTarget } from '../../../../shared/gt-script/ref/types.ts'
import { t } from '../../../host.ts'
import { asTarget, isOldSelector } from '../gt-ref/describe.ts'
import { ObjInput, useRefGroups } from '../gt-ref/ObjInput.tsx'
import { PartInput, partsOf } from '../gt-ref/PartInput.tsx'

/**
 * 动作落点（协议第 2 节）：对象 + 部件。对象是引用（命名对象、$变量、内联的类 + 标识），
 * 部件是控件在这个类自己的控件树里的名字，下拉里列属性树的部件组，也能直接填。
 * 纯 Slate 控件的 slate 段只在文件里写了时显示。v3 的选择器字符串不再认（旧格式不迁移）：提示按新写法重选
 */
export function TargetInput({ value, onChange }: { value: unknown; onChange: (v: GtTarget | undefined) => void }) {
  const tg = asTarget(value)
  const { groups } = useRefGroups(tg?.obj)
  const set = (patch: Partial<GtTarget>) => {
    const next = { ...(tg ?? { obj: '' }), ...patch } as GtTarget
    for (const k of ['part', 'slate'] as const) if (!next[k]) delete next[k]
    onChange(next.obj ? next : undefined)
  }
  return (
    <div className="ue:flex ue:min-w-0 ue:flex-col ue:gap-1.5">
      {isOldSelector(value) && (
        <p className="ue:flex ue:items-start ue:gap-1.5 ue:text-caption ue:text-warning">
          <TriangleAlert className="ue:mt-0.5 ue:h-3.5 ue:w-3.5 ue:shrink-0" />
          <span className="ue:min-w-0 ue:break-all">
            {t('旧选择器 {s}：旧格式不再支持，请在下面重新选对象和部件', { s: String(value) })}
          </span>
        </p>
      )}
      <ObjInput
        value={tg?.obj}
        onChange={(obj) => (obj ? set({ obj }) : onChange(undefined))}
        part={tg?.part}
        // 面板里在结构栏点子控件就是部件：对象和部件一起换（原来的 slate 段留着）
        onTarget={(next) => onChange({ ...(tg?.slate ? { slate: tg.slate } : {}), ...next })}
      />
      {tg?.obj && <PartInput value={tg.part ?? ''} onChange={(part) => set({ part })} parts={partsOf(groups)} />}
      {tg?.slate !== undefined && (
        <span className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle" title={tg.slate}>
          slate: {tg.slate}
        </span>
      )}
    </div>
  )
}
