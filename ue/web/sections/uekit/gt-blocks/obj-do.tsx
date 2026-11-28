import { Boxes, FunctionSquare, PenLine, Plus, Tag, X } from 'lucide-react'
import { useMemo, type MouseEvent } from 'react'
import { blockOf, type GtStep } from '../../../../shared/gt-script/index.ts'
import type { ObjDoOp } from '../../../../shared/gt-script/objdo/expand.ts'
import type { GtRefLike } from '../../../../shared/gt-script/ref/types.ts'
import { openMenuAt, type MenuItem } from '@panel/web/src/components/ui/item-menu'
import { h, t } from '../../../host.ts'
import { SigCard } from '../../../obj-kit/CallForm.tsx'
import { fnsOf, type FnInfo } from '../../../obj-kit/members.ts'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { describeRef, isRefObj } from '../gt-ref/describe.ts'
import { ObjInput, useRefGroups } from '../gt-ref/ObjInput.tsx'
import { PartInput, partsOf } from '../gt-ref/PartInput.tsx'
import { useVars, type VarItem } from '../gt-vars/model.ts'
import { ParamForm } from './call-inspector.tsx'
import { scopeOfInvoke } from './invoke-pick.tsx'
import { patch, Row } from './parts.tsx'
import { blockUi, registerBlockUi } from './registry.ts'

const SRC: Record<string, () => string> = { cpp: () => 'C++', bp: () => t('蓝图'), lua: () => 'Lua' }

const opsOf = (s: GtStep): ObjDoOp[] => (Array.isArray(s.ops) ? (s.ops as ObjDoOp[]) : [])

/** 这个对象上能调的函数和字段：和「调函数」的换函数同一份 gt.vars（游戏没开时只有扫得到的） */
function useMembers(step: GtStep) {
  const ctx = useEditCtx()
  const scope = scopeOfInvoke({ action: 'obj.call', obj: step.obj }, ctx.doc)
  const ok = !('why' in scope)
  const vars = useVars(ctx.project, ok ? scope : undefined, ctx.live)
  const groups = useMemo(() => vars.data?.groups ?? [], [vars.data])
  const fns = useMemo(() => fnsOf(groups), [groups])
  const props = useMemo(
    () =>
      groups.flatMap((g) =>
        g.items.filter((it) => it.kind === 'prop').map((it) => ({ ...it, src: g.src, owner: g.class ?? g.title })),
      ),
    [groups],
  )
  return { fns, props, loading: vars.loading, why: ok ? undefined : scope.why }
}

type Prop = VarItem & { src: string; owner: string }

/** 「+ 添加」：下拉里按函数、字段（读 / 改）分组，带搜索；对象还没定时只能手写 */
function addMenu(
  el: HTMLElement,
  m: { fns: FnInfo[]; props: Prop[]; why?: string },
  add: (op: ObjDoOp, fn?: FnInfo) => void,
) {
  const items: MenuItem[] = []
  const fns = m.fns.filter((f) => f.callable)
  if (fns.length) items.push({ title: t('调函数') })
  for (const f of fns)
    items.push({
      label: f.name,
      icon: FunctionSquare,
      hint: `${SRC[f.src]?.() ?? ''} ${f.owner}`.trim(),
      onClick: () =>
        add({ kind: 'call', function: f.name, args: Object.fromEntries(f.params.map((p) => [p.name, ''])) }, f),
    })
  if (m.props.length) items.push({ title: t('读字段（存进变量）') })
  for (const p of m.props)
    items.push({
      label: p.name,
      icon: Tag,
      hint: p.type ?? '',
      onClick: () => add({ kind: 'get', prop: p.path, saveAs: p.name.replace(/\W/g, '') || 'value' }),
    })
  const writable = m.props.filter((p) => !p.readOnly)
  if (writable.length) items.push({ title: t('改字段') })
  for (const p of writable)
    items.push({
      label: p.name,
      icon: PenLine,
      hint: p.type ?? '',
      onClick: () => add({ kind: 'set', prop: p.path, value: '' }),
    })
  if (!fns.length && !m.props.length) {
    if (m.why) items.push({ title: m.why })
    items.push({ title: t('手写') })
  }
  items.push(
    {
      label: t('调函数（手写函数名）'),
      icon: FunctionSquare,
      onClick: () => add({ kind: 'call', function: '', args: {} }),
    },
    { label: t('读字段（手写路径）'), icon: Tag, onClick: () => add({ kind: 'get', prop: '', saveAs: '' }) },
    { label: t('改字段（手写路径）'), icon: PenLine, onClick: () => add({ kind: 'set', prop: '', value: '' }) },
  )
  openMenuAt(el, items, { search: t('搜函数、字段…') })
}

