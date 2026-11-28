import type { GtStep } from '../../../../shared/gt-script/index.ts'
import type { GtRef, GtRefLike } from '../../../../shared/gt-script/ref/types.ts'
import { h, t } from '../../../host.ts'
import { argText, argValue, SigCard, type CallParam } from '../../../obj-kit/CallForm.tsx'
import { ArgsEdit } from '../gt-api/ApiPick.tsx'
import { CondEditor } from '../gt-cond/CondEditor.tsx'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { isRefObj } from '../gt-ref/describe.ts'
import { ObjInput, useRefGroups } from '../gt-ref/ObjInput.tsx'
import { PartInput, partsOf } from '../gt-ref/PartInput.tsx'
import { applyFn, InvokeFnPick, useInvokeFns } from './invoke-pick.tsx'
import { patch, Row, TextField } from './parts.tsx'

const SRC: Record<string, () => string> = { cpp: () => 'C++', bp: () => t('蓝图'), lua: () => 'Lua' }

type Many = 'error' | 'first' | 'each'

/**
 * 调函数检查器（分析文档 G1、U1、效果图 1）：对象块 + 函数签名卡 +「换函数…」+ 按类型的参数表单 + 命中多个时 + 返回值。
 * 卡片和 GM 对象调用同一套（SigCard、成员面板）；参数按函数定义一项一项列，对象参数用对象块（类按参数类型预填），
 * 不再是一个 JSON 文本框（B3：从列表选完函数后改参数会把选出来的参数名覆盖掉）
 */
export function CallInspector({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui } = h()
  const ctx = useEditCtx()
  const obj = step.obj as GtRefLike | undefined
  const { groups } = useRefGroups(obj)
  const { fn, loading } = useInvokeFns(step)
  const args = (step.args && typeof step.args === 'object' ? step.args : {}) as Record<string, unknown>
  const objects = (ctx.doc?.objects ?? {}) as Record<string, unknown>
  // 命中多个时：内联的改这一格，命名对象改脚本「对象」里那一条；$变量、来源对象只有一个，不出
  const named = typeof obj === 'string' && isRefObj(objects[obj.trim()]) ? obj.trim() : ''
  const ref = isRefObj(obj) ? obj : named ? (objects[named] as GtRef) : undefined
  const many: Many = step.each ? 'each' : ref?.many === 'first' ? 'first' : 'error'
  const setMany = (m: Many) => {
    const r = ref && { ...ref, many: m === 'first' ? ('first' as const) : undefined }
    let s = patch(step, 'each', m === 'each' ? true : undefined)
    if (r && isRefObj(obj)) s = { ...s, obj: r }
    else if (r && named && ctx.setObject) ctx.setObject(named, r)
    onChange(s)
  }
  const setArg = (name: string, v: unknown) => onChange({ ...step, args: { ...args, [name]: v } })

  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      <Row label={t('对象')} hint={t('脚本里的对象，或前面「找对象」存的变量；调静态函数时不填')}>
        <ObjInput value={obj} onChange={(o) => onChange(patch(step, 'obj', o))} />
      </Row>
      {ref && (
        <Row label={t('部件')}>
          <PartInput
            value={typeof step.part === 'string' ? step.part : ''}
            onChange={(v) => onChange(patch(step, 'part', v))}
            parts={partsOf(groups)}
          />
        </Row>
      )}
      {ref && (
        <Row label={t('命中多个时')} hint={named ? t('改的是脚本「对象」里那一条，用到它的步骤都跟着变') : undefined}>
          <ui.Segmented
            size="sm"
            label={t('命中多个时')}
            value={many}
            onChange={setMany}
            options={[
              { id: 'error' as const, label: t('报错') },
              { id: 'first' as const, label: t('只调第一个') },
              { id: 'each' as const, label: t('每个都调') },
            ]}
          />
        </Row>
      )}
      <Row label={t('函数')}>
        <div className="ue:flex ue:flex-col ue:gap-1.5">
          {fn ? (
            <SigCard sig={{ name: fn.name, sig: fn.sig, src: SRC[fn.src]?.() }} />
          ) : (
            <TextField step={step} k="function" mono onChange={onChange} placeholder="AcceptQuest" />
          )}
          <div className="ue:flex ue:items-center ue:gap-1.5">
            <InvokeFnPick step={step} onChange={onChange} />
            {fn && !fn.callable && (
              <span className="ue:text-caption ue:text-danger">{fn.why || t('这个函数调不了')}</span>
            )}
            {!fn && loading && <span className="ue:text-caption ue:text-subtle">{t('读取中…')}</span>}
          </div>
        </div>
      </Row>
      <Row label={t('参数')}>
        {fn ? (
          <ParamForm params={fn.params} values={args} onChange={setArg} onReset={() => onChange(applyFn(step, fn))} />
        ) : (
          <ArgsEdit value={args} onChange={(a) => onChange({ ...step, args: a })} />
        )}
      </Row>
      <Row label={t('返回值存到')}>
        <TextField step={step} k="saveAs" mono onChange={onChange} placeholder={t('变量名（可不填）')} />
      </Row>
      <span className="ue:text-footnote ue:text-subtle">{t('返回值要满足（不写就不检查）')}</span>
      <CondEditor compact value={step.expect} onChange={(c) => onChange({ ...step, expect: c })} />
    </div>
  )
}

