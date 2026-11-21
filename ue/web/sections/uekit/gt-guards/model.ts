import type { GtGuard, GtStep } from '../../../../shared/gt-script/index.ts'
import { satisfies } from '../plugins/model.ts'

/**
 * 守护（协议第 5 节）：当 when 成立就做 do。全局的存在 _settings.json 的 guards，取代原来的阻挡界面（blockers）。
 * GameTest 1.9.0 起才认 guards；更早的版本还按 blockers 存，设置页照旧显示阻挡界面
 */
export const GUARD_MIN_VERSION = '1.9.0'

export const guardsSupported = (gameTestVersion?: string) =>
  !!gameTestVersion && satisfies(gameTestVersion.replace(/-.*$/, ''), `>=${GUARD_MIN_VERSION}`)

/** 原阻挡界面的一条（GtSettings 里的形状） */
export interface BlockerRule {
  widget: string
  action: 'close' | 'call' | 'command'
  function?: string
  command?: string
  note?: string
  delayMs?: number
  enabled?: boolean
}

/** 阻挡界面 → 守护（协议 5.1 的对照表，和 GameTest 读到旧文件时做的一样），id 按 b1、b2 补 */
export function blockersToGuards(list: BlockerRule[]): GtGuard[] {
  return list
    .filter((b) => b.widget?.trim())
    .map((b, i) => {
      const widget = b.widget.trim()
      const target = widget.includes(':') ? widget : `${widget}:.`
      const when: Record<string, unknown> = { target, onScreen: true }
      if (b.delayMs) when.settleMs = b.delayMs
      const step: GtStep =
        b.action === 'call'
          ? { action: 'widget.call', target, function: b.function ?? '' }
          : b.action === 'command'
            ? { action: 'console', command: b.command ?? '' }
            : { action: 'widget.close', target }
      const g: GtGuard = { id: `b${i + 1}`, name: b.note || widget, when, do: [step] }
      if (b.enabled === false) g.disabled = true
      return g
    })
}

/** 新加一条：最常见的「某个界面出现就关掉」。GameTest 2.0 起按对象引用写（判断 obj + :onScreen，动作 obj.close） */
export const blankGuard = (used: Set<string>): GtGuard => {
  let n = 1
  while (used.has(`g${n}`)) n++
  return {
    id: `g${n}`,
    name: '',
    when: { obj: '', prop: '@:onScreen', op: 'is', value: true },
    do: [{ action: 'obj.close', obj: '' }],
  }
}

/**
 * 删掉脚本上第 i 条守护（流程图里选中守护节点按 Delete、右键「删掉这条守护」；用户 2026-11-19：画布上加了删不掉）。
 * 删空了连 guards 字段一起去掉，不在文件里留个空数组
 */
export function removeGuard<T extends { guards?: GtGuard[] }>(doc: T, i: number): T {
  const list = Array.isArray(doc.guards) ? doc.guards.filter((_, j) => j !== i) : []
  const { guards: _old, ...rest } = doc
  return (list.length ? { ...rest, guards: list } : rest) as T
}

/** 存盘前：去掉没写条件也没写动作的空条；默认值不写进文件 */
export function tidyGuards(list: GtGuard[]): GtGuard[] {
  const DEFAULTS: Record<string, unknown> = {
    check: 'both',
    after: 'retry',
    max: 20,
    cooldownMs: 1000,
    unlessStepTargets: true,
    onFail: 'stop',
    disabled: false,
  }
  return list
    .filter((g) => g.when !== undefined || (g.do ?? []).length)
    .map((g) => {
      const out: GtGuard = {}
      for (const [k, v] of Object.entries(g)) if (v !== undefined && v !== '' && DEFAULTS[k] !== v) out[k] = v
      return out
    })
}
