import { Blocks, Bug, FlaskConical, Save, Sparkles, Undo2 } from 'lucide-react'
import type { ProjectState } from '../../../server/types.ts'
import type { OverviewExtra } from '../../../server/overview.ts'
import type { Badges } from '../../ctx.tsx'
import { t } from '../../host.ts'
import type { GtRunSummary } from '../uekit/GtRun.tsx'
import type { Upgrade } from './ext-data.ts'
import type { AttnItem } from './parts.tsx'

/**
 * 「需要你处理」的条目（设计稿 designs/UE插件优化与扩展-设计稿.md 三.1）：按紧急程度排 ——
 * 崩溃 > Lua 报错 > 没保存的资源 > 还在生效的运行时修改 > 失败的测试 > 可升级的插件。每条一个主动作。
 * 数据都来自已有的徽标请求、项目状态和打开概览时取一次的扩展、测试结果，这里只拼，不发请求。
 * Lua 报错要 UELink 2.4 的 lua.errors（W5），接上后在 crash 后面加一条
 */
export interface AttnInput {
  state?: ProjectState
  badges?: Badges
  extra?: OverviewExtra
  lastRun?: GtRunSummary
  upgrades: Upgrade[]
  go: (section: string, sub?: string) => void
  /** 交给 Agent：旧面板没有「发给对话」时为空，不给这个按钮 */
  toChat?: (text: string) => void
  undoAll: () => void
  fmt: (iso: string) => string
}

/** 交给 Agent 诊断崩溃的话（发给 Agent 的提示词不翻译）：带上崩溃目录和日志路径，Agent 自己去读 */
export function crashPrompt(c: NonNullable<OverviewExtra['crash']>) {
  return [
    'UE 崩溃了，帮我诊断原因。',
    `时间：${new Date(c.at).toLocaleString()}`,
    c.error ? `错误：${c.error}` : '',
    `崩溃目录：${c.dir}`,
    c.log ? `崩溃日志：${c.log}` : '',
    '先读崩溃目录里的日志和 CrashContext.runtime-xml，找出调用栈和崩溃前的日志，判断原因、指出相关代码，给出修法。',
  ]
    .filter(Boolean)
    .join('\n')
}

export function attentionItems(x: AttnInput): AttnItem[] {
  const out: AttnItem[] = []
  const crash = x.extra?.crash
  if (crash)
    out.push({
      key: `crash:${crash.id}`,
      tone: 'danger',
      icon: Bug,
      title: t('UE 崩溃了 · {when}', { when: x.fmt(crash.at) }),
      detail: crash.error.split('\n')[0] || crash.id,
      actions: [
        { label: t('看崩溃记录'), run: () => x.go('logs', 'crash') },
        ...(x.toChat
          ? [{ label: t('交给 Agent 诊断'), icon: Sparkles, primary: true, run: () => x.toChat!(crashPrompt(crash)) }]
          : []),
      ],
    })
  const dirty = x.badges?.dirty ?? 0
  if (dirty)
    out.push({
      key: 'dirty',
      tone: 'warn',
      icon: Save,
      title: t('{n} 个资源改了没保存', { n: dirty }),
      detail: (x.extra?.dirtyNames ?? []).join('、') + (dirty > (x.extra?.dirtyNames.length ?? 0) ? ' …' : ''),
      actions: [{ label: t('去保存'), run: () => x.go('assets') }],
    })
  const undoable = x.badges?.undoable ?? 0
  if (undoable)
    out.push({
      key: 'undo',
      tone: 'warn',
      icon: Undo2,
      title: t('{n} 处运行时修改还在生效', { n: undoable }),
      detail: t('你或 Agent 改的运行时属性、控制台变量，可以一键撤回到改之前的值'),
      actions: [
        { label: t('看记录'), run: () => x.go('history') },
        { label: t('全部撤回'), run: x.undoAll },
      ],
    })
  const run = x.lastRun
  if (run && !run.succeeded)
    out.push({
      key: `gt:${run.runId}`,
      tone: 'warn',
      icon: FlaskConical,
      title: t('GameTest「{name}」上次 {ok}/{n} 通过', {
        name: run.name,
        ok: Math.max(0, run.total - run.failed),
        n: run.total,
      }),
      detail: run.startedAtUtc ? x.fmt(run.startedAtUtc) : undefined,
      actions: [{ label: t('看结果'), run: () => x.go('gametest') }],
    })
  for (const u of x.upgrades)
    out.push({
      key: `up:${u.name}`,
      tone: 'accent',
      icon: Blocks,
      title: t('{name} {v} 可升级', { name: u.name, v: u.to }),
      detail: t('现在是 {v}；升级后要在本地重新编译', { v: u.from }),
      actions: [{ label: t('去 UE 插件'), run: () => x.go('plugins') }],
    })
  return out
}
