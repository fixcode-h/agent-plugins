import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Badge, Card, Dot, WorldBadge, kindLabel, useTargetInfo, worldLabel } from '../../ui.tsx'

/** 实例列表（从原来的概览搬过来）：每个进程和它的世界，点一行设为目标 */
export function Instances() {
  const { state, setTarget, target } = useUe()
  const { cn } = h()
  const { inst } = useTargetInfo()
  const live = (state?.instances ?? []).filter((i) => i.kind !== 'background')
  return (
    <Card title={t('实例')} aside={t('点一行设为「目标」，控制台、GM、对象都对它操作')}>
      <ul className="ue:flex ue:flex-col ue:divide-y ue:divide-line">
        {live.flatMap((i) =>
          [
            {
              id: '',
              label: kindLabel(i.kind),
              badge: null,
              detail: `PID ${i.pid} · ${t('端口')} ${i.port}`,
            },
            ...i.worlds.map((w) => ({
              id: w.id,
              label: worldLabel(w),
              badge: <WorldBadge world={w} />,
              detail: [w.player, w.map].filter(Boolean).join(' · '),
            })),
          ].map((w) => {
            const on = inst?.pid === i.pid && (target.world ?? '') === w.id
            return (
              <li key={`${i.pid}|${w.id}`}>
                <button
                  type="button"
                  onClick={() => setTarget(i.pid, i.kind, w.id)}
                  className={cn(
                    'ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-3 ue:px-4 ue:py-2.5 ue:text-left ue:hover:bg-hover',
                    on && 'ue:bg-sel',
                    w.id && 'ue:pl-9',
                  )}
                >
                  <Dot tone={i.online ? 'ok' : 'danger'} />
                  <span className="ue:text-body ue:text-fg">{w.label}</span>
                  {w.badge}
                  <span className="ue:min-w-0 ue:truncate ue:text-footnote ue:text-subtle">
                    {i.online ? w.detail : i.error}
                  </span>
                  {on && (
                    <span className="ue:ml-auto">
                      <Badge tone="accent">{t('当前目标')}</Badge>
                    </span>
                  )}
                </button>
              </li>
            )
          }),
        )}
        <li className="ue:flex ue:items-center ue:gap-3 ue:px-4 ue:py-2.5 ue:text-footnote ue:text-subtle">
          <Dot />{' '}
          {live.length
            ? t('独立进程（-game / 专用服务器）启动后会出现在这里')
            : t('UE 没在运行。启动编辑器或游戏后，装了桥接插件的进程会自动出现在这里')}
        </li>
      </ul>
    </Card>
  )
}
