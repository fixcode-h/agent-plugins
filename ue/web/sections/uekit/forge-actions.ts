import { op, ppost, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import type { ForgeEntry } from './Forge.tsx'
import { assetObjectPath } from './ForgeLink.tsx'

/** 这些状态导入不了：配置读不出来、没写目标资产、不是 AssetForge 的配置 */
export const NOT_IMPORTABLE = ['parse-error', 'no-asset', 'foreign']

export const canImport = (e: ForgeEntry) => !!e.config && !NOT_IMPORTABLE.includes(e.state)
export const canExport = (e: ForgeEntry) => !!e.asset && !['asset-missing', 'never-imported'].includes(e.state)

/**
 * 选中一份配置时头部按钮、⋯ 菜单、页签里共用的动作。导入导出是后台作业（进度和结果走 forge.job 推送，左栏接），
 * 这里只负责发起；出错由 useAction 原样 toast，不悄悄吞掉。
 */
export function useForgeActions(entry: ForgeEntry, configRoot: string) {
  const { project, go } = useUe()
  const { busy, run } = useAction()
  const importIt = () =>
    run('import', async () => {
      await op(project.id, 'forge.import', { configs: [entry.config] })
      h().toast.success(t('已开始导入 {name}', { name: fileName(entry) }))
    })
  const exportIt = () =>
    run('export', async () => {
      await op(project.id, 'forge.export', { assets: [entry.asset] })
      h().toast.success(t('已开始导出到配置'))
    })
  // 本机动作（服务端 forge-files.ts）：只认配置根里的文件，所以要带上 configRoot
  const file = (action: 'open' | 'reveal') =>
    run(action, async () => {
      if (!entry.config) throw new Error(t('这一项没有配置文件'))
      await ppost(project.id, 'ext/forge/file', { root: configRoot, path: entry.config, action })
    })
  const asset = assetObjectPath(entry.asset)
  return {
    busy,
    importIt,
    exportIt,
    openFile: () => file('open'),
    reveal: () => file('reveal'),
    openAsset: asset ? () => go('assets', asset) : undefined,
  }
}

export function fileName(e: ForgeEntry) {
  return (e.config ?? '').replace(/\\/g, '/').split('/').pop() || e.name
}
