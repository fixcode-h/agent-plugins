import { Hammer, Power, Zap } from 'lucide-react'
import { useState } from 'react'
import type { Job } from '../../server/types.ts'
import { op } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Confirm, Note } from '../ui.tsx'

/**
 * 编译被开着的编辑器挡住时（Live Coding 拒绝编译）的说明和处理方式，放在编译输出上面。
 * 「用 Live Coding 编译」只在编辑器里已经连上桥接时给：桥接没加载时 Live Coding 编不了这个插件（它只更新已加载的模块）。
 * 「强制关掉编辑器并编译」由面板结束这个引擎的编辑器进程再编，先确认：编辑器里没保存的改动会丢。
 */
export function BuildHint({
  hint,
  busy,
  onBuild,
}: {
  hint: NonNullable<Job['hint']>
  busy: boolean
  onBuild: (mode: 'normal' | 'force' | 'kill') => void
}) {
  const [confirmKill, setConfirmKill] = useState(false)
  const { project, state } = useUe()
  const { ui, toast } = h()
  const editorOnline = (state?.instances ?? []).some((i) => i.kind === 'editor' && i.online)
  const precheck = hint.blockers.length > 0
  const who = hint.blockers
    .map((b) => `PID ${b.pid}${b.project ? ` · ${b.same ? t('本项目') : b.project}` : ''}`)
    .join('、')

  return (
    <Note>
      <div className="ue:flex ue:flex-col ue:gap-2">
        <div className="ue:font-medium">{t('UE 编辑器开着，引擎拒绝编译')}</div>
        <div className="ue:text-subtle">
          {precheck
            ? t('这个引擎的编辑器还开着（{list}），这次没有开始编译。', {
                list: who,
              })
            : t('编辑器启用了 Live Coding，Build.bat 看到后直接退出了。')}{' '}
          {t('关掉编辑器再编译最稳；桥接插件是这次新装或升级的，只能这样，编完重新打开编辑器就会加载。')}
        </div>
        {editorOnline && (
          <div className="ue:text-subtle">
            {t('编辑器里已经连上桥接，只改了它已加载模块的代码时，也可以直接用 Live Coding 编译，不用关编辑器。')}
          </div>
        )}
        <div className="ue:flex ue:flex-wrap ue:gap-2">
          <ui.Button size="sm" disabled={busy} onClick={() => onBuild('normal')}>
            <Hammer className="ue:h-3.5 ue:w-3.5" /> {t('已关掉编辑器，重新编译')}
          </ui.Button>
          <ui.Button size="sm" variant="danger-outline" disabled={busy} onClick={() => setConfirmKill(true)}>
            <Power className="ue:h-3.5 ue:w-3.5" /> {t('强制关掉编辑器并编译')}
          </ui.Button>
          {editorOnline && (
            <ui.Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void op(project.id, 'livecoding', {}, { instance: 'editor' }, 120000).then(
                  () => toast.success(t('Live Coding 已开始，进度看编辑器里的 Live Coding 窗口')),
                  (e: Error) => toast.error(e.message),
                )
              }
            >
              <Zap className="ue:h-3.5 ue:w-3.5" /> {t('用 Live Coding 编译')}
            </ui.Button>
          )}
          {precheck && (
            <ui.Button size="sm" variant="ghost" disabled={busy} onClick={() => onBuild('force')}>
              {t('不检查，仍然编译')}
            </ui.Button>
          )}
        </div>
      </div>
      <Confirm
        open={confirmKill}
        title={t('强制关掉编辑器并编译？')}
        okText={t('强制关掉并编译')}
        danger
        onCancel={() => setConfirmKill(false)}
        onOk={() => {
          setConfirmKill(false)
          onBuild('kill')
        }}
      >
        {precheck
          ? t('会直接结束这些编辑器进程：{list}。', { list: who })
          : t('会直接结束这个引擎开着的所有编辑器（包括开着别的项目的），以及还占着 Live Coding 的进程。')}{' '}
        {t('编辑器里没保存的改动会丢，要留的先回编辑器保存。结束后马上开始编译，编完重新打开编辑器。')}
      </Confirm>
    </Note>
  )
}
