import { ListTree, Pencil } from 'lucide-react'
import { useState } from 'react'
import type { GtStep } from '../../../../shared/gt-script/index.ts'
import type { GtRefLike } from '../../../../shared/gt-script/ref/types.ts'
import type { GmObject } from '../../../../shared/gm/schema.ts'
import { h, t } from '../../../host.ts'
import { MemberPane, type MemberTab } from '../../../obj-kit/MemberPane.tsx'
import type { VarSel } from '../../../obj-kit/VarList.tsx'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { GrabValue } from '../gt-ref/GrabValue.tsx'
import { ObjInput, resolveObj, useRefGroups } from '../gt-ref/ObjInput.tsx'
import { itemsOf } from '../gt-ref/pick/data.ts'
import { ValueTree } from '../value/ValueTree.tsx'
import { patch, Row, TextField } from './parts.tsx'

/** 存着的值 → 输入框文字：字符串原样，其余写 JSON */
const toText = (v: unknown) => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v))

/** 输入框文字 → 存进步骤的值：数字、布尔、像 JSON 的按 JSON；$变量、= 表达式和其余文字原样（UE 写法交给反射） */
function fromText(type: string | undefined, s: string): unknown {
  const v = s.trim()
  if (v.startsWith('$') || v.startsWith('=')) return s
  if (/^(bool|boolean)$/i.test(type ?? '') || v === 'true' || v === 'false')
    return v === 'true' ? true : v === 'false' ? false : s
  if (/int|float|double|number|byte/i.test(type ?? '') && v !== '' && !isNaN(Number(v))) return Number(v)
  if (/^[[{]/.test(v)) {
    try {
      return JSON.parse(v)
    } catch {
      // 不是 JSON：按 UE 写法原样交给反射
    }
  }
  return s
}

/**
 * 设属性检查器（分析文档 G3、U2、效果图 2）：对象块 + 成员面板（属性 · Lua · 运行状态，和 GM 对象调用中栏同一个）
 * + 改值（此刻的值、类型、按类型输入、抓取值）。值写进步骤，跑到这一步才设；GM 页那边是点「修改」马上写进游戏
 */
export function SetInspector({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui } = h()
  const ctx = useEditCtx()
  const obj = step.obj as GtRefLike | undefined
  const { ref } = resolveObj(ctx, obj)
  const { data } = useRefGroups(obj)
  const prop = typeof step.prop === 'string' ? step.prop : ''
  const item = itemsOf(data?.groups).find((i) => i.prop === prop)
  // 成员面板里点的那一项：属性树里没有的（Lua 字段只在源码里声明）类型和成员从它来
  const [sel, setSel] = useState<VarSel>()
  const cur = sel?.prop === prop ? sel : undefined
  const type = item?.type ?? cur?.type
  const members = item?.members ?? cur?.enum
  const readOnly = item?.readOnly || cur?.readOnly
  const [open, setOpen] = useState(!prop)
  const [tab, setTab] = useState<MemberTab>('props')
  const now = item?.value ?? cur?.value
  const text = toText(step.value)
  const bool = /^(bool|boolean)$/i.test(type ?? '')

  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      <Row label={t('对象')}>
        <ObjInput value={obj} onChange={(o) => onChange(patch(step, 'obj', o))} />
      </Row>
      <Row label={t('属性')}>
        <div className="ue:flex ue:flex-col ue:gap-1.5">
          {prop && (item || cur) ? (
            <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-2 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card ue:px-2.5 ue:py-1.5">
              <Pencil className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-accent" />
              <span className="ue:font-mono ue:text-footnote ue:font-medium ue:text-fg">{item?.name ?? cur?.name}</span>
              <span className="ue:font-mono ue:text-caption ue:text-subtle">{type}</span>
              <span className="ue:ml-auto ue:truncate ue:font-mono ue:text-caption ue:text-subtle">{prop}</span>
            </div>
          ) : (
            <TextField step={step} k="prop" mono onChange={onChange} placeholder="@.Visibility" />
          )}
          {ref && (
            <ui.Button
              size="sm"
              variant="secondary"
              className="ue:w-fit"
              aria-pressed={open}
              onClick={() => setOpen(!open)}
            >
              <ListTree className="ue:h-3.5 ue:w-3.5" />
              {open ? t('收起成员') : prop ? t('换属性…') : t('选属性…')}
            </ui.Button>
          )}
          {ref && open && (
            <div className="ue:flex ue:h-80 ue:min-h-0 ue:flex-col ue:overflow-hidden ue:rounded-(--c-row-radius) ue:border ue:border-line">
              <MemberPane
                project={ctx.project}
                obj={{ name: 'obj', ref } as GmObject}
                live={ctx.live}
                tab={tab}
                onTab={setTab}
                tabs={['props', 'lua', 'states']}
                onFn={() => undefined}
                varSel={prop}
                onVar={(v) => {
                  setSel(v)
                  onChange({
                    ...step,
                    prop: v.prop,
                    ...(v.value !== undefined && step.value === undefined ? { value: v.value } : {}),
                  })
                  setOpen(false)
                }}
              />
            </div>
          )}
        </div>
      </Row>
      {now !== undefined && (
        <Row label={t('此刻的值')}>
          <div className="ue:max-h-40 ue:overflow-auto ue:rounded-md ue:bg-hover ue:px-1 ue:py-1">
            <ValueTree value={now} type={type} collapsed />
          </div>
        </Row>
      )}
      <Row label={t('设成')}>
        <div className="ue:flex ue:flex-col ue:gap-1">
          <div className="ue:flex ue:items-center ue:gap-1">
            {members?.length || bool ? (
              <ui.Select
                size="sm"
                className="ue:min-w-0 ue:flex-1"
                value={text}
                onChange={(e: { target: { value: string } }) =>
                  onChange(patch(step, 'value', fromText(type, e.target.value)))
                }
                options={[
                  { value: '', label: t('选一个') },
                  ...(bool ? ['true', 'false'] : members!).map((x) => ({ value: x, label: x })),
                ]}
              />
            ) : (
              <ui.Input
                size="sm"
                spellCheck={false}
                className="ue:min-w-0 ue:flex-1 ue:font-mono"
                placeholder={type ? t('{t}，或 $变量、= 表达式', { t: type }) : t('值，或 $变量、= 表达式')}
                value={text}
                onChange={(e: { target: { value: string } }) =>
                  onChange(patch(step, 'value', fromText(type, e.target.value)))
                }
              />
            )}
            <GrabValue type={type} onValue={(v) => onChange(patch(step, 'value', v))} />
          </div>
          {readOnly ? (
            <span className="ue:text-caption ue:text-danger">{cur?.why || t('这个变量只读，跑到这一步会失败')}</span>
          ) : (
            <span className="ue:text-caption ue:text-subtle">
              {t(
                '控件状态（Visibility、IsChecked、Text…）走控件自己的 Set 函数，委托照常触发；结构体照 UE 写法 (X=1,Y=2)',
              )}
            </span>
          )}
        </div>
      </Row>
    </div>
  )
}