/** 对象参数存的写法 ↔ 对象块的值：`{"$obj": 名}` ↔ 名字，`$变量` 原样 */
const objIn = (v: unknown): GtRefLike | undefined =>
  v && typeof v === 'object' && typeof (v as { $obj?: unknown }).$obj === 'string'
    ? (v as { $obj: string }).$obj
    : isRefObj(v) || (typeof v === 'string' && v)
      ? (v as GtRefLike)
      : undefined

/**
 * 按函数定义列参数（协议 game-test-script 4.4）：普通参数按类型转（数字、布尔、像 JSON 的按 JSON），
 * 对象参数只能是运行时找得回来的：脚本里的对象写 `{"$obj": 名}`、`$变量` 原样；新抓的对象先存进脚本「对象」再引用
 */
export function ParamForm({
  params,
  values,
  onChange,
  onReset,
}: {
  params: CallParam[]
  values: Record<string, unknown>
  onChange: (name: string, v: unknown) => void
  onReset: () => void
}) {
  const { ui } = h()
  const ctx = useEditCtx()
  const extra = Object.keys(values).filter((k) => !params.some((p) => p.name === k))
  if (!params.length && !extra.length)
    return <p className="ue:pt-1.5 ue:text-footnote ue:text-subtle">{t('没有参数')}</p>
  const objArg = (p: CallParam, v: GtRefLike | undefined) => {
    if (v === undefined) return onChange(p.name, '')
    if (typeof v === 'string') return onChange(p.name, v.startsWith('$') ? v : { $obj: v })
    // 选了对象库的一项（{$lib}）：改脚本时收成名字，这里先包成 {$obj: …}
    if (!isRefObj(v)) return onChange(p.name, { $obj: v })
    // 内联引用不能直接当参数：起个名字存进脚本「对象」，参数写它
    const objects = (ctx.doc?.objects ?? {}) as Record<string, unknown>
    const base = (v.class.split('.').pop() ?? 'obj').replace(/^lua:/, '').replace(/\W/g, '') || 'obj'
    let name = base
    for (let i = 2; name in objects; i++) name = `${base}${i}`
    ctx.setObject?.(name, v)
    onChange(p.name, { $obj: name })
  }
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5">
      {params.map((p) => (
        <div key={p.name} className="ue:grid ue:grid-cols-[minmax(80px,32%)_minmax(0,1fr)] ue:items-start ue:gap-2">
          <span className="ue:min-w-0 ue:truncate ue:pt-1.5 ue:text-footnote" title={`${p.name}: ${p.type}`}>
            <span className="ue:font-mono ue:text-fg">{p.name}</span>{' '}
            <span className="ue:text-caption ue:text-subtle">{p.type}</span>
          </span>
          {p.obj ? (
            <ObjInput value={objIn(values[p.name])} onChange={(v) => objArg(p, v)} wantClass={p.obj.cls} />
          ) : /^(bool|boolean)$/i.test(p.type) ? (
            <ui.Select
              size="sm"
              value={argText(values[p.name])}
              onChange={(e: { target: { value: string } }) =>
                onChange(p.name, e.target.value === '' ? '' : e.target.value === 'true')
              }
              options={[
                { value: '', label: t('默认') },
                { value: 'true', label: 'true' },
                { value: 'false', label: 'false' },
              ]}
            />
          ) : (
            <ui.Input
              size="sm"
              spellCheck={false}
              className="ue:w-full ue:font-mono"
              placeholder={p.type}
              value={argText(values[p.name])}
              onChange={(e: { target: { value: string } }) => onChange(p.name, argValue(p.type, e.target.value))}
            />
          )}
        </div>
      ))}
      {extra.length > 0 && (
        <p className="ue:text-caption ue:text-warning">
          {t('函数没有这些参数：{a}', { a: extra.join('、') })}{' '}
          <button type="button" className="ue:cursor-pointer ue:text-accent-text ue:underline" onClick={onReset}>
            {t('按函数定义整理')}
          </button>
        </p>
      )}
    </div>
  )
}
