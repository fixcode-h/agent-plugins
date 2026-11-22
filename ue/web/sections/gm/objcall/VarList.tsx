import { Plus, X } from 'lucide-react'
import type { Prop } from '../../../details/model.ts'
import { Details } from '../../../details/Details.tsx'
import type { DetailsApi, Node } from '../../../details/rows.tsx'
import { t } from '../../../host.ts'

/** 中栏选中的一个变量（UE 属性或 Lua 字段）：右栏「改变量」按它抓取值、写回 */
export interface VarSel {
  /** obj.set / gt.props 认的属性路径（@.Count） */
  prop: string
  name: string
  type: string
  lua: boolean
  value?: unknown
  readOnly?: boolean
  why?: string
  enum?: string[]
  /** 在中栏值控件里直接改的：右栏「新值」先填它 */
  draft?: string
}

export const varOf = (p: Prop, lua: boolean): VarSel => ({
  prop: p.name,
  name: p.displayName ?? p.name,
  type: p.type,
  lua,
  value: p.value,
  readOnly: p.readOnly,
  why: p.readOnlyWhy,
  enum: p.enum,
})

/** 细节面板里点的一行 → 右栏要改的变量：顶层按 Prop（带枚举、只读原因），展开出来的成员按行自己的信息 */
function selOf(list: Prop[], n: Node, lua: boolean): VarSel {
  const p = list.find((x) => x.name === n.path)
  if (p) return varOf(p, lua)
  return {
    prop: n.path,
    name: n.label,
    type: n.type ?? '',
    lua,
    value: n.value,
    readOnly: n.readOnly,
    why: n.readOnlyWhy,
    enum: n.enum,
  }
}

/**
 * 对象调用中栏的属性 / Lua 字段 / 运行状态（用户 2026-11-22：照 UE 细节面板的样子画，和选对象弹窗同一个 Details）：
 * 按分类分组，结构体按分量、颜色带色块、布尔是勾选框、数组能展开。点一行（含展开出来的成员）在右栏「改变量」里展示；
 * 直接在值控件里改，会选中这一行并把改的值填进右栏的「新值」，还是点「修改」才写回。取对象时行尾 ＋ / × 挑要读的属性
 */
export function VarList({
  list,
  lua,
  q,
  selected,
  onPick,
  picking,
  picked,
  onTogglePick,
}: {
  list: Prop[]
  lua: boolean
  q: string
  selected?: string
  onPick: (v: VarSel) => void
  picking: boolean
  picked: string[]
  onTogglePick: (prop: string) => void
}) {
  const api: Omit<DetailsApi, 'q'> = {
    busy: '',
    version: 0,
    changed: () => undefined,
    isChanged: () => false,
    setValue: (n, raw) => onPick({ ...selOf(list, n, lua), draft: raw }),
    arrayOp: () => undefined,
    reset: () => undefined,
    openRef: () => undefined,
    loadFull: async (path: string) => list.find((x) => x.name === path)?.value,
    onRow: (n) => onPick(selOf(list, n, lua)),
    selected,
    action: picking
      ? (n, depth) => {
          if (depth > 0) return null
          const on = picked.includes(n.path)
          return (
            <button
              type="button"
              title={on ? t('不读这个属性') : t('取对象时读这个属性')}
              aria-label={on ? t('不读这个属性') : t('取对象时读这个属性')}
              onClick={(e) => {
                e.stopPropagation()
                onTogglePick(n.path)
              }}
              className="ue:grid ue:h-6 ue:w-6 ue:cursor-pointer ue:place-items-center ue:rounded-md ue:text-subtle ue:hover:bg-hover ue:hover:text-accent"
            >
              {on ? <X className="ue:h-3.5 ue:w-3.5" /> : <Plus className="ue:h-3.5 ue:w-3.5" />}
            </button>
          )
        }
      : undefined,
  }
  return <Details props={list} api={api} query={q} flatSingle={lua} />
}
