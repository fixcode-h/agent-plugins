import { parseScript, walk, type GtScript, type GtStep } from '../../../../shared/gt-script/index.ts'
import { ppost } from '../../../api.ts'
import { t } from '../../../host.ts'
import { debugSession } from '../gt-debug/session.ts'

/** 子脚本的步骤去掉 id：副本里的 id 由插入时重新发，不和原脚本、别的副本撞 */
function stripIds(steps: GtStep[]): GtStep[] {
  const tmp: GtScript = { steps: structuredClone(steps) }
  walk(tmp, (e) => void delete e.step.id)
  return tmp.steps ?? []
}

/**
 * 「调用脚本」换成那个脚本的一份副本（一个步骤段），参数变成段开头的设变量。
 * 右键「展开调用」和脚本库按住 Alt 拖进来共用这一份；读不到时抛错（消息原样给用户看）
 */
export async function callCopy(call: GtStep): Promise<{ group: GtStep; warn?: string }> {
  const s = debugSession()
  const script = typeof call.script === 'string' ? call.script : ''
  if (!s || !script) throw new Error(t('先在检查器里填要调用的脚本'))
  let sub: GtScript
  try {
    const file = /\.json$/i.test(script) ? script : `${script}.json`
    const r = await ppost<{ text: string }>(s.project, 'ext/gt/file', { root: s.root, path: file, action: 'raw' })
    const p = parseScript(r.text)
    if ('error' in p) throw new Error(p.error)
    sub = p.doc
  } catch (e) {
    throw new Error(t('读不到 {s}：{e}', { s: script, e: (e as Error).message }))
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
  let warn = ''
  walk({ steps: group.do as GtStep[] }, (e) => {
    if (e.step.action === 'return') warn = t('副本里有「结束脚本」：展开后会结束整个脚本，不只是这一段')
  })
  if (call.saveAs) warn = warn || t('调用的返回值（存到 ${v}）展开后没有了', { v: String(call.saveAs) })
  return { group, warn: warn || undefined }
}
