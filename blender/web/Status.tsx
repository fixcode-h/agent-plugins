import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import type { PluginConfig } from '../../sdk/server.ts'
import { AddonRow } from './AddonRow.tsx'
import { h, t } from './host.ts'
import type { PluginStatus } from './types.ts'

/**
 * 插件页上参数表单下面的运行状态：Blender 找没找到、Gateway 在不在跑，
 * 和 Blender 端扩展（DSH Blender Bridge）的一键安装 / 下载。参数改了插件会重启，刷新一下就能看到新状态
 */
export function Status({
  status,
  reload,
}: {
  status: Record<string, unknown> | undefined
  config: PluginConfig
  reload: () => void
}) {
  const { cn, ui } = h()
  // 点「刷新」时扩展那一行也重新找 Blender
  const [refresh, setRefresh] = useState(0)
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
    <section aria-label={t('运行状态')} className="bl:flex bl:flex-col bl:gap-2">
      <div className="bl:flex bl:items-center bl:gap-2">
        <span className="bl:text-footnote bl:text-subtle">{t('运行状态')}</span>
        <IconButton
          icon={RefreshCw}
          label={t('刷新')}
          size="2xs"
          className="bl:ml-auto"
          onClick={() => {
            reload()
            setRefresh((n) => n + 1)
          }}
        />
      </div>
      {s?.error && <p className="bl:text-footnote bl:text-danger">{s.error}</p>}
      {!s && <p className="bl:text-footnote bl:text-subtle">{t('检测中…')}</p>}
      <ul className="bl:flex bl:flex-col bl:divide-y bl:divide-line bl:rounded-xl bl:border bl:border-line bl:bg-card">
        {rows.map((r) => (
          <li key={r.title} className="bl:flex bl:items-start bl:gap-3 bl:px-3.5 bl:py-2.5">
            <div className="bl:min-w-0 bl:flex-1">
              <div className="bl:text-body bl:text-fg">{r.title}</div>
              {r.desc && (
                <div
                  className={cn('bl:mt-0.5 bl:text-footnote bl:break-all', r.bad ? 'bl:text-danger' : 'bl:text-subtle')}
                >
                  {r.desc}
                </div>
              )}
            </div>
            <span className={cn('bl:shrink-0 bl:text-body', r.bad ? 'bl:text-subtle' : 'bl:font-medium bl:text-fg')}>
              {r.value}
            </span>
          </li>
        ))}
        <AddonRow refresh={refresh} />
      </ul>
    </section>
  )
}
