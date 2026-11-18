import { useMemo, useRef, useState } from 'react'
import { getAt, type GtStep } from '../../../../shared/gt-script/index.ts'
import { openMenu } from '../../../menu.tsx'
import { commandMenuItems, runKey, type CmdCtx } from '../gt-edit/commands.ts'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { insertMenuItems, insertPlace, insertStep, openInsertAt } from '../gt-edit/insert-menu.ts'
import type { ViewProps } from '../gt-edit/views.ts'
import { GtFlowView, type FlowSelection } from './GtFlowView.tsx'
import { stepKey } from './layout.ts'
import type { FlowRunState, StepRunStatus } from './run-state.ts'
import { useFlowRun } from './use-flow-run.ts'

/** 外壳给的简版运行状态（按步骤 id 标 ok / fail / run / skip）→ 流程图的运行态 */
const RUN_STATUS: Record<string, StepRunStatus> = { ok: 'passed', fail: 'failed', run: 'running', skip: 'skipped' }
function fromViewRun(r: NonNullable<ViewProps['run']>, live: FlowRunState): FlowRunState {
  const steps = { ...live.steps }
  for (const [id, st] of Object.entries(r.status ?? {})) steps[id] = { ...steps[id], status: RUN_STATUS[st] }
  return { ...live, active: live.active || !!r.at, at: r.at ?? live.at, steps }
}

/**
 * 编辑页的「流程图」视图（定稿 9.1「一份数据，三种看法」）：把外壳的 ViewProps 接到 GtFlowView。
 * - 选中：外壳按路径记、可多选；画布按 key（步骤 id 或路径）单选，这里两头换。守护不在外壳的选中里
 *   （守护在「脚本设置」里编辑），选守护时外壳清空选中、显示脚本设置，画布自己记着高亮哪条；
 * - 插入、右键、快捷键都用外壳那一份（insert-menu、commands），和列表视图同一套命令；
 * - 运行高亮：外壳给了 run 就叠上去，否则只看 gt.flow / gt.job 推送
 */
export function FlowEditView({ doc, onChange, selected, onSelect, onTry, run }: ViewProps) {
  const { project } = useEditCtx()
  const live = useFlowRun(project, doc.name)
  const box = useRef<HTMLDivElement>(null)
  // 最近一次指针的位置：点「+」时菜单从这里弹出（画布的插入回调不带事件）
  const pointer = useRef({ x: 200, y: 200 })
  const [guardKey, setGuardKey] = useState<string>()

  const key = useMemo(() => {
    const p = selected[0]
    const step = p && (getAt(doc, p) as GtStep | undefined)
    return step && typeof step === 'object' ? stepKey(step, p) : guardKey
  }, [doc, selected, guardKey])

  const ctx: CmdCtx = {
    doc,
    selected,
    apply: onChange,
    select: onSelect,
    onTry,
    openInsert: () =>
      openInsertAt(box.current?.querySelector(`[data-gt-node="${key}"]`) ?? box.current, (it) => {
        const { slot, index } = insertPlace(doc, selected[0])
        onChange(insertStep(doc, slot, index, it.make()))
      }),
  }

  const select = (s: FlowSelection | undefined) => {
    setGuardKey(s?.guard ? s.key : undefined)
    onSelect(s?.path && !s.guard ? [s.path] : [])
  }

  return (
    <div
      ref={box}
      tabIndex={-1}
      className="ue:min-h-0 ue:flex-1 ue:outline-none"
      onPointerDownCapture={(e) => (pointer.current = { x: e.clientX, y: e.clientY })}
      onKeyDown={(e) => {
        // 输入框里的按键交给输入框（画布上没有，防的是将来节点上加了内联编辑）
        if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return
        runKey(e, ctx)
      }}
    >
      <GtFlowView
        doc={doc}
        onChange={(d, focus) => {
          if (onChange(d) && focus) onSelect([focus])
        }}
        selected={key}
        onSelect={select}
        run={run ? fromViewRun(run, live) : live}
        onPickInsert={(at) => {
          const e = new MouseEvent('contextmenu', { clientX: pointer.current.x, clientY: pointer.current.y })
          openMenu(
            e,
            insertMenuItems((it) => onChange(insertStep(doc, at.slot, at.index, it.make()))),
          )
        }}
        onNodeMenu={(s, e) => {
          if (s.guard || !s.path) return
          box.current?.focus()
          openMenu(e, commandMenuItems({ ...ctx, selected: [s.path] }))
        }}
      />
    </div>
  )
}
