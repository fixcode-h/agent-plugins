import { ListTree } from 'lucide-react'
import { useState } from 'react'
import { lastSegOf, type CondNode } from '../../../../../shared/gt-script/index.ts'
import type { GtIdentItem, GtObjCheck, GtRefLike } from '../../../../../shared/gt-script/ref/types.ts'
import { h, t } from '../../../../host.ts'
import { defaultIdent } from '../../gt-ref/compare-table.ts'
import { describeRef, identText } from '../../gt-ref/describe.ts'
import { IdentRow } from '../../gt-ref/IdentList.tsx'
import { ObjInput, useRefGroups } from '../../gt-ref/ObjInput.tsx'
import { itemsOf } from '../../gt-ref/pick/data.ts'
import { PropPickField } from '../../gt-ref/PropPickField.tsx'
import { PropTree } from '../../gt-ref/PropTree.tsx'
import type { CheckKind } from './registry.ts'

/** 判断项那几个字段（协议 3.3）；obj 另外管 */
const ITEM_KEYS = ['prop', 'op', 'value', 'tol', 'ignoreCase', 'cmp'] as const

const itemOf = (c: CondNode): GtIdentItem => ({ ...(c as unknown as GtIdentItem), prop: String(c.prop ?? '@:exists') })

function withItem(c: CondNode, it: GtIdentItem): CondNode {
  const out: CondNode = { ...c }
  for (const k of ITEM_KEYS) delete out[k]
  for (const k of ITEM_KEYS) if (it[k] !== undefined) out[k] = it[k]
  return out
}

/**
 * 对象的属性（协议第 4 节、效果图 3）：一个对象引用 + 一个判断项。取代原来按控件写的
 * 控件状态（visible / enabled / checked…）、控件文字、文字里的数字、控件的字段四种。
 * 属性按名字找（Lua 字段、运行状态都在里面），也可以展开属性树点准星选；比较按属性类型给
 */
function Editor({ value, onChange }: { value: CondNode; onChange: (c: CondNode) => void }) {
  const { ui } = h()
  const [tree, setTree] = useState(false)
  const obj = value.obj as GtRefLike | undefined
  const { groups, data, loading } = useRefGroups(obj)
  const item = itemOf(value)
  const items = itemsOf(groups)
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5">
      <ObjInput value={obj} onChange={(o) => onChange({ ...value, obj: o ?? '' })} />
      <div className="ue:flex ue:items-start ue:gap-1">
        <PropPickField
          className="ue:min-w-0 ue:flex-1"
          value={String(value.prop ?? '')}
          items={items}
          onChange={(p, it) => onChange(withItem(value, it ? defaultIdent(it) : { ...item, prop: p }))}
        />
        <ui.IconButton size="sm" aria-pressed={tree} label={t('从属性树选')} onClick={() => setTree(!tree)}>
          <ListTree className="ue:h-3.5 ue:w-3.5" />
        </ui.IconButton>
      </div>
      {tree && (
        <div className="ue:flex ue:h-72 ue:flex-col ue:overflow-hidden ue:rounded-(--c-row-radius) ue:border ue:border-line">
          <PropTree
            className="ue:flex-1"
            data={data}
            loading={loading}
            mode="judge"
            selected={[item.prop]}
            onPick={(it) => {
              onChange(withItem(value, defaultIdent(it)))
              setTree(false)
            }}
          />
        </div>
      )}
      <IdentRow value={item} items={items} onChange={(it) => onChange(withItem(value, it))} />
    </div>
  )
}

/** 行首标签：算出状态、Lua 字段、反射属性 */
function badgeOf(prop: string) {
  const last = lastSegOf(prop)
  if (!prop || last?.kind === 'state') return t('状态')
  if (last?.kind === 'lua') return 'Lua'
  return t('属性')
}

export const propCheck: CheckKind = {
  id: 'prop',
  label: () => t('对象的属性'),
  hint: () => t('界面在不在、按钮能不能点、文字是什么、字段等于几…'),
  badge: (c) => badgeOf(String(c.prop ?? '')),
  match: (c) => 'obj' in c,
  make: () => ({ obj: '', prop: '@:onScreen', op: 'is', value: true }) as GtObjCheck as unknown as CondNode,
  summary: (c) => {
    const obj = typeof c.obj === 'string' ? c.obj : describeRef(c.obj as GtRefLike)
    return `${obj} › ${identText(itemOf(c))}`
  },
  Editor,
}