/** 值输入：常量、$变量、= 表达式都按原样存；像数字、true / false 的转成对应类型 */
function ValueInput({
  value,
  onChange,
  placeholder,
}: {
  value: unknown
  onChange: (v: unknown) => void
  placeholder?: string
}) {
  const { ui } = h()
  const text = value === undefined || value === '' ? '' : typeof value === 'string' ? value : JSON.stringify(value)
  return (
    <ui.Input
      size="sm"
      spellCheck={false}
      className="ue:w-full ue:font-mono"
      placeholder={placeholder ?? t('值，或 $变量、= 表达式')}
      value={text}
      onChange={(e: { target: { value: string } }) => {
        const v = e.target.value
        onChange(/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v)
      }}
    />
  )
}

function NameInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  const { ui } = h()
  return (
    <ui.Input
      size="sm"
      spellCheck={false}
      className="ue:w-full ue:font-mono"
      placeholder={placeholder}
      value={value}
      onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
    />
  )
}

const OP_ICON = { call: FunctionSquare, get: Tag, set: PenLine }
const OP_LABEL = { call: () => t('调函数'), get: () => t('读字段'), set: () => t('改字段') }

/** 一项：函数签名 + 参数（常量 / 变量 / 对象）+ 返回值存到；字段读写 */
function OpCard({
  op,
  index,
  fns,
  onChange,
  onRemove,
}: {
  op: ObjDoOp
  index: number
  fns: FnInfo[]
  onChange: (op: ObjDoOp) => void
  onRemove: () => void
}) {
  const { ui } = h()
  const Icon = OP_ICON[op.kind]
  const fn = op.kind === 'call' ? fns.find((f) => f.name === op.function) : undefined
  const name = op.kind === 'call' ? op.function : op.prop
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card ue:px-2.5 ue:py-2">
      <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
        <span className="ue:w-4 ue:shrink-0 ue:text-caption ue:text-subtle">{index + 1}</span>
        <Icon className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-run" />
        <span className="ue:shrink-0 ue:text-caption ue:text-muted">{OP_LABEL[op.kind]()}</span>
        <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-footnote ue:font-medium ue:text-fg">
          {name || t('（还没填）')}
        </span>
        <ui.IconButton size="sm" className="ue:ml-auto ue:shrink-0" label={t('删掉这一项')} onClick={onRemove}>
          <X className="ue:h-3.5 ue:w-3.5" />
        </ui.IconButton>
      </div>
      {op.kind === 'call' && (
        <>
          {fn ? (
            <SigCard sig={{ name: fn.name, sig: fn.sig, src: SRC[fn.src]?.() }} />
          ) : (
            <Row label={t('函数')}>
              <NameInput value={op.function} onChange={(v) => onChange({ ...op, function: v })} placeholder="AddItem" />
            </Row>
          )}
          <Row label={t('参数')}>
            <ParamForm
              params={fn?.params ?? Object.keys(op.args ?? {}).map((n) => ({ name: n, type: '' }))}
              values={op.args ?? {}}
              onChange={(k, v) => onChange({ ...op, args: { ...op.args, [k]: v } })}
              onReset={() =>
                fn &&
                onChange({ ...op, args: Object.fromEntries(fn.params.map((p) => [p.name, op.args?.[p.name] ?? ''])) })
              }
            />
          </Row>
          <Row label={t('返回值存到')}>
            <NameInput
              value={op.saveAs ?? ''}
              onChange={(v) => onChange({ ...op, saveAs: v || undefined })}
              placeholder={t('变量名（可不填）')}
            />
          </Row>
        </>
      )}
      {op.kind === 'get' && (
        <>
          <Row label={t('字段')}>
            <NameInput value={op.prop} onChange={(v) => onChange({ ...op, prop: v })} placeholder="@.Count" />
          </Row>
          <Row label={t('存到变量')}>
            <NameInput value={op.saveAs} onChange={(v) => onChange({ ...op, saveAs: v })} placeholder="count" />
          </Row>
        </>
      )}
      {op.kind === 'set' && (
        <>
          <Row label={t('字段')}>
            <NameInput value={op.prop} onChange={(v) => onChange({ ...op, prop: v })} placeholder="@.Count" />
          </Row>
          <Row label={t('改成')}>
            <ValueInput value={op.value} onChange={(v) => onChange({ ...op, value: v })} />
          </Row>
        </>
      )}
    </div>
  )
}

/**
 * 对象调用检查器（用户 2026-11-28）：选一个对象（脚本里的、对象库里的、前面找到的变量），点「+ 添加」下拉选函数或字段，
 * 每一项填参数（常量、$变量，对象参数从对象库 / 脚本对象里选）、返回值存变量。跑的是 ops 展开出的 run（存盘时生成）
 */
