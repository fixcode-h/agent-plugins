import { PanelTopClose, Search, SquareFunction, Timer, Wrench } from 'lucide-react'
import { blockOf, type CondNode, type GtStep } from '../../../../shared/gt-script/index.ts'
import type { GtCloseHow, GtCloseVerify, GtRefLike } from '../../../../shared/gt-script/ref/types.ts'
import { h, t } from '../../../host.ts'
import { ArgsEdit } from '../gt-api/ApiPick.tsx'
import { CondEditor } from '../gt-cond/CondEditor.tsx'
import { propCheck } from '../gt-cond/checks/prop.tsx'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { CloseHowList, closeHowText, CloseVerify } from '../gt-ref/CloseHowList.tsx'
import { classOfRef, describeRef, identText, inlineRef, isRefObj } from '../gt-ref/describe.ts'
import { useRefHit } from '../gt-ref/live.ts'
import { ObjInput, useRefGroups } from '../gt-ref/ObjInput.tsx'
import { PartInput, partsOf } from '../gt-ref/PartInput.tsx'
import { RefCard } from '../gt-ref/RefCard.tsx'
import { patchRunConfig, upsertCloseRule } from '../gt-ref/rules-io.ts'
import { InvokeFnPick } from './invoke-pick.tsx'
import { LeafInspector } from './leaf.tsx'
import { patch, Row, TextField } from './parts.tsx'
import { registerBlockUi } from './registry.ts'

/**
 * 对象动作（协议 game-test-ref 5.2、5.3）：关闭 obj.close、调函数 obj.call、等对象 obj.wait，
 * 以及只用字段表的找对象 obj.find、设属性 obj.set（字段在 fields/actions.ts）。
 * 取代 v3 的 widget.close / widget.call / invoke / find（GameTest 2.0 不认，旧格式不迁移）
 */

const objText = (v: unknown) => (typeof v === 'string' ? v : describeRef(v as GtRefLike))

/** 关哪个对象：选对象 + 对象卡（命中几个实时更新）；内联的对象能直接改「命中多个时」 */
function ObjSection({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const ctx = useEditCtx()
  const objects = (ctx.doc?.objects ?? {}) as Record<string, unknown>
  const obj = step.obj as GtRefLike | undefined
  const { hit, error } = useRefHit(ctx.project, ctx.live, obj, objects)
  const full = obj ? inlineRef(obj, objects) : undefined
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5">
      <ObjInput value={obj} onChange={(o) => onChange(patch(step, 'obj', o))} />
      {obj && (
        <RefCard
          name={typeof obj === 'string' ? obj : undefined}
          value={full}
          hit={hit}
          hitError={error}
          onMany={
            isRefObj(obj)
              ? (m) => onChange({ ...step, obj: { ...obj, many: m === 'error' ? undefined : m } })
              : undefined
          }
        />
      )}
    </div>
  )
}

