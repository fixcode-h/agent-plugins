import { File } from 'lucide-react'
import { ASSET_KINDS, type KindMeta } from '../../asset-icons.ts'
import { t } from '../../host.ts'

/**
 * AssetForge 的资产类型：每种一个图标和一个主题色（用户 2026-11-15：不同资源类型不同图标），
 * 键是 forge.kinds 返回的 kind。图标表挪到 asset-icons.ts，和资源页的文件夹树共用
 */
export type { KindMeta }
export const KINDS = ASSET_KINDS

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
  // 列表先从磁盘出、UE 还没回同步状态时（forge-source.ts）
  '': { label: () => t('正在读状态'), tone: 'ue:text-subtle', dot: 'ue:bg-line-strong' },
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
