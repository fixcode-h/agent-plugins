import { AssetInfo } from '../../AssetInfo.tsx'
import { ChangesButton } from '../../asset-dirty/ChangesButton.tsx'
import { DiffButton } from '../../asset-diff/DiffButton.tsx'
import { useUe } from '../../ctx.tsx'
import { t } from '../../host.ts'
import { useKept } from '../../keep.ts'
import { ForgeExport } from '../../sections/uekit/ForgeExport.tsx'
import type { LayoutProps } from './types.ts'

/**
 * 各布局共用的小件：右边看什么（内容 / 蓝图 / 摘要）记在一处（切资源、切布局都留着，和原来的 AssetView 一样），
 * 「摘要与引用」页、改动、历史版本和导出到配置几个通用按钮（设计稿第 2 节：所有布局都有）。
 */
export type AssetTab = '' | 'graph' | 'info'

export function useAssetTab() {
  const { project } = useUe()
  return useKept<AssetTab>(`${project.id}/assetview/tab`, '')
}

export const assetName = (path: string) => path.split(/[./]/).pop() ?? path

export function InfoView({ path, onOpen }: Pick<LayoutProps, 'path' | 'onOpen'>) {
  return <AssetInfo key={path} path={path} onOpen={(p) => onOpen(p, t('引用'))} />
}

/** 改动（有没保存的改动时才出现）+ 历史版本 + 导出到配置（AssetForge 装了才出现） */
export function CommonActions({ path }: { path: string }) {
  return (
    <>
      <ChangesButton path={path} />
      <DiffButton asset={path} />
      <ForgeExport asset={path} />
    </>
  )
}
