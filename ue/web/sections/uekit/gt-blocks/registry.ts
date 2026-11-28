import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import type { GtStep } from '../../../../shared/gt-script/index.ts'

/**
 * 块和动作在界面上的样子（协议第 14 节：面板的节点类型注册表）：名字、图标、色调、一句话、检查器。
 * 数据层的注册表（shared/gt-script/blocks）管结构，这张表管显示，按 action 对上；列表视图、流程图、插入菜单都查这里。
 * 一种一个文件，加新块：写一个文件、在 index.ts 注册
 */
export type BlockTone = 'accent' | 'warning' | 'success' | 'run' | 'danger' | 'subtle'

export interface BlockUi {
  action: string
  title: () => string
  icon: LucideIcon
  tone: BlockTone
  /** 行里、节点上的一句话 */
  summary: (step: GtStep) => string
  /** 检查器里这种块特有的部分（公共字段由外壳画） */
  Inspector?: ComponentType<{ step: GtStep; onChange: (s: GtStep) => void }>
}

/** 插入菜单（列表视图的 /、流程图的节点面板）里的一项 */
export interface InsertItem {
  id: string
  group: () => string
  label: () => string
  hint?: () => string
  /** 在 / 后面打的英文短名 */
  slash: string
  action: string
  make: () => GtStep
}

/**
 * 某个接口专用的检查器和一句话（api 步骤按 api 名对上）：比如 World.Open 归「打开地图」节点（map-open.tsx），
 * 在接口节点里也按打开地图的样子编辑、能切回编辑器里打开。没登记的接口用通用的接口检查器
 */
export interface ApiUi {
  summary?: (step: GtStep) => string
  Inspector: NonNullable<BlockUi['Inspector']>
}

const apiTable = new Map<string, ApiUi>()

export function registerApiUi(api: string, ui: ApiUi) {
  apiTable.set(api, ui)
}

export const apiUi = (api: unknown) => (typeof api === 'string' ? apiTable.get(api) : undefined)

const table = new Map<string, BlockUi>()
const inserts: InsertItem[] = []

export function registerBlockUi(ui: BlockUi, items: InsertItem[] = []) {
  table.set(ui.action, ui)
  registerInsertItems(items)
}

/** 只登记插入项、不登记显示：原有动作（click、key…）的样子走兜底，但节点面板、插入菜单也要能加它们（leaf-items.ts） */
export function registerInsertItems(items: InsertItem[]) {
  for (const it of items) {
    const i = inserts.findIndex((x) => x.id === it.id)
    if (i >= 0) inserts[i] = it
    else inserts.push(it)
  }
}

/** 不在表里的动作（原有的 click、key…）由 leaf.tsx 的兜底给 */
let fallback: (action: string) => BlockUi = () => {
  throw new Error('gt-blocks 还没注册兜底')
}
export function setFallbackUi(f: (action: string) => BlockUi) {
  fallback = f
}

export const blockUi = (action: string): BlockUi => table.get(action) ?? fallback(action)

export const insertItems = () => inserts

/** 色调 → 类名（Tailwind 要写全的类名才会生成） */
export const TONE_TEXT: Record<BlockTone, string> = {
  accent: 'ue:text-accent',
  warning: 'ue:text-warning',
  success: 'ue:text-success',
  run: 'ue:text-run',
  danger: 'ue:text-danger',
  subtle: 'ue:text-subtle',
}
export const TONE_BAR: Record<BlockTone, string> = {
  accent: 'ue:bg-accent/70',
  warning: 'ue:bg-warning/70',
  success: 'ue:bg-success/70',
  run: 'ue:bg-run/70',
  danger: 'ue:bg-danger/70',
  subtle: 'ue:bg-line',
}
