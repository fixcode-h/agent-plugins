import type { GtScript, GtStep } from './types.ts'

/**
 * 三段分得对不对（GameTest 2.8.0，用户 2026-11-27）：执行段开头只是在准备和检查前置、执行段末尾只是在收拾现场的步骤，
 * 该放执行前 / 执行后。服务端写法检查（style_precheck_in_steps / style_cleanup_in_steps）和编辑页列表的「挪到执行前」共用这一份
 */

/** 玩家的操作：执行段从第一个这样的步骤开始才算真开始玩 */
const INTERACT = new Set([
  'click',
  'drag',
  'key',
  'move',
  'scroll',
  'type',
  'wheel',
  'select',
  'ability.input',
  'obj.call',
  'obj.set',
  'obj.do',
  'lua',
  'luafn',
])
/** 准备环境、只读检查：可以放执行前的 */
const PREP = new Set([
  'pie.start',
  'level.load',
  'editor.ensure',
  'wait',
  'assert',
  'api',
  'gm.run',
  'obj.find',
  'obj.wait',
  'console',
  'mark',
])
const isCheck = (s: GtStep) =>
  s.action === 'assert' || (s.action === 'api' && s.expect !== undefined && s.saveAs === undefined)
/** 公共库里的子脚本（common/…）多是「进入地图」这类准备，算准备 */
const isPrepCall = (s: GtStep) => s.action === 'call' && typeof s.script === 'string' && /^common\//.test(s.script)
/** 明确在准备环境的一步：开 PIE、开关卡、跑 GM、进地图、加载接口（不带 expect、不存值的接口调用） */
const isEnvPrep = (s: GtStep) =>
  ['pie.start', 'level.load', 'editor.ensure', 'gm.run'].includes(s.action) ||
  isPrepCall(s) ||
  (s.action === 'wait' && s.until === 'pie') ||
  (s.action === 'api' && s.expect === undefined && s.saveAs === undefined)

const steps = (doc: GtScript) =>
  (Array.isArray(doc.steps) ? doc.steps : []).filter((s): s is GtStep => !!s && typeof s === 'object')

/**
 * 执行段开头有几步只是准备和检查前置：至少 2 步，既有准备环境的一步、又有一个检查时才算（只是先等个状态、记个基准值的不算），否则返回 0
 */
export function precheckRun(doc: GtScript): number {
  const list = steps(doc)
  let n = 0
  while (n < list.length && !INTERACT.has(list[n].action) && (PREP.has(list[n].action) || isPrepCall(list[n]))) n++
  // 整段都是准备、后面没有操作：可能是只读的检查脚本，不提示
  if (n >= list.length) return 0
  const head = list.slice(0, n)
  return n >= 2 && head.some(isCheck) && head.some(isEnvPrep) ? n : 0
}

const CLEANUP = /exit|close|reset|restore|cleanup|teardown|退出|关闭|恢复|还原|清理|收尾/i
const text = (s: GtStep) =>
  [s.title, s.note, s.api, s.script, s.cmd, s.target].filter((v) => typeof v === 'string').join(' ')

/** 执行段末尾有几步是在收拾现场（退出玩法、关界面、恢复状态） */
export function cleanupRun(doc: GtScript): number {
  const list = steps(doc)
  let n = 0
  while (
    n < list.length - 1 &&
    list[list.length - 1 - n].action !== 'assert' &&
    CLEANUP.test(text(list[list.length - 1 - n]))
  )
    n++
  return n
}

/** 把执行段开头 / 末尾的 count 步挪到执行前末尾 / 执行后开头 */
export function moveToPhase(doc: GtScript, to: 'setup' | 'teardown', count: number): GtScript {
  const list = steps(doc)
  if (count <= 0 || count > list.length) return doc
  const moved = to === 'setup' ? list.slice(0, count) : list.slice(list.length - count)
  const rest = to === 'setup' ? list.slice(count) : list.slice(0, list.length - count)
  const old = Array.isArray(doc[to]) ? (doc[to] as GtStep[]) : []
  return { ...doc, steps: rest, [to]: to === 'setup' ? [...old, ...moved] : [...moved, ...old] }
}