function ObjDoInspector({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui } = h()
  const obj = step.obj as GtRefLike | undefined
  const { groups } = useRefGroups(obj)
  const m = useMembers(step)
  const ops = opsOf(step)
  const setOps = (next: ObjDoOp[]) => onChange({ ...step, ops: next })
  const add = (e: MouseEvent<HTMLElement>) => addMenu(e.currentTarget, m, (op) => setOps([...ops, op]))
  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      <Row label={t('对象')} hint={t('脚本里的对象、对象库里的对象，或前面「找对象」存的变量')}>
        <ObjInput value={obj} onChange={(o) => onChange(patch(step, 'obj', o))} />
      </Row>
      {isRefObj(obj) || (typeof obj === 'string' && obj && !obj.startsWith('$') && !obj.startsWith('@')) ? (
        <Row label={t('部件')}>
          <PartInput
            value={typeof step.part === 'string' ? step.part : ''}
            onChange={(v) => onChange(patch(step, 'part', v))}
            parts={partsOf(groups)}
          />
        </Row>
      ) : null}
      <Row label={t('命中多个时')}>
        <ui.Segmented
          size="sm"
          label={t('命中多个时')}
          value={step.each === true ? 'each' : 'one'}
          onChange={(v: string) => onChange(patch(step, 'each', v === 'each' ? true : undefined))}
          options={[
            { id: 'one', label: t('按对象的设置') },
            { id: 'each', label: t('每个都调') },
          ]}
        />
      </Row>
      <div className="ue:flex ue:flex-col ue:gap-1.5">
        {ops.map((op, i) => (
          <OpCard
            key={i}
            op={op}
            index={i}
            fns={m.fns}
            onChange={(o) => setOps(ops.map((x, j) => (j === i ? o : x)))}
            onRemove={() => setOps(ops.filter((_, j) => j !== i))}
          />
        ))}
        {!ops.length && (
          <p className="ue:text-footnote ue:text-subtle">{t('还没加要调的函数或字段：选好对象后点下面的「+ 添加」')}</p>
        )}
        <div className="ue:flex ue:items-center ue:gap-1.5">
          <ui.Button size="sm" variant="secondary" onClick={add}>
            <Plus className="ue:h-3.5 ue:w-3.5" />
            {t('添加')}
          </ui.Button>
          {m.loading && <span className="ue:text-caption ue:text-subtle">{t('读取中…')}</span>}
          {!m.loading && m.why && <span className="ue:text-caption ue:text-subtle">{m.why}</span>}
        </div>
      </div>
      <RunPreview step={step} />
    </div>
  )
}

/** 存盘时按 ops 生成的步骤（只看，不用改），和「执行 GM」的「会执行」一样 */
function RunPreview({ step }: { step: GtStep }) {
  const run = Array.isArray(step.run) ? (step.run as GtStep[]) : []
  if (!run.length) return null
  return (
    <div className="ue:flex ue:flex-col ue:gap-1">
      <span className="ue:text-footnote ue:text-subtle">{t('会执行（存盘时生成，不用手改）')}</span>
      <ol className="ue:flex ue:flex-col ue:gap-0.5 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card ue:px-2.5 ue:py-1.5">
        {run.map((s, i) => {
          const ui = blockUi(String(s.action ?? ''))
          return (
            <li key={i} className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:text-caption">
              <ui.icon className="ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle" />
              <span className="ue:shrink-0 ue:text-muted">{ui.title()}</span>
              <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-fg">{ui.summary(s)}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

const objName = (s: GtStep) => {
  const o = s.obj
  if (typeof o === 'string') return o
  if (isRefObj(o)) return describeRef(o)
  return t('（没选对象）')
}

registerBlockUi(
  {
    action: 'obj.do',
    title: () => t('对象调用'),
    icon: Boxes,
    tone: 'run',
    summary: (s) => {
      const ops = opsOf(s)
      const names = ops.map((o) => (o.kind === 'call' ? `${o.function}()` : o.kind === 'set' ? `${o.prop}=` : o.prop))
      return `${objName(s)} · ${names.join(', ') || t('还没加函数')}`
    },
    Inspector: ObjDoInspector,
  },
  [
    {
      id: 'obj.do',
      group: () => t('调用'),
      label: () => t('对象调用'),
      hint: () => t('选一个对象，加上要调的函数、要读写的字段；参数能用变量和对象库里的对象'),
      slash: 'objdo',
      action: 'obj.do',
      make: () => blockOf('obj.do')!.make(),
    },
  ],
)
