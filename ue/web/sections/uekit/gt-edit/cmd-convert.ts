import { ShieldPlus, UnfoldVertical } from 'lucide-react'
import {
  ensureIds,
  getAt,
  parseScript,
  remove,
  replace,
  walk,
  type GtScript,
  type GtStep,
} from '../../../../shared/gt-script/index.ts'
import { ppost } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import { debugSession } from '../gt-debug/session.ts'
import { blankGuard } from '../gt-guards/model.ts'
import { registerCommand, roots, type CmdCtx } from './commands.ts'

/**
 * 流程和录制互相转化的两条命令（定稿 9.1 节点右键、9.7）：
 * - 包进守护：选中的几步挪进一条新的脚本守护的「做什么」（录到的「中途弹出又关掉」那几步变成守护），条件留给人填；
 * - 展开调用：调用脚本的节点换成那个脚本的一份副本（一个步骤段），参数变成段开头的设变量
 */
const inGuard = (c: CmdCtx) => c.selected.some((p) => p.includes('guards'))

registerCommand(
  {
    id: 'wrap-guard',
    group: 2,
    multi: true,
    label: () => t('包进守护'),
    icon: ShieldPlus,
    enabled: (c) => c.selected.length > 0 && !inGuard(c),
    run: (c) => {
      const list = roots(c.selected)
      const steps = list.map((p) => structuredClone(getAt(c.doc, p) as GtStep))
      const next = remove(c.doc, list)
      if (!next) return void h().toast.error(t('这几步挪不出来'))
      const guards = next.guards ?? []
      const g = { ...blankGuard(new Set(guards.map((x) => x.id ?? ''))), do: steps }
      if (c.apply({ ...next, guards: [...guards, g] })) {
        // 守护在「脚本设置」里编辑：清掉选中，右栏回到脚本设置
        c.select([])
        h().toast.success(t('已包成守护「{id}」：到右边「这个脚本的守护」里填什么时候触发', { id: g.id ?? '' }))
      }
    },
  },
  'wrap-loop',
)

/** 子脚本的步骤去掉 id：副本里的 id 由 ensureIds 重新发，不和原脚本、别的副本撞 */
function stripIds(steps: GtStep[]): GtStep[] {
  const tmp: GtScript = { steps: structuredClone(steps) }
  walk(tmp, (e) => void delete e.step.id)
  return tmp.steps ?? []
}

async function inlineCall(c: CmdCtx) {
  const path = c.selected[0]
  const call = getAt(c.doc, path) as GtStep
  const s = debugSession()
  const script = typeof call.script === 'string' ? call.script : ''
  if (!s || !script) return void h().toast.error(t('先在检查器里填要调用的脚本'))
  let sub: GtScript
  try {
    const file = /\.json$/i.test(script) ? script : `${script}.json`
    const r = await ppost<{ text: string }>(s.project, 'ext/gt/file', { root: s.root, path: file, action: 'raw' })
    const p = parseScript(r.text)
    if ('error' in p) throw new Error(p.error)
    sub = p.doc
  } catch (e) {
    return void h().toast.error(t('读不到 {s}：{e}', { s: script, e: (e as Error).message }))
  }
  const given = (call.with && typeof call.with === 'object' ? call.with : {}) as Record<string, unknown>
  // 传进来的参数、没传的默认值都写成段开头的设变量，副本里的 $名字 照旧能用
  const sets: GtStep[] = Object.entries(sub.params ?? {}).map(([k, p]) => ({
    action: 'set',
    var: k,
    value: k in given ? given[k] : (p.default ?? ''),
  }))
  const group: GtStep = {
    action: 'group',
    name: t('{s}（展开的副本）', { s: sub.name || script }),
    do: [...sets, ...stripIds(sub.steps ?? [])],
    ...(Array.isArray(sub.guards) && sub.guards.length ? { guards: structuredClone(sub.guards) } : {}),
  }
  const r = replace(c.doc, path, group)
  if (!r) return
  if (c.apply(ensureIds(r.doc))) c.select([path])
  let warn = ''
  walk({ steps: group.do as GtStep[] }, (e) => {
    if (e.step.action === 'return') warn = t('副本里有「结束脚本」：展开后会结束整个脚本，不只是这一段')
  })
  if (call.saveAs) warn = warn || t('调用的返回值（存到 ${v}）展开后没有了', { v: String(call.saveAs) })
  if (warn) h().toast.error(warn)
}

registerCommand(
  {
    id: 'inline-call',
    group: 2,
    label: () => t('展开调用（换成副本）'),
    icon: UnfoldVertical,
    enabled: (c) =>
      c.selected.length === 1 &&
      (getAt(c.doc, c.selected[0]) as GtStep | undefined)?.action === 'call' &&
      !!debugSession(),
    run: (c) => void inlineCall(c),
  },
  'unwrap',
)
