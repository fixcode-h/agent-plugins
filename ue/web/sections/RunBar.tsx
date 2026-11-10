import { ChevronDown, Hammer, Play, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { op, ppost, useAction } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { useLaunch } from '../launch.ts'

const NET = [
  { value: 'standalone', label: () => t('单机') },
  { value: 'listen', label: () => t('监听服务器') },
  { value: 'client', label: () => t('客户端') },
]

/**
 * 概览页头的运行控制（界面优化第 6 条）：PIE 开停连同玩家数、网络模式放成一组，
 * 编译收进一个下拉（普通编译、Live Coding、跳过检查强制编译），不再三个按钮并排看不出关系
 */
export function RunBar() {
  const { project, state, reload, go } = useUe()
  const { ui, cn, toast } = h()
  const { busy, run } = useAction()
  const launch = useLaunch()
  const [players, setPlayers] = useState('1')
  const [net, setNet] = useState('standalone')
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const editor = state?.instances.find((i) => i.kind === 'editor')
  const pieRunning = !!editor?.worlds.some((w) => w.type === 'PIE')

  // 点外面收起下拉
  useEffect(() => {
    if (!menu) return
    const off = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false)
    }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [menu])

  const pie = (action: 'start' | 'stop') =>
    run(`pie-${action}`, async () => {
      await op(
        project.id,
        'pie',
        action === 'start' ? { action, players: Number(players), netMode: net } : { action },
        { instance: 'editor' },
      )
      setTimeout(reload, 800)
    })
  const build = (force: boolean) =>
    run('build', async () => {
      setMenu(false)
      await ppost(project.id, 'build', force ? { force: true } : undefined)
      go('bridge')
    })
  const liveCoding = () =>
    run('lc', async () => {
      setMenu(false)
      await op(project.id, 'livecoding', {}, { instance: 'editor' }, 120000)
      toast.success(t('Live Coding 已开始'))
    })

  const item = (label: string, desc: string, onClick: () => void, disabled?: boolean) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="ue:flex ue:w-full ue:cursor-pointer ue:flex-col ue:rounded-md ue:px-2.5 ue:py-1.5 ue:text-left ue:hover:bg-hover ue:disabled:cursor-default ue:disabled:opacity-50"
    >
      <span className="ue:text-body ue:text-fg">{label}</span>
      <span className="ue:text-caption ue:text-subtle">{desc}</span>
    </button>
  )

  return (
    <>
      <div className="ue:relative" ref={menuRef}>
        <ui.Button size="sm" variant="secondary" disabled={busy === 'build'} onClick={() => setMenu((m) => !m)}>
          <Hammer className="ue:h-3.5 ue:w-3.5" /> {t('编译')} <ChevronDown className="ue:h-3 ue:w-3" />
        </ui.Button>
        {menu && (
          <div className="ue:absolute ue:right-0 ue:top-full ue:z-30 ue:mt-1 ue:flex ue:w-64 ue:flex-col ue:gap-0.5 ue:rounded-xl ue:border ue:border-line ue:bg-card ue:p-1 ue:shadow-pop">
            {item(t('编译项目'), t('含桥接插件；编辑器开着时会先提醒'), () => void build(false))}
            {item(
              'Live Coding',
              editor ? t('编辑器开着时只重编改过的 C++') : t('要先启动编辑器'),
              () => void liveCoding(),
              !editor,
            )}
            {item(t('强制编译'), t('跳过「编辑器开着」的检查，认错进程时用'), () => void build(true))}
          </div>
        )}
      </div>
      {editor ? (
        <div className="ue:flex ue:h-8 ue:items-center ue:rounded-lg ue:border ue:border-line">
          {!pieRunning && (
            <>
              <select
                aria-label={t('玩家数')}
                value={players}
                onChange={(e) => setPlayers(e.target.value)}
                className="ue:h-full ue:cursor-pointer ue:bg-transparent ue:pl-2 ue:text-footnote ue:text-muted ue:outline-none"
              >
                {['1', '2', '3', '4'].map((n) => (
                  <option key={n} value={n}>
                    {t('{n} 人', { n })}
                  </option>
                ))}
              </select>
              <select
                aria-label={t('网络模式')}
                value={net}
                onChange={(e) => setNet(e.target.value)}
                className="ue:h-full ue:cursor-pointer ue:border-l ue:border-line ue:bg-transparent ue:px-2 ue:text-footnote ue:text-muted ue:outline-none"
              >
                {NET.map((n) => (
                  <option key={n.value} value={n.value}>
                    {n.label()}
                  </option>
                ))}
              </select>
            </>
          )}
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void pie(pieRunning ? 'stop' : 'start')}
            className={cn(
              'ue:flex ue:h-full ue:cursor-pointer ue:items-center ue:gap-1.5 ue:rounded-r-lg ue:px-2.5 ue:text-body ue:disabled:opacity-50',
              pieRunning
                ? 'ue:rounded-l-lg ue:text-danger ue:hover:bg-hover'
                : 'ue:border-l ue:border-line ue:text-fg ue:hover:bg-hover',
            )}
          >
            {pieRunning ? <Square className="ue:h-3.5 ue:w-3.5" /> : <Play className="ue:h-3.5 ue:w-3.5" />}
            {pieRunning ? t('停止 PIE') : t('开始 PIE')}
          </button>
        </div>
      ) : (
        <ui.Button size="sm" disabled={launch.busy || !state?.bridge} onClick={() => void launch.start(false)}>
          <Play className="ue:h-3.5 ue:w-3.5" /> {t('启动编辑器')}
        </ui.Button>
      )}
    </>
  )
}
