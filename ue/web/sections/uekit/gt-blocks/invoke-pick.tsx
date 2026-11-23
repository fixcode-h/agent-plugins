import { ListTree } from 'lucide-react'
import { useMemo, useState } from 'react'
import { objOfVar, pathOfStep, type GtScript, type GtStep } from '../../../../shared/gt-script/index.ts'
import type { GmObject } from '../../../../shared/gm/schema.ts'
import { h, t } from '../../../host.ts'
import { MemberPane, type MemberTab } from '../../../obj-kit/MemberPane.tsx'
import { fnsOf, type FnInfo } from '../../../obj-kit/members.ts'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { inlineRef, isRefObj } from '../gt-ref/describe.ts'
import { useVars, type VarScope } from '../gt-vars/model.ts'

const PLAYERS = new Set(['gi', 'gs', 'gm', 'ps', 'pc', 'pawn', 'hud'])

/**
 * obj.call 的「对象」→ gt.vars 的范围（协议 game-test-ref 5.3、7.6）：命名对象 / 内联引用按引用列，
 * 取值来源 `@sub.X`、玩家几件套、`@luaMod.路径` 照旧；`$变量` 按前面给它赋值的「找对象」那一步的对象列（B4），
 * 找不到那一步才说要跑起来才知道。静态函数省略 obj，function 写「类名.函数」
 */
export function scopeOfInvoke(step: GtStep, doc: GtScript | undefined): VarScope | { why: string } {
  const objects = doc?.objects as Record<string, unknown> | undefined
  const obj = step.obj
  if (doc && typeof obj === 'string' && obj.trim().startsWith('$')) {
    const src = objOfVar(doc, obj.trim(), pathOfStep(doc, step))
    // 来源还是 $变量时不再往下追：免得 $a = 找($b)、$b = 找($a) 绕圈
    if (src !== undefined && !(typeof src === 'string' && src.startsWith('$')))
      return scopeOfInvoke({ ...step, obj: src }, doc)
  }
  if (isRefObj(obj)) return { scope: 'object', ref: inlineRef(obj, objects) }
  const s = typeof obj === 'string' ? obj.trim() : ''
  if (s && !s.startsWith('@') && !s.startsWith('$')) {
    const o = objects?.[s]
    if (isRefObj(o)) return { scope: 'object', ref: inlineRef(s, objects) }
    return { why: t('脚本里没有叫 {n} 的对象：先在「脚本设置 → 对象」里加', { n: s }) }
  }
  if (!s) {
    const fn = typeof step.function === 'string' ? step.function : ''
    const cls = fn.includes('.') ? fn.slice(0, fn.lastIndexOf('.')) : ''
    return cls ? { scope: 'class', name: cls } : { why: t('先填对象；调静态函数时把函数写成「类名.函数」再来选') }
  }
  const m = /^@(\w+)(?:\.(.+))?$/.exec(s)
  if (m && m[1] === 'sub' && m[2]) return { scope: 'subsystem', name: m[2] }
  if (m && PLAYERS.has(m[1]) && !m[2]) return { scope: 'player', which: m[1] as 'pc' }
  if (m && m[1] === 'luaMod' && m[2]) return { scope: 'lua', module: m[2] }
  return {
    why: s.startsWith('$')
      ? t('前面没有把对象存进 {o} 的「找对象」：要跑起来才知道是什么类，函数名直接写', { o: s })
      : t('{o} 要跑起来才知道是什么类：函数名直接写', { o: s }),
  }
}

/** 选中的函数 → 步骤：函数名，参数按函数要的列出来（已经填过的留着；输出参数、自动参数不用填） */
export function applyFn(step: GtStep, f: FnInfo): GtStep {
  const old = (step.args && typeof step.args === 'object' ? step.args : {}) as Record<string, unknown>
  const args: Record<string, unknown> = {}
  for (const p of f.params) args[p.name] = p.name in old ? old[p.name] : ''
  // 静态函数（没有对象）写成「类名.函数」，有对象的只写函数名
  const fn = step.obj
    ? f.name
    : `${f.owner || (typeof step.function === 'string' ? step.function.split('.')[0] : '')}.${f.name}`
  return { ...step, function: fn, args }
}

