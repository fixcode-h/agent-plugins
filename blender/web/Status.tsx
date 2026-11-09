import { Download, RefreshCw } from 'lucide-react'
import type { PluginConfig } from '../../sdk/server.ts'
import { h, t } from './host.ts'
import type { PluginStatus } from './types.ts'

/**
 * 插件页上参数表单下面的运行状态：Blender 找没找到、Gateway 在不在跑，
 * 和 Blender 端扩展（DSH Blender Bridge）的下载。参数改了插件会重启，刷新一下就能看到新状态
 */
export function Status({
  status,
  reload,
}: {
  status: Record<string, unknown> | undefined
  config: PluginConfig
  reload: () => void
}) {
  const { cn, ui, api } = h()
  const { IconButton } = ui
  const s = status as PluginStatus | undefined
  const rows: { title: string; value: string; desc?: string; bad?: boolean }[] = s
    ? [
        {
          title: 'Blender',
          value: s.blenderError ? t('没有找到') : `Blender ${s.blenderVersion ?? ''}`.trim(),
          desc: s.blenderError || s.blenderPath,
          bad: !!s.blenderError,
        },
        {
          title: 'Gateway',
          value: s.gatewayRunning
            ? t('运行中 · 端口 {port}', { port: s.gatewayPort ?? 0 })
            : s.gatewayPort
              ? t('没有响应 · 端口 {port}', { port: s.gatewayPort })
              : t('未启动'),
          desc: s.gatewayError || (s.gatewayRunning ? '' : t('第一次调用 Blender 工具时会自动启动')),
          bad: !!s.gatewayError,
        },
      ]
    : []
  return (
    <section aria-label={t('运行状态')} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-footnote text-subtle">{t('运行状态')}</span>
        <IconButton icon={RefreshCw} label={t('刷新')} size="2xs" className="ml-auto" onClick={reload} />
      </div>
      {s?.error && <p className="text-footnote text-danger">{s.error}</p>}
      {!s && <p className="text-footnote text-subtle">{t('检测中…')}</p>}
      <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-card">
        {rows.map((r) => (
          <li key={r.title} className="flex items-start gap-3 px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-body text-fg">{r.title}</div>
              {r.desc && (
                <div className={cn('mt-0.5 text-footnote break-all', r.bad ? 'text-danger' : 'text-subtle')}>
                  {r.desc}
                </div>
              )}
            </div>
            <span className={cn('shrink-0 text-body', r.bad ? 'text-subtle' : 'font-medium text-fg')}>{r.value}</span>
          </li>
        ))}
        <li className="flex items-start gap-3 px-3.5 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-body text-fg">{t('Blender 扩展')}</div>
            <div className="mt-0.5 text-footnote text-subtle">
              {t('在 Blender 的「偏好设置 → 获取扩展 → 从磁盘安装」装上，再在 N 面板「DSH Blender Bridge」里点连接')}
            </div>
          </div>
          <a
            href={api.url('/addon.zip')}
            download="dsh_blender_bridge.zip"
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-body text-accent-text hover:bg-hover"
          >
            <Download className="h-3.5 w-3.5" />
            {t('下载')}
          </a>
        </li>
      </ul>
    </section>
  )
}