function CloseInspector({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui } = h()
  const ctx = useEditCtx()
  const obj = step.obj as GtRefLike | undefined
  const { groups } = useRefGroups(obj)
  const how = (Array.isArray(step.how) ? step.how : []) as GtCloseHow[]
  const cls = classOfRef(obj, ctx.doc?.objects)
  const remember = async () => {
    try {
      await patchRunConfig(ctx.project, (c) => {
        c.closeRules = upsertCloseRule(c.closeRules, {
          class: cls,
          how,
          ...(step.verify ? { verify: step.verify as GtCloseVerify } : {}),
        })
      })
      h().toast.success(t('已记住：以后关 {c} 没写方式时这样关', { c: cls }))
    } catch (e) {
      h().toast.error((e as Error).message)
    }
  }
  return (
    <div className="ue:flex ue:flex-col ue:gap-3">
      <div className="ue:flex ue:flex-col ue:gap-1.5">
        <span className="ue:text-caption ue:text-subtle">{t('关哪个对象')}</span>
        <ObjSection step={step} onChange={onChange} />
      </div>
      <div className="ue:flex ue:flex-col ue:gap-1.5">
        <span className="ue:text-caption ue:text-subtle">{t('关闭方式 · 从上往下试，做完核对没过就试下一种')}</span>
        <CloseHowList
          value={how}
          onChange={(v) => onChange(patch(step, 'how', v.length ? v : undefined))}
          parts={partsOf(groups)}
        />
      </div>
      <div className="ue:flex ue:flex-col ue:gap-1.5">
        <span className="ue:text-caption ue:text-subtle">{t('关完核对')}</span>
        <CloseVerify
          verify={step.verify as GtCloseVerify | undefined}
          verifyMs={typeof step.verifyMs === 'number' ? step.verifyMs : undefined}
          onChange={(v) => onChange(patch(patch(step, 'verify', v.verify), 'verifyMs', v.verifyMs))}
        />
      </div>
      {cls && how.length > 0 && (
        <ui.Button size="sm" variant="ghost" className="ue:w-fit" onClick={() => void remember()}>
          {t('{c} 以后都这样关', { c: cls })}
          <span className="ue:text-caption ue:text-subtle">{t('写进设置「对象与标识 → 关闭方式」')}</span>
        </ui.Button>
      )}
    </div>
  )
}

function CallInspector({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { groups } = useRefGroups(step.obj as GtRefLike | undefined)
  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      <Row label={t('对象')} hint={t('命名对象、$变量、@sub.UQuestSubsystem、@luaMod.路径；调静态函数时不填')}>
        <ObjInput value={step.obj as GtRefLike | undefined} onChange={(o) => onChange(patch(step, 'obj', o))} />
      </Row>
      {isRefObj(step.obj) || (typeof step.obj === 'string' && /^[A-Za-z_]/.test(step.obj)) ? (
        <Row label={t('部件')}>
          <PartInput
            value={typeof step.part === 'string' ? step.part : ''}
            onChange={(v) => onChange(patch(step, 'part', v))}
            parts={partsOf(groups)}
          />
        </Row>
      ) : null}
      <Row label={t('函数')}>
        <div className="ue:flex ue:items-center ue:gap-1.5">
          <div className="ue:min-w-0 ue:flex-1">
            <TextField step={step} k="function" mono onChange={onChange} placeholder="AcceptQuest" />
          </div>
          <InvokeFnPick step={step} onChange={onChange} />
        </div>
      </Row>
      <Row label={t('参数')}>
        <ArgsEdit
          value={(step.args as Record<string, unknown>) ?? {}}
          onChange={(a) => onChange({ ...step, args: a })}
        />
      </Row>
      <Row label={t('返回值存到')}>
        <TextField step={step} k="saveAs" mono onChange={onChange} placeholder={t('变量名（可不填）')} />
      </Row>
      <span className="ue:text-footnote ue:text-subtle">{t('返回值要满足（不写就不检查）')}</span>
      <CondEditor compact value={step.expect} onChange={(c) => onChange({ ...step, expect: c })} />
    </div>
  )
}

/** obj.wait 的字段就是一条「对象的属性」判断：直接用条件里那一种的编辑器 */
const WAIT_KEYS = ['obj', 'prop', 'op', 'value', 'tol', 'ignoreCase', 'cmp'] as const
function WaitInspector({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const check: CondNode = {}
  for (const k of WAIT_KEYS) if (step[k] !== undefined) check[k] = step[k]
  if (check.obj === undefined) check.obj = ''
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5">
      <span className="ue:text-footnote ue:text-subtle">
        {t('等到这个判断成立（不写属性 = 等对象出现）；最多等多久看下面的总时限')}
      </span>
      <propCheck.Editor
        value={check}
        onChange={(c) => {
          const out: GtStep = { ...step }
          for (const k of WAIT_KEYS) delete out[k]
          onChange({ ...out, ...c } as GtStep)
        }}
      />
    </div>
  )
}

