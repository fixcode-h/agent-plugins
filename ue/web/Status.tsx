import { RefreshCw } from 'lucide-react'
import type { PluginConfig } from '../../sdk/server.ts'
import { h, t } from './host.ts'
import { canUpgrade } from '../server/semver.ts'

interface S {
  projects?: number
  running?: number
  items?: { name: string; engine: string; bridge: string; bundled: string; instances: number }[]
  error?: string
}

/** 设置 → 插件页上参数表单下面的运行状态（图 8）：接入了几个项目、各自的桥接版本和运行中的进程 */
export function Status({
  status,
  reload,
}: {
  status: Record<string, unknown> | undefined
  config: PluginConfig
  reload: () => void
}) {
  const { ui, hooks } = h()
  const nav = hooks.useNav()
  const s = status as S | undefined
  return (
    <section aria-label={t('运行状态')} className="ue:flex ue:flex-col ue:gap-2">
      <div className="ue:flex ue:items-center ue:gap-2">
        <span className="ue:text-footnote ue:text-subtle">{t('运行状态')}</span>
        <ui.IconButton icon={RefreshCw} label={t('刷新')} size="2xs" className="ue:ml-auto" onClick={reload} />
      </div>
      {s?.error && <p className="ue:text-footnote ue:text-danger">{s.error}</p>}
      {!s && <p className="ue:text-footnote ue:text-subtle">{t('检测中…')}</p>}
      <ul className="ue:flex ue:flex-col ue:divide-y ue:divide-line ue:border ue:border-line ue:bg-card">
        {(s?.items ?? []).map((p) => (
          <li key={p.name} className="ue:flex ue:items-center ue:gap-3 ue:px-3.5 ue:py-2.5">
            <div className="ue:min-w-0 ue:flex-1">
              <div className="ue:text-body ue:text-fg">{p.name}</div>
              <div className="ue:text-footnote ue:text-subtle">
                UE {p.engine} · {p.bridge ? t('桥接 {v}', { v: p.bridge }) : t('没装桥接')}
                {canUpgrade(p.bridge, p.bundled) ? ` · ${t('可升级到 {v}', { v: p.bundled })}` : ''}
              </div>
            </div>
            <span className="ue:text-body ue:text-muted">
              {p.instances ? t('{n} 个进程', { n: p.instances }) : t('未运行')}
            </span>
          </li>
        ))}
        <li className="ue:flex ue:items-center ue:gap-3 ue:px-3.5 ue:py-2.5">
          <div className="ue:min-w-0 ue:flex-1 ue:text-footnote ue:text-subtle">
            {s?.projects ? t('项目、桥接安装和 Agent 权限在 UE 页里管理') : t('还没有接入 UE 项目')}
          </div>
          <ui.Button size="sm" variant="secondary" onClick={() => nav.go({ page: 'plugin', id: 'ue', sub: 'main' })}>
            {t('打开 UE 页')}
          </ui.Button>
        </li>
      </ul>
    </section>
  )
}
