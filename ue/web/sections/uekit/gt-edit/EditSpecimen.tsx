import { useState } from 'react'
import type { EditResult, GtPath, GtScript } from '../../../../shared/gt-script/index.ts'
import { CondEditor } from '../gt-cond/CondEditor.tsx'
import { EditContext } from './ctx.ts'
import { Inspector } from './Inspector.tsx'
import { ListView } from './ListView.tsx'
import { ScriptSettings } from './ScriptSettings.tsx'

/**
 * 设置 →「组件」里脚本编辑页的示例：列表视图 + 检查器 + 条件组编辑器，假数据、不连 UE（「现在核对」「从代码选」只显示样子）。
 * 能选、能用键盘挪、能改字段，改动只在这里
 */
const DOC: GtScript = {
  kind: 'gametest-scenario',
  schemaVersion: 4,
  name: '每日福利',
  vars: { claimed: 0 },
  objects: {
    main: { class: 'WBP_Main_C', in: 'screen' },
    welfare: { class: 'WBP_Welfare_C', in: 'screen' },
  },
  steps: [
    { id: 's1', action: 'call', script: 'common/登录并进主城' },
    {
      id: 'g1',
      action: 'group',
      name: '打开福利',
      do: [
        { id: 's2', action: 'click', target: { obj: 'main', part: 'BtnWelfare' } },
        { id: 's3', action: 'wait', until: 'cond', cond: { obj: 'welfare', prop: ':onScreen', op: 'is', value: true } },
      ],
    },
    {
      id: 'loop1',
      action: 'loop',
      each: { obj: 'welfare', part: 'List' },
      as: 'item',
      max: 30,
      do: [
        {
          id: 'if1',
          action: 'if',
          branch: 'state',
          cond: { obj: '$item', prop: '@BtnClaim:enabled', op: 'is', value: true },
          then: [
            { id: 's4', action: 'click', target: { obj: '$item', part: 'BtnClaim' } },
            { id: 'set1', action: 'set', var: 'claimed', value: '=$claimed + 1' },
          ],
          elif: [
            {
              cond: { obj: '$item', prop: '@TxtState:text', op: 'eq', value: '已领取' },
              then: [{ id: 's5', action: 'continue' }],
            },
          ],
          else: [],
        },
      ],
    },
    {
      id: 's6',
      action: 'assert',
      cond: {
        all: [
          { value: '$claimed', gte: 1 },
          { obj: 'welfare', prop: '@RedDot:visible', op: 'is', value: false },
        ],
      },
    },
    { id: 's7', action: 'obj.close', obj: 'welfare', how: [{ by: 'click', part: 'BtnClose' }] },
  ],
}

export function EditSpecimen() {
  const [doc, setDoc] = useState(DOC)
  const [sel, setSel] = useState<GtPath[]>([['steps', 2, 'do', 0]])
  const apply = (r: EditResult | GtScript | undefined) => {
    if (!r) return false
    if ('path' in r && Array.isArray(r.path) && 'doc' in r) {
      setDoc((r as EditResult).doc)
      setSel([(r as EditResult).path])
    } else setDoc(r as GtScript)
    return true
  }
  return (
    <EditContext.Provider value={{ project: '', root: '', live: false, doc, apis: [], aliases: [] }}>
      <div className="ue:flex ue:flex-col ue:gap-3">
        <div className="ue:flex ue:h-[420px] ue:overflow-hidden ue:rounded-(--c-row-radius) ue:border ue:border-line">
          <div className="ue:flex ue:min-w-0 ue:flex-1 ue:flex-col">
            <ListView doc={doc} onChange={apply} selected={sel} onSelect={setSel} />
          </div>
          <aside className="ue:w-[340px] ue:shrink-0 ue:overflow-auto ue:border-l ue:border-line">
            {sel.length ? (
              <Inspector
                doc={doc}
                selected={sel}
                onChange={apply}
                ctx={{ doc, selected: sel, apply, select: setSel }}
              />
            ) : (
              <ScriptSettings doc={doc} onChange={apply} />
            )}
          </aside>
        </div>
        <CondEditor
          value={{
            any: [
              { obj: { class: 'WBP_Notice_C' }, prop: ':onScreen', op: 'is', value: true },
              { expr: '@ps.Gold >= $gold0 + 500' },
            ],
          }}
          onChange={() => undefined}
        />
      </div>
    </EditContext.Provider>
  )
}
