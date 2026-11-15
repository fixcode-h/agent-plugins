import { ArrowLeft, ArrowRight, Braces, ExternalLink } from 'lucide-react'
import { h, t } from '../../host.ts'
import { fmtTime } from '../../ui.tsx'
import { kindMeta } from './kinds.ts'

/**
 * 配置 → 资源关系条（设计稿 §2.2 第 2 条，共用组件）：一行写清「哪份配置生成哪个资源、现在谁新」。
 * 原来是两行路径文字，生成的资源在哪、在不在、谁改过都得自己拼（设计稿问题 5）。
 * 箭头方向跟同步方向走：资产被改过时反过来、用 accent 色（该把资产导出回配置）；配置改了等导入时用 warning 色。
 * 不取 UE 上下文，「在资源页打开」由调用方给回调，设置 →「组件」的示例也能直接画。
 */
export function ForgeLink({
  config,
  asset,
  kind,
  state,
  importedAt,
  onOpenAsset,
}: {
  config: string
  asset?: string
  kind?: string
  state: string
  /** 上次导入时间（ISO），forge.describe 有就给，没有就不显示 */
  importedAt?: string
  onOpenAsset?: () => void
}) {
  const { cn } = h()
  const k = kindMeta(kind)
  const absent = state === 'never-imported' || state === 'asset-missing'
  const back = state === 'asset-changed'
  const Arrow = back ? ArrowLeft : ArrowRight
  const arrowTone = back
    ? 'ue:text-accent-text'
    : state === 'config-changed' || state === 'pending'
      ? 'ue:text-warning'
      : 'ue:text-subtle'
  return (
    <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-2 ue:font-mono ue:text-caption">
      <Braces className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0', k.tone)} />
      <span className="ue:min-w-0 ue:shrink ue:truncate ue:text-muted" title={config}>
        {config}
      </span>
      <Arrow
        className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0', arrowTone)}
        aria-label={back ? t('资产比配置新') : t('导入方向')}
      />
      {asset ? (
        <>
          <k.icon className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0', absent ? 'ue:text-subtle' : k.tone)} />
          <span
            className={cn(
              'ue:min-w-0 ue:shrink ue:truncate',
              absent ? 'ue:text-subtle ue:underline ue:decoration-dashed ue:underline-offset-4' : 'ue:text-fg',
            )}
            title={asset}
          >
            {asset}
          </span>
          {absent ? (
            <span className="ue:shrink-0 ue:font-sans ue:text-subtle">{t('导入后生成')}</span>
          ) : (
            importedAt && (
              <span className="ue:shrink-0 ue:font-sans ue:text-subtle">
                {t('上次导入 {time}', { time: fmtTime(importedAt) })}
              </span>
            )
          )}
          {!absent && onOpenAsset && (
            <button
              type="button"
              className="ue:ml-auto ue:flex ue:shrink-0 ue:cursor-pointer ue:items-center ue:gap-1 ue:font-sans ue:text-accent-text ue:hover:underline"
              onClick={onOpenAsset}
            >
              {t('在资源页打开')}
              <ExternalLink className="ue:h-3 ue:w-3" />
            </button>
          )}
        </>
      ) : (
        <span className="ue:font-sans ue:text-danger">{t('配置里没写目标资产')}</span>
      )}
    </div>
  )
}

/** 资源页认对象路径（/Game/A/B.B），配置里写的是包路径 */
export function assetObjectPath(asset?: string) {
  if (!asset) return undefined
  return asset.includes('.') ? asset : `${asset}.${asset.split('/').pop()}`
}
