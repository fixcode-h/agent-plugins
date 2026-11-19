import { Plus, Redo2, Undo2 } from 'lucide-react'
import { useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  getAt,
  pathStr,
  slotsOf,
  type EditResult,
  type GtScript,
  type GtStep,
} from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { openMenu } from '../../../menu.tsx'
import { commandMenuItems, runKey, type CmdCtx } from '../gt-edit/commands.ts'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { insertMenuItems, insertPlace, insertStep, openInsertAt } from '../gt-edit/insert-menu.ts'
import type { InsertItem } from '../gt-blocks/index.ts'
import { blankGuard } from '../gt-guards/model.ts'
import type { ViewProps } from '../gt-edit/views.ts'
import { CanvasToolbarSep } from '@panel/web/src/components/flow/GraphCanvas'
import { BpView, type BpSelection } from './bp/BpView.tsx'
import { tidyLoose } from './bp/edit.ts'
import { bpKey } from './bp/graph.ts'
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
 * 编辑页的「流程图」视图（定稿 9.1「一份数据，三种看法」）：把外壳的 ViewProps 接到蓝图式画布 BpView。
 * - 选中：外壳按路径记、可多选；画布按 key（步骤 id 或路径）单选，这里两头换。守护不在外壳的选中里
 *   （守护在「脚本设置」里编辑），选守护时外壳清空选中、显示脚本设置，画布自己记着高亮哪条；
 * - 插入、右键、快捷键都用外壳那一份（insert-menu、commands），和列表视图同一套命令；
 * - 运行高亮：外壳给了 run 就叠上去，否则只看 gt.flow / gt.job 推送
 * - 底部工具条（效果图 1）：画布自带选择 / 平移 / 适配 / 折叠，这里补「+ 插入」和外壳给的撤销、重做
 */
export function FlowEditView({
  doc,
  onChange: change,
  selected,
  onSelect,
  onTry,
  run,
  history,
  scope,
  onEnter,
  onLeave,
}: ViewProps) {
  // 画布上可能有没连上的步骤（_layout.loose）：插入、复制这些通用命令只给流程里的步骤补 id，这里统一补上、去掉空串
  const onChange: ViewProps['onChange'] = (r, what) => {
    if (!r) return change(r, what)
    if ('doc' in r && Array.isArray((r as EditResult).path))
      return change({ ...(r as EditResult), doc: tidyLoose(structuredClone((r as EditResult).doc)) }, what)
    return change(tidyLoose(structuredClone(r as GtScript)), what)
  }
  const { IconButton } = h().ui
  const { project } = useEditCtx()
  const live = useFlowRun(project, doc.name)
  const box = useRef<HTMLDivElement>(null)
  const [guardKey, setGuardKey] = useState<string>()

  const key = useMemo(() => {
    const p = selected[0]
    const step = p && (getAt(doc, p) as GtStep | undefined)
    return step && typeof step === 'object' ? bpKey(step, p) : guardKey
  }, [doc, selected, guardKey])

  // 插在选中那步后面；没选就接在主流程末尾（insertPlace 的规则），快捷键和工具条的「+」同一份
  const pickInsert = (it: InsertItem) => {
    // 进到块里面、没选中时：接在这一层第一个槽的末尾
    const inner = !selected[0] && scope ? slotsOf(getAt(doc, scope) as GtStep)[0] : undefined
    const innerSlot = inner && scope ? [...scope, ...inner.key] : undefined
    const { slot, index } = innerSlot
      ? { slot: innerSlot, index: ((getAt(doc, innerSlot) as unknown[] | undefined) ?? []).length }
      : insertPlace(doc, selected[0])
    onChange(insertStep(doc, slot, index, it.make()))
  }
  const ctx: CmdCtx = {
    doc,
    selected,
    apply: onChange,
    select: onSelect,
    onTry,
    openInsert: () => openInsertAt(box.current?.querySelector(`[data-gt-node="${key}"]`) ?? box.current, pickInsert),
  }

  // 选中了好几步（框选、Ctrl+A、列表里多选）：都画选中框
  const picked = useMemo(
    () =>
      selected.length > 1
        ? selected.flatMap((p) => {
            const st = getAt(doc, p) as GtStep | undefined
            return st && typeof st === 'object' ? [bpKey(st, p)] : []
          })
        : undefined,
    [doc, selected],
  )
  const selectMany = (list: BpSelection[]) => {
    const paths = list.flatMap((s) => (s.path && !s.guard ? [s.path] : []))
    // 画布每次把同样的选中报上来时不重复设（免得来回触发）
    if (paths.length === selected.length && paths.every((p, i) => pathStr(p) === pathStr(selected[i]))) return
    setGuardKey(undefined)
    onSelect(paths)
  }
  const select = (s: BpSelection | undefined) => {
    setGuardKey(s?.guard ? s.key : undefined)
    onSelect(s?.path && !s.guard ? [s.path] : [])
  }

  return (
    <div
      ref={box}
      tabIndex={-1}
      className="ue:min-h-0 ue:flex-1 ue:outline-none"
      onKeyDown={(e) => {
        // 输入框里的按键交给输入框（画布上没有，防的是将来节点上加了内联编辑）
        if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return
        runKey(e, ctx)
      }}
    >
      <BpView
        doc={doc}
        onChange={(d, focus) => {
          if (onChange(d) && focus) onSelect([focus])
        }}
        selected={key}
        onSelect={select}
        scope={scope}
        onEnter={onEnter}
        onLeave={onLeave}
        picked={picked}
        onSelectMany={selectMany}
        run={run ? fromViewRun(run, live) : live}
        // 空白处右键「加守护」：加一条空守护，事件节点出现在画布上，触发条件到右栏「这个脚本的守护」里填
        onAddGuard={() => {
          const guards = doc.guards ?? []
          const g = blankGuard(new Set(guards.map((x) => x.id ?? '')))
          if (onChange({ ...doc, guards: [...guards, g] }))
            h().toast.success(
              t('加了守护「{id}」：从它的引脚拖出处理步骤，触发条件在右边「这个脚本的守护」里填', { id: g.id ?? '' }),
            )
        }}
        toolbar={
          <>
            {/* 菜单从按钮处弹出（点的是工具条，不跳到节点那里） */}
            <IconButton
              icon={Plus}
              size="sm"
              label={t('插入一步')}
              onClick={(e: MouseEvent) => openMenu(e, insertMenuItems(pickInsert))}
            />
            {history && (
              <>
                <CanvasToolbarSep />
                <IconButton
                  icon={Undo2}
                  size="sm"
                  label={t('撤销')}
                  disabled={!history.canUndo}
                  onClick={history.undo}
                />
                <IconButton
                  icon={Redo2}
                  size="sm"
                  label={t('重做')}
                  disabled={!history.canRedo}
                  onClick={history.redo}
                />
              </>
            )}
          </>
        }
        onNodeMenu={(s, e) => {
          if (s.guard || !s.path) return
          box.current?.focus()
          openMenu(e, commandMenuItems({ ...ctx, selected: [s.path] }))
        }}
      />
    </div>
  )
}