const argsText = (s: GtStep) =>
  s.args && typeof s.args === 'object'
    ? Object.values(s.args)
        .map((v) => JSON.stringify(v))
        .join(', ')
    : ''

registerBlockUi(
  {
    action: 'obj.close',
    title: () => t('关闭'),
    icon: PanelTopClose,
    tone: 'danger',
    summary: (s) => {
      const how = closeHowText(s.how as GtCloseHow[] | undefined)
      return `${objText(s.obj)} · ${how || t('按类记住的关闭方式')}`
    },
    Inspector: CloseInspector,
  },
  [
    {
      id: 'obj.close',
      group: () => t('对象'),
      label: () => t('关闭'),
      hint: () => t('关掉界面或对象：调函数、点关闭按钮、CommonUI 弹出、移除…依次试，关完核对'),
      slash: 'close',
      action: 'obj.close',
      make: () => blockOf('obj.close')!.make(),
    },
  ],
)

registerBlockUi(
  {
    action: 'obj.call',
    title: () => t('调函数'),
    icon: SquareFunction,
    tone: 'warning',
    summary: (s) => {
      const obj = s.obj ? `${objText(s.obj)}${typeof s.part === 'string' ? ` › ${s.part}` : ''}.` : ''
      return `${obj}${String(s.function ?? '')}(${argsText(s)})${s.saveAs ? ` → $${String(s.saveAs)}` : ''}`
    },
    Inspector: CallInspector,
  },
  [
    {
      id: 'obj.call',
      group: () => t('调用'),
      label: () => t('调函数'),
      hint: () => t('C++、蓝图可调用、Exec、Lua 函数：准备状态、直接接任务'),
      slash: 'call',
      action: 'obj.call',
      make: () => blockOf('obj.call')!.make(),
    },
  ],
)

registerBlockUi(
  {
    action: 'obj.wait',
    title: () => t('等对象'),
    icon: Timer,
    tone: 'subtle',
    summary: (s) =>
      s.prop
        ? t('等到 {o} › {c}', { o: objText(s.obj), c: identText(s as unknown as { prop: string }) })
        : t('等 {o} 出现', { o: objText(s.obj) }),
    Inspector: WaitInspector,
  },
  [
    {
      id: 'obj.wait',
      group: () => t('等待 / 检查'),
      label: () => t('等对象'),
      hint: () => t('等界面出现、按钮能点、文字变成…（一条对象判断的简写）'),
      slash: 'owait',
      action: 'obj.wait',
      make: () => blockOf('obj.wait')!.make(),
    },
  ],
)

registerBlockUi(
  {
    action: 'obj.find',
    title: () => t('找对象'),
    icon: Search,
    tone: 'subtle',
    summary: (s) => `${objText(s.obj)}${s.saveAs ? ` → $${String(s.saveAs)}` : ''}`,
    Inspector: LeafInspector,
  },
  [
    {
      id: 'obj.find',
      group: () => t('对象'),
      label: () => t('找对象存进变量'),
      hint: () => t('找到后存进变量，后面的步骤写 $名字'),
      slash: 'find',
      action: 'obj.find',
      make: () => blockOf('obj.find')!.make(),
    },
  ],
)

registerBlockUi(
  {
    action: 'obj.set',
    title: () => t('设属性'),
    icon: Wrench,
    tone: 'warning',
    summary: (s) => `${objText(s.obj)} › ${String(s.prop ?? '')} = ${JSON.stringify(s.value ?? '')}`,
    Inspector: LeafInspector,
  },
  [
    {
      id: 'obj.set',
      group: () => t('对象'),
      label: () => t('设属性'),
      hint: () => t('勾上勾选框、设可见性、改字段（走控件自己的 Set 函数）'),
      slash: 'oset',
      action: 'obj.set',
      make: () => blockOf('obj.set')!.make(),
    },
  ],
)
