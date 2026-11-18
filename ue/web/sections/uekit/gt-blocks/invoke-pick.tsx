import { ListTree } from 'lucide-react'
import { useState } from 'react'
import type { GtStep } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { FieldGroups, itemKey } from '../gt-vars/FieldGroups.tsx'
import { useVars, type VarGroup, type VarItem, type VarScope } from '../gt-vars/model.ts'

const PLAYERS = new Set(['gi', 'gs', 'gm', 'ps', 'pc', 'pawn', 'hud'])

/**
 * 调函数的「对象」→ gt.vars 的范围（协议第 10 节）：子系统、玩家几件套、Lua 模块、抓取的对象、静态函数的类。
 * $变量、控件选择器这类编写时不知道是什么类的，列不出来（返回 why）
 */
export function scopeOfInvoke(step: GtStep, objects: Record<string, unknown> | undefined): VarScope | { why: string } {
  const obj = step.object
  if (obj && typeof obj === 'object') {
    const name = (obj as { $obj?: unknown }).$obj
    const loc = typeof name === 'string' ? objects?.[name] : undefined
    if (loc && typeof loc === 'object') return { scope: 'object', locator: loc as Record<string, unknown> }
    return { why: t('这个对象没在「脚本设置 → 对象」里配，列不出它的函数') }
  }
  const s = typeof obj === 'string' ? obj.trim() : ''
  if (!s) {
    const fn = typeof step.function === 'string' ? step.function : ''
    const cls = fn.includes('.') ? fn.slice(0, fn.lastIndexOf('.')) : ''
    return cls ? { scope: 'class', name: cls } : { why: t('先填对象；调静态函数时把函数写成「类名.函数」再来选') }
  }
  const m = /^@(\w+)(?:\.(.+))?$/.exec(s)
  if (m && m[1] === 'sub' && m[2]) return { scope: 'subsystem', name: m[2] }
  if (m && PLAYERS.has(m[1]) && !m[2]) return { scope: 'player', which: m[1] as 'pc' }
  if (m && m[1] === 'luaMod' && m[2]) return { scope: 'lua', module: m[2] }
  return { why: t('{o} 要跑起来才知道是什么类：函数名直接写', { o: s }) }
}

/** 选中的函数 → 步骤：函数名，参数按函数要的列出来（已经填过的留着；输出参数、自动参数不用填） */
function applyFn(step: GtStep, g: VarGroup, it: VarItem): GtStep {
  const old = (step.args && typeof step.args === 'object' ? step.args : {}) as Record<string, unknown>
  const args: Record<string, unknown> = {}
  for (const a of it.args ?? []) if (!a.out && !a.auto) args[a.name] = a.name in old ? old[a.name] : ''
  // 静态函数（没有对象）写成「类名.函数」，有对象的只写函数名
  const fn = step.object
    ? it.name
    : `${g.class ?? (typeof step.function === 'string' ? step.function.split('.')[0] : '')}.${it.name}`
  return { ...step, function: fn, args }
}

/**
 * 调函数检查器里「从列表选」（定稿第 5 节「只列真能调到的函数」、效果图 8）：按 C++ / 蓝图 / Lua 分组列出这个对象上的函数，
 * 调不了的（私有、编辑器专用、参数构造不出来）灰掉写原因；选了填上函数名和参数名
 */
export function InvokeFnPick({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui } = h()
  const [open, setOpen] = useState(false)
  return (
    <>
      <ui.Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <ListTree className="ue:h-3.5 ue:w-3.5" />
        {t('从列表选')}
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
  const scope = scopeOfInvoke(step, ctx.doc?.objects as Record<string, unknown> | undefined)
  const ok = !('why' in scope)
  const vars = useVars(ctx.project, ok ? scope : undefined, ctx.live)
  const groups = (vars.data?.groups ?? [])
    .map((g) => ({ ...g, items: g.items.filter((x) => x.kind === 'fn') }))
    .filter((g) => g.items.length)
  const cur = typeof step.function === 'string' ? step.function.split('.').pop() : ''
  const selected = new Set(groups.flatMap((g) => g.items.filter((x) => x.name === cur).map((x) => itemKey(g, x))))
  return (
    <ui.Modal
      open
      size="xl"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('选要调的函数')}
      description={t('只列真能调到的：C++ 和蓝图的 BlueprintCallable、Exec，Lua 表上的函数。调不了的灰掉并写了原因。')}
      footer={
        <ui.Button variant="secondary" onClick={onClose}>
          {t('取消')}
        </ui.Button>
      }
    >
      <div className="ue:flex ue:h-[60vh] ue:min-h-0 ue:flex-col">
        {!ok ? (
          <p className="ue:p-4 ue:text-footnote ue:text-subtle">{scope.why}</p>
        ) : vars.loading && !vars.data ? (
          <p className="ue:p-4 ue:text-footnote ue:text-subtle">{t('正在列函数…')}</p>
        ) : (
          <>
            {vars.error && <p className="ue:px-4 ue:pt-3 ue:text-footnote ue:text-danger">{vars.error}</p>}
            {!ctx.live && (
              <p className="ue:px-4 ue:pt-3 ue:text-footnote ue:text-subtle">
                {t('编辑器没连上：只列得出 Lua 文件里扫到的函数，C++ 和蓝图的要连上编辑器')}
              </p>
            )}
            <FieldGroups groups={groups} selected={selected} onToggle={(g, it) => onPick(applyFn(step, g, it))} />
          </>
        )}
      </div>
    </ui.Modal>
  )
}
