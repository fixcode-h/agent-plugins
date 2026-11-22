import { useState } from 'react'
import type { GtRef, GtScript, GtStep } from '../../../../shared/gt-script/index.ts'
import { EditContext } from '../gt-edit/ctx.ts'
import { ObjInput } from '../gt-ref/ObjInput.tsx'
import { CallInspector } from './call-inspector.tsx'
import { SetInspector } from './set-inspector.tsx'

/**
 * 设置 →「组件」里对象块和对象动作检查器的示例（第二期）：假数据、不连 UE（命中数、成员面板、抓取值要连上编辑器才有）。
 * 对象块四种样子：脚本里的对象、前面「找对象」存的 $变量、内联、空；调函数、设属性检查器能改，改动只在这里
 */
const DOC: GtScript = {
  kind: 'gametest-scenario',
  schemaVersion: 5,
  name: '杂货铺',
  objects: {
    shop: { class: 'WBP_Shop_C', in: 'screen', ident: [{ prop: '@.ShopId', op: 'eq', value: 3 }] },
  },
  steps: [
    { id: 'f1', action: 'obj.find', obj: { class: 'BP_Npc_C', in: 'world' }, saveAs: 'npc' },
    {
      id: 'c1',
      action: 'obj.call',
      obj: 'shop',
      function: 'BuyItem',
      args: { ItemId: 1001, Count: 2, Buyer: '$npc' },
      saveAs: 'ok',
      expect: { value: '$ok', equals: true },
    },
    { id: 'p1', action: 'obj.set', obj: 'shop', prop: '@.bShowTips', value: false },
  ],
}

export function ObjOpsSpecimen() {
  const [doc, setDoc] = useState(DOC)
  const step = (i: number) => doc.steps![i] as GtStep
  const setStep = (i: number) => (s: GtStep) => setDoc({ ...doc, steps: doc.steps!.map((x, j) => (j === i ? s : x)) })
  const setObject = (name: string, ref: GtRef) => setDoc({ ...doc, objects: { ...doc.objects, [name]: ref } })
  const [vals, setVals] = useState<unknown[]>(['shop', '$npc', { class: 'WBP_Bag_C', in: 'screen' }, undefined])
  const box = 'ue:flex ue:flex-col ue:gap-2 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:p-3'
  return (
    <EditContext.Provider
      value={{ project: '', root: '', live: false, doc, apis: [], aliases: [], at: ['steps', 1], setObject }}
    >
      <div className="ue:grid ue:grid-cols-1 ue:gap-3 ue:lg:grid-cols-3">
        <div className={box}>
          <span className="ue:text-caption ue:text-subtle">ObjInput</span>
          {vals.map((v, i) => (
            <ObjInput key={i} value={v as GtRef} onChange={(x) => setVals(vals.map((y, j) => (j === i ? x : y)))} />
          ))}
        </div>
        <div className={box}>
          <span className="ue:text-caption ue:text-subtle">CallInspector</span>
          <CallInspector step={step(1)} onChange={setStep(1)} />
        </div>
        <div className={box}>
          <span className="ue:text-caption ue:text-subtle">SetInspector</span>
          <SetInspector step={step(2)} onChange={setStep(2)} />
        </div>
      </div>
    </EditContext.Provider>
  )
}
