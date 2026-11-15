import {
  Activity,
  AppWindow,
  Atom,
  Bone,
  Boxes,
  File,
  Film,
  Gem,
  Image,
  Map as MapIcon,
  Network,
  Palette,
  PersonStanding,
  Puzzle,
  Sparkles,
  Table,
  Type,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { t } from '../../host.ts'

/**
 * AssetForge 的资产类型：每种一个图标和一个主题色（用户 2026-11-15：不同资源类型不同图标），
 * 键是 forge.kinds 返回的 kind（UEKit ForgeKindRegistry 登记表）。颜色只用面板主题色，不自造。
 */
export interface KindMeta {
  icon: LucideIcon
  /** 图标颜色的类名 */
  tone: string
  label: () => string
}

export const KINDS: Record<string, KindMeta> = {
  'umg-widget': { icon: AppWindow, tone: 'ue:text-accent-text', label: () => 'UMG' },
  'actor-blueprint': { icon: Boxes, tone: 'ue:text-run', label: () => t('Actor 蓝图') },
  'object-blueprint': { icon: Puzzle, tone: 'ue:text-run', label: () => t('对象蓝图') },
  'anim-blueprint': { icon: Activity, tone: 'ue:text-run', label: () => t('动画蓝图') },
  'anim-sequence': { icon: Film, tone: 'ue:text-success', label: () => t('动画序列') },
  'behavior-tree': { icon: Network, tone: 'ue:text-success', label: () => t('行为树') },
  'state-tree': { icon: Workflow, tone: 'ue:text-success', label: () => t('状态树') },
  material: { icon: Palette, tone: 'ue:text-warning', label: () => t('材质') },
  niagara: { icon: Sparkles, tone: 'ue:text-danger', label: () => 'Niagara' },
  texture: { icon: Image, tone: 'ue:text-warning', label: () => t('纹理') },
  'data-table': { icon: Table, tone: 'ue:text-accent-text', label: () => t('数据表') },
  'data-asset': { icon: Gem, tone: 'ue:text-run', label: () => t('数据资产') },
  'skeletal-mesh': { icon: PersonStanding, tone: 'ue:text-accent-text', label: () => t('骨骼网格体') },
  skeleton: { icon: Bone, tone: 'ue:text-muted', label: () => t('骨骼') },
  'physics-asset': { icon: Atom, tone: 'ue:text-muted', label: () => t('物理资产') },
  map: { icon: MapIcon, tone: 'ue:text-warning', label: () => t('地图') },
  font: { icon: Type, tone: 'ue:text-muted', label: () => t('字体') },
}

const UNKNOWN: KindMeta = { icon: File, tone: 'ue:text-subtle', label: () => t('其他') }

export const kindMeta = (kind?: string) => (kind && KINDS[kind]) || { ...UNKNOWN, label: () => kind || t('其他') }

/** 同步状态：forge.entries 的 state id → 文案和颜色（UEKit docs/asset-forge.md「同步状态」） */
export const STATES: Record<string, { label: () => string; tone: string; dot: string }> = {
  synced: { label: () => t('已同步'), tone: 'ue:text-success', dot: 'ue:bg-success' },
  'never-imported': { label: () => t('还没导入'), tone: 'ue:text-subtle', dot: 'ue:bg-subtle' },
  'config-changed': { label: () => t('配置已改'), tone: 'ue:text-warning', dot: 'ue:bg-warning' },
  pending: { label: () => t('导入会改资产'), tone: 'ue:text-warning', dot: 'ue:bg-warning' },
  'asset-changed': { label: () => t('资产被改过'), tone: 'ue:text-accent-text', dot: 'ue:bg-accent' },
  'asset-missing': { label: () => t('资产不存在'), tone: 'ue:text-danger', dot: 'ue:bg-danger' },
  'parse-error': { label: () => t('解析失败'), tone: 'ue:text-danger', dot: 'ue:bg-danger' },
  foreign: { label: () => t('不是 AssetForge 的配置'), tone: 'ue:text-subtle', dot: 'ue:bg-subtle' },
  unmanaged: { label: () => t('没有配置'), tone: 'ue:text-subtle', dot: 'ue:bg-line-strong' },
  'no-asset': { label: () => t('没写目标资产'), tone: 'ue:text-danger', dot: 'ue:bg-danger' },
}

export const stateMeta = (s: string) => STATES[s] ?? { label: () => s, tone: 'ue:text-subtle', dot: 'ue:bg-subtle' }

/** 列表筛选分组：待同步 = 要导入的，被改过 = 要导出的，出错 = 修不了要人看的 */
export const FILTERS = {
  all: () => true,
  pending: (e: { needsImport?: boolean }) => !!e.needsImport,
  changed: (e: { state: string }) => e.state === 'asset-changed',
  error: (e: { state: string }) => ['parse-error', 'asset-missing', 'no-asset'].includes(e.state),
} as const
export type FilterId = keyof typeof FILTERS
