import { CircleAlert, ExternalLink, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ppost } from '../../api.ts'
import { h, t } from '../../host.ts'

/**
 * 新建配置时检查目标资产（用户 2026-11-16 同意的扩展）：
 * - 已经有配置管着这个资产：不能再建一份（两份配置写同一个资产，谁后导入谁赢），给「打开那份配置」。
 * - 资产已经在磁盘上、还没配置：可以建，但导入会按新配置改写它；更稳的做法是先「导出到 JSON」纳管现有资产。
 * 资产在不在只看 Content 下的 .uasset / .umap（服务端 ext/forge/asset），不起 UE；/Game 以外的挂载点不查。
 */
export interface AssetCheckResult {
  /** 管着它的配置（相对配置根） */
  managedBy?: string
  exists?: boolean
}

export function useAssetCheck(
  project: string,
  asset: string | undefined,
  managedBy: (asset: string) => string | undefined,
) {
  const [exists, setExists] = useState<boolean>()
  useEffect(() => {
    setExists(undefined)
    if (!asset) return
    let live = true
    // 打字时不每个字都查：停 300ms 再问
    const timer = setTimeout(() => {
      ppost<{ known: boolean; exists?: boolean }>(project, 'ext/forge/asset', { asset })
        .then((r) => live && setExists(r.known ? !!r.exists : undefined))
        .catch(() => undefined)
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [project, asset])
  return { managedBy: asset ? managedBy(asset) : undefined, exists } as AssetCheckResult
}

export function AssetCheckNote({
  check,
  onOpenConfig,
  onExport,
}: {
  check: AssetCheckResult
  onOpenConfig: (config: string) => void
  onExport: () => void
}) {
  const { ui, cn } = h()
  if (!check.managedBy && !check.exists) return null
  const managed = !!check.managedBy
  return (
    <div
      className={cn(
        'ue:flex ue:flex-col ue:gap-2 ue:rounded-md ue:border ue:px-3 ue:py-2 ue:text-footnote',
        managed ? 'ue:border-danger/40 ue:bg-danger/5' : 'ue:border-warning/40 ue:bg-warning/5',
      )}
    >
      <p className="ue:flex ue:items-start ue:gap-1.5 ue:text-fg">
        <CircleAlert
          className={cn('ue:mt-0.5 ue:h-3.5 ue:w-3.5 ue:shrink-0', managed ? 'ue:text-danger' : 'ue:text-warning')}
        />
        <span className="ue:min-w-0 ue:break-all">
          {managed
            ? t('已经有配置管着这个资产：{p}。两份配置写同一个资产会互相覆盖，换个资产路径，或去改那份配置。', {
                p: check.managedBy!,
              })
            : t(
                '这个资产已经存在，还没有配置。新配置导入时会按配置改写它；想保留现有内容，先把它「导出到 JSON」纳管，再在那份配置上改。',
              )}
        </span>
      </p>
      <div className="ue:flex ue:gap-2 ue:pl-5">
        {managed ? (
          <ui.Button size="sm" variant="secondary" onClick={() => onOpenConfig(check.managedBy!)}>
            <ExternalLink className="ue:h-3.5 ue:w-3.5" />
            {t('打开那份配置')}
          </ui.Button>
        ) : (
          <ui.Button size="sm" variant="secondary" onClick={onExport}>
            <Upload className="ue:h-3.5 ue:w-3.5" />
            {t('导出到 JSON 纳管')}
          </ui.Button>
        )}
      </div>
    </div>
  )
}
