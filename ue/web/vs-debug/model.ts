import type { VsBreakpoint, VsDebugFrame, VsDebugState } from '../../server/types.ts'
import { t } from '../host.ts'

/**
 * VS 调试卡片的纯逻辑：状态一句话、停下原因、按状态哪些按钮能点、启动参数的本机记忆。
 * 和界面分开放：卡片、左栏一行、设置里的示例都用这一份，判断只写一次
 */

export type Phase = 'off' | 'design' | 'building' | 'launching' | 'run' | 'break'

export function phaseOf(vs: VsDebugState | undefined): Phase {
  const s = vs?.status
  if (!vs?.available || !s) return 'off'
  // 编译、启动中优先：F5 之后 mode 还是 design，只看 mode 会显示「没在调试」让人以为没点上
  if (s.building) return 'building'
  if (s.launchPending) return 'launching'
  return s.mode === 'break' ? 'break' : s.mode === 'run' ? 'run' : 'design'
}

/** 停下原因（UEToVS DebugHelpers.ReasonText 的取值）；认不出的原样显示，不吞掉 */
export function reasonLabel(r: string | undefined) {
  switch (r) {
    case 'breakpoint':
      return t('断点')
    case 'step':
      return t('单步')
    case 'exception':
      return t('异常')
    case 'unhandledException':
      return t('未处理的异常')
    case 'pause':
      return t('暂停')
    default:
      return r ?? ''
  }
}

export type DotTone = 'ok' | 'warn' | 'danger' | 'run' | 'muted'

/** 状态一句话和状态点颜色（卡片头、左栏一行共用） */
export function phaseLine(vs: VsDebugState | undefined): { tone: DotTone; text: string } {
  const p = phaseOf(vs)
  const s = vs?.status
  switch (p) {
    case 'off':
      return { tone: 'muted', text: vs?.message || t('VS 调试不可用') }
    case 'building':
      return { tone: 'run', text: t('正在编译') }
    case 'launching':
      return { tone: 'run', text: t('启动中') }
    case 'run':
      return { tone: 'ok', text: t('运行中') }
    case 'break': {
      const why = reasonLabel(s?.lastReason)
      // 异常停下用红色：多半是 check / ensure / 崩溃，和普通断点区分开
      const bad = s?.lastReason === 'exception' || s?.lastReason === 'unhandledException'
      return { tone: bad ? 'danger' : 'warn', text: why ? t('停在{why}', { why }) : t('已停下') }
    }
    default:
      return { tone: 'muted', text: t('没在调试') }
  }
}

/** 按状态能点哪些：没在调试才能启动 / 附加；正在编译或启动中也能停（停 = 取消编译） */
export function canDo(p: Phase) {
  const idle = p === 'design'
  const live = p === 'run' || p === 'break'
  return {
    start: idle,
    attach: idle,
    stop: live || p === 'building' || p === 'launching',
    restart: live,
    pause: p === 'run',
    resume: p === 'break',
    step: p === 'break',
  }
}

const base = (f: string) => f.replace(/\\/g, '/').split('/').pop() || f

/** 帧的位置：Foo.cpp:12（没有文件时空） */
export function frameAt(f: VsDebugFrame | undefined) {
  if (!f?.file) return ''
  return f.line ? `${base(f.file)}:${f.line}` : base(f.file)
}

/** 断点的显示名：文件:行，或函数断点的函数名 */
export function bpLabel(b: VsBreakpoint) {
  if (b.file) return b.line ? `${base(b.file)}:${b.line}` : base(b.file)
  return b.function || `#${b.i}`
}

/** 启动参数（只对这一次 start 生效，UEToVS 启动后会改回去）：记在本机浏览器，下次打开还是这些 */
export interface LaunchParams {
  map: string
  game: boolean
  args: string
  /** 空 = 用 VS 当前的解决方案配置 */
  configuration: string
}

export const EMPTY_PARAMS: LaunchParams = { map: '', game: false, args: '', configuration: '' }

/** UE 生成的解决方案里常用的配置；协议认全名、去掉平台的名字或唯一片段，这里给去掉平台的 */
export const CONFIGS = ['DebugGame Editor', 'Development Editor', 'DebugGame', 'Development']

const storeKey = (project: string) => `ue:vs-debug:${project}`

/** 浏览器存储可能被禁（隐私窗口、清了站点数据）：读不到就用空的，不影响启动 */
export function loadParams(project: string): LaunchParams {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(project)) || 'null') as Partial<LaunchParams> | null
    return { ...EMPTY_PARAMS, ...(v ?? {}) }
  } catch {
    return { ...EMPTY_PARAMS }
  }
}

export function saveParams(project: string, p: LaunchParams) {
  try {
    localStorage.setItem(storeKey(project), JSON.stringify(p))
  } catch {
    // 存不下只是下次要重填，不打断操作
  }
}

/** start 的 args：空的不传，免得把 VS 当前配置、启动项目的参数覆盖成空 */
export function startArgs(p: LaunchParams, noDebug: boolean) {
  const a: Record<string, unknown> = {}
  if (noDebug) a.noDebug = true
  if (p.configuration.trim()) a.configuration = p.configuration.trim()
  if (p.map.trim()) a.map = p.map.trim()
  if (p.game) a.game = true
  if (p.args.trim()) a.args = p.args.trim()
  return a
}

/** 启动参数收起时的一行摘要 */
export function paramsSummary(p: LaunchParams) {
  return [p.configuration, p.map, p.game ? '-game' : '', p.args].filter((x) => x.trim()).join(' · ')
}