/**
 * 这一步的对象上能调的函数（签名卡、按类型的参数表单都按它）：和「换函数…」读同一份 gt.vars，
 * 编辑器没连上时只有 Lua 文件里扫到的
 */
export function useInvokeFns(step: GtStep) {
  const ctx = useEditCtx()
  const scope = scopeOfInvoke(step, ctx.doc)
  const ok = !('why' in scope)
  const vars = useVars(ctx.project, ok ? scope : undefined, ctx.live)
  const fns = useMemo(() => fnsOf(vars.data?.groups ?? []), [vars.data])
  const name = typeof step.function === 'string' ? step.function.split('.').pop() : ''
  return { fn: fns.find((f) => f.name === name), loading: vars.loading, why: ok ? undefined : scope.why }
}

/** gt.vars 的范围 → 成员面板要的对象：引用照给（游戏没开时成员面板自己按类列），其余写成来源 */
function memberObj(scope: VarScope): { obj: GmObject; scope?: VarScope } {
  if (scope.scope === 'object') return { obj: { name: 'obj', ref: scope.ref } as GmObject }
  return { obj: { name: 'obj', src: '@' } as GmObject, scope }
}

/**
 * 调函数检查器的「换函数…」（分析文档 G2、B6）：和 GM 对象调用中栏同一个成员面板（方法 · Lua），按声明类分组，
 * 调不了的（私有、编辑器专用、参数构造不出来）灰掉写原因；选了填上函数名和参数名
 */
export function InvokeFnPick({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui } = h()
  const [open, setOpen] = useState(false)
  const has = typeof step.function === 'string' && !!step.function
  return (
    <>
      <ui.Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <ListTree className="ue:h-3.5 ue:w-3.5" />
        {has ? t('换函数…') : t('选函数…')}
      </ui.Button>
      {open && (
        <FnDialog
          step={step}
          onClose={() => setOpen(false)}
          onPick={(s) => {
            onChange(s)
            setOpen(false)
          }}
        />
      )}
    </>
  )
}

function FnDialog({ step, onClose, onPick }: { step: GtStep; onClose: () => void; onPick: (s: GtStep) => void }) {
  const { ui } = h()
  const ctx = useEditCtx()
  const scope = scopeOfInvoke(step, ctx.doc)
  const [tab, setTab] = useState<MemberTab>('fns')
  const cur = typeof step.function === 'string' ? step.function.split('.').pop() : ''
  const m = 'why' in scope ? undefined : memberObj(scope)
  return (
    <ui.Modal
      open
      size="lg"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('选要调的函数')}
      description={t('只列真能调到的：C++ 和蓝图的 BlueprintCallable、Exec，Lua 表上的函数。调不了的灰掉并写了原因。')}
      footer={
        <ui.Button variant="secondary" onClick={onClose}>
          {t('取消')}
        </ui.Button>
      }
    >
      <div className="ue:flex ue:h-[60vh] ue:min-h-0 ue:flex-col ue:overflow-hidden ue:rounded-(--c-row-radius) ue:border ue:border-line">
        {!m ? (
          <p className="ue:p-4 ue:text-footnote ue:text-subtle">{(scope as { why: string }).why}</p>
        ) : (
          <MemberPane
            project={ctx.project}
            obj={m.obj}
            scope={m.scope}
            live={ctx.live}
            tab={tab}
            onTab={setTab}
            tabs={['fns', 'luaFns']}
            fn={cur}
            onFn={(f) => onPick(applyFn(step, f))}
          />
        )}
      </div>
    </ui.Modal>
  )
}
