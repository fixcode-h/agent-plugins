import { Check, Download, Loader2, PackagePlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { h, t } from './host.ts'
import type { AddonTarget } from './types.ts'

/**
 * 运行状态里「Blender 扩展」这一行：一键把 DSH Blender Bridge 装进本机 Blender。
 * 能装的版本只有一个时直接装；有几个时弹窗让用户选装到哪个；一个都没找到时退回原来的下载、手动从磁盘安装。
 * 下载一直留着（图标按钮），给装在别处的 Blender 用。
 */
export function AddonRow({ refresh }: { refresh: number }) {
  const { api, toast } = h()
  const [targets, setTargets] = useState<AddonTarget[] | undefined>()
  const [busy, setBusy] = useState('')
  const [picking, setPicking] = useState(false)

  const load = () =>
    api
      .get<AddonTarget[]>('/addon/targets')
      .then(setTargets)
      .catch(() => setTargets([]))
  // 运行状态点「刷新」时一起重新找（refresh 变了），load 每次渲染都是新函数，不放进依赖
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void load(), [refresh])

  const usable = (targets ?? []).filter((x) => x.supported)
  const installedIn = usable.filter((x) => x.installed)

  async function install(version: string) {
    setBusy(version)
    try {
      const r = await api.post<{ version: string; installed: string; enabled: boolean }>('/addon/install', { version })
      toast.success(
        r.enabled
          ? t('已装进 Blender {version}。Blender 开着的话重启一下，再在 N 面板「DSH Blender Bridge」里点连接', {
              version: r.version,
            })
          : t('已复制到 Blender {version} 的扩展目录。启动 Blender 后在「偏好设置 → 扩展」里勾选启用', {
              version: r.version,
            }),
      )
      setPicking(false)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const desc = !targets
    ? t('正在找本机的 Blender…')
    : !usable.length
      ? t('没找到 Blender 4.2 以上的版本：下载后在 Blender 的「偏好设置 → 获取扩展 → 从磁盘安装」装上')
      : installedIn.length
        ? t('已装进 {list}，在 N 面板「DSH Blender Bridge」里点连接', {
            list: installedIn.map((x) => `Blender ${x.version}`).join(h().lang().startsWith('zh') ? '、' : ', '),
          })
        : t('装进本机 Blender 后，在 N 面板「DSH Blender Bridge」里点连接')

  return (
    <li className="bl:flex bl:items-start bl:gap-3 bl:px-3.5 bl:py-2.5">
      <div className="bl:min-w-0 bl:flex-1">
        <div className="bl:text-body bl:text-fg">{t('Blender 扩展')}</div>
        <div className="bl:mt-0.5 bl:text-footnote bl:text-subtle">{desc}</div>
      </div>
      <div className="bl:flex bl:shrink-0 bl:items-center bl:gap-1">
        <a
          href={api.url('/addon.zip')}
          download="dsh_blender_bridge.zip"
          aria-label={t('下载安装包')}
          title={t('下载安装包')}
          className={
            usable.length
              ? 'bl:grid bl:h-7 bl:w-7 bl:place-items-center bl:rounded-md bl:text-muted bl:hover:bg-hover bl:hover:text-fg'
              : 'bl:flex bl:items-center bl:gap-1.5 bl:rounded-md bl:px-2 bl:py-1 bl:text-body bl:text-accent-text bl:hover:bg-hover'
          }
        >
          <Download className="bl:h-3.5 bl:w-3.5" />
          {!usable.length && t('下载')}
        </a>
        {usable.length > 0 && (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => (usable.length === 1 ? void install(usable[0].version) : setPicking(true))}
            className="bl:flex bl:items-center bl:gap-1.5 bl:rounded-md bl:px-2 bl:py-1 bl:text-body bl:text-accent-text bl:hover:bg-hover bl:disabled:opacity-50"
          >
            {busy && !picking ? (
              <Loader2 className="bl:h-3.5 bl:w-3.5 bl:animate-spin" />
            ) : (
              <PackagePlus className="bl:h-3.5 bl:w-3.5" />
            )}
            {installedIn.length ? t('重新安装') : t('安装到 Blender')}
          </button>
        )}
      </div>
      {picking && (
        <PickDialog
          targets={targets ?? []}
          busy={busy}
          onInstall={install}
          onClose={() => !busy && setPicking(false)}
        />
      )}
    </li>
  )
}

/** 找到多个 Blender 版本时选装到哪个；不够 4.2 的列出来但不能选 */
function PickDialog({
  targets,
  busy,
  onInstall,
  onClose,
}: {
  targets: AddonTarget[]
  busy: string
  onInstall: (version: string) => void
  onClose: () => void
}) {
  const { ui, cn } = h()
  // 默认选最新的、找到了程序的版本：用 Blender 自己装会顺带启用，只复制到配置目录的还要用户手动勾选
  const [pick, setPick] = useState(
    () => (targets.find((x) => x.supported && x.exe) ?? targets.find((x) => x.supported))?.version ?? '',
  )
  return (
    <ui.Modal
      open
      size="sm"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('装到哪个 Blender')}
      footer={
        <>
          <ui.Button variant="secondary" className="bl:ml-auto" disabled={!!busy} onClick={onClose}>
            {t('取消')}
          </ui.Button>
          <ui.Button disabled={!pick || !!busy} onClick={() => onInstall(pick)}>
            {busy ? (
              <Loader2 className="bl:h-3.5 bl:w-3.5 bl:animate-spin" />
            ) : (
              <PackagePlus className="bl:h-3.5 bl:w-3.5" />
            )}
            {t('安装')}
          </ui.Button>
        </>
      }
    >
      <p className="bl:text-footnote bl:text-subtle">
        {t('本机找到了几个 Blender 版本，扩展按版本分开装。Blender 开着的话，装完重启一下才看得到。')}
      </p>
      <div role="radiogroup" aria-label={t('Blender 版本')} className="bl:mt-3 bl:flex bl:flex-col bl:gap-1.5">
        {targets.map((x) => {
          const on = pick === x.version
          return (
            <button
              key={x.version}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!x.supported || !!busy}
              onClick={() => setPick(x.version)}
              className={cn(
                'bl:flex bl:items-start bl:gap-2.5 bl:rounded-lg bl:border bl:px-3 bl:py-2 bl:text-left bl:transition-colors',
                on ? 'bl:border-accent bl:bg-accent-soft' : 'bl:border-line bl:hover:bg-hover',
                !x.supported && 'bl:cursor-not-allowed bl:opacity-50 bl:hover:bg-transparent',
              )}
            >
              <span
                className={cn(
                  'bl:mt-0.5 bl:grid bl:h-4 bl:w-4 bl:shrink-0 bl:place-items-center bl:rounded-full bl:border',
                  on ? 'bl:border-accent bl:bg-accent bl:text-on-accent' : 'bl:border-line-strong',
                )}
              >
                {on && <Check className="bl:h-2.5 bl:w-2.5" strokeWidth={3} />}
              </span>
              <span className="bl:min-w-0 bl:flex-1">
                <span className="bl:flex bl:items-center bl:gap-2">
                  <span className="bl:text-body bl:font-medium bl:text-fg">Blender {x.version}</span>
                  {x.installed && (
                    <span className="bl:rounded bl:bg-hover bl:px-1.5 bl:text-caption bl:text-subtle">
                      {t('已装 {version}', { version: x.installed })}
                    </span>
                  )}
                </span>
                <span className="bl:mt-0.5 bl:block bl:text-footnote bl:break-all bl:text-subtle">
                  {!x.supported
                    ? t('需要 4.2 或更新的版本')
                    : x.exe || t('没找到程序，只复制到配置目录：{dir}', { dir: x.configDir })}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </ui.Modal>
  )
}
