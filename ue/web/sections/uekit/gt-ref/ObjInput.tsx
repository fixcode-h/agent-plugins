import { Box, PencilLine, Variable, X } from 'lucide-react'
import { useState } from 'react'
import type { GtRef, GtRefLike, GtTarget } from '../../../../shared/gt-script/ref/types.ts'
import { h, t } from '../../../host.ts'
import { SuggestInput } from '../../../SuggestInput.tsx'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { classOfRef, describeRef, isRefObj } from './describe.ts'
import { useProps } from './live.ts'
import { RefDialog } from './RefDialog.tsx'

/** 引用对应的属性树（只按类读）：部件下拉、属性路径下拉、判断的类型都从这里来 */
export function useRefGroups(ref: GtRefLike | undefined) {
  const ctx = useEditCtx()
  const cls = classOfRef(ref, ctx.doc?.objects)
  const p = useProps(ctx.project, ctx.live && cls ? { class: cls } : undefined)
  return { groups: p.data?.groups, data: p.data, loading: p.loading, cls }
}

/**
 * 选对象（引用的三种写法，协议第 1 节）：脚本里命名的对象（下拉）、`$变量`（这次运行里 obj.find 存的）、
 * 或者内联一个引用（弹选对象面板：类 + 在哪找 + 标识；连着游戏时面板里能直接从此刻的实例里挑）
 */
export function ObjInput({
  value,
  onChange,
  part,
  onTarget,
}: {
  value: GtRefLike | undefined
  onChange: (v: GtRefLike | undefined) => void
  /** 动作落点：现在的部件，面板结构栏里打开时选中它 */
  part?: string
  /** 动作落点：面板里连部件一起选，保存时交回对象 + 部件（不给时只交引用） */
  onTarget?: (t: GtTarget) => void
}) {
  const { ui } = h()
  const ctx = useEditCtx()
  const [dialog, setDialog] = useState(false)
  const objects = (ctx.doc?.objects ?? {}) as Record<string, unknown>
  const names = Object.keys(objects)
  const inline: GtRef | undefined = isRefObj(value) ? value : undefined

  return (
    <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-1">
      {inline ? (
        <button
          type="button"
          title={t('改这个对象的类和标识')}
          onClick={() => setDialog(true)}
          // 照面板输入框（sm 档）的样子画，和同一列的输入框对齐
          className="ue:flex ue:h-8 ue:min-w-0 ue:flex-1 ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-(--c-input-radius) ue:border-(length:--c-input-border) ue:border-line-strong ue:bg-(--c-input-bg) ue:px-2.5 ue:text-left ue:text-body"
        >
          <Box className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
          <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono ue:text-fg">{describeRef(inline)}</span>
          <PencilLine className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
        </button>
      ) : (
        <SuggestInput
          className="ue:min-w-0 ue:flex-1"
          inputClassName="ue:font-mono"
          value={typeof value === 'string' ? value : ''}
          onChange={(v) => onChange(v.trim() ? v.trim() : undefined)}
          placeholder={t('对象名、$变量，或点右边新建')}
          empty={t('脚本里还没有命名对象：点右边新建，或在「脚本设置 → 对象」里加')}
          display={(v) => {
            const o = objects[v]
            return isRefObj(o) ? `${v} · ${describeRef(o)}` : v
          }}
          suggest={(q) => {
            const k = q.trim().toLowerCase()
            const rows = names
              .filter((n) => !k || n.toLowerCase().includes(k))
              .map((n) => ({ key: n, value: n, label: n, detail: describeRef(objects[n] as GtRef), icon: Box }))
            const vars = Object.keys(ctx.doc?.vars ?? {})
              .filter((v) => !k || `$${v}`.toLowerCase().includes(k))
              .map((v) => ({ key: `$${v}`, value: `$${v}`, label: `$${v}`, detail: t('变量'), icon: Variable }))
            return { rows: [...rows, ...vars], total: rows.length + vars.length }
          }}
        />
      )}
      {inline ? (
        <ui.IconButton size="sm" label={t('不用这个对象')} onClick={() => onChange(undefined)}>
          <X className="ue:h-3.5 ue:w-3.5" />
        </ui.IconButton>
      ) : (
        <ui.IconButton size="sm" label={t('新建一个对象（类 + 标识）')} onClick={() => setDialog(true)}>
          <PencilLine className="ue:h-3.5 ue:w-3.5" />
        </ui.IconButton>
      )}
      {dialog && (
        <RefDialog
          project={ctx.project}
          live={ctx.live}
          value={inline}
          objects={objects}
          withPart={!!onTarget}
          part={part}
          onClose={() => setDialog(false)}
          onSave={(_, ref, pt) => {
            if (onTarget) onTarget(pt ? { obj: ref, part: pt } : { obj: ref })
            else onChange(ref)
            setDialog(false)
          }}
        />
      )}
    </div>
  )
}
