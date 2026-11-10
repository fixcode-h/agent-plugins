import { Hammer, Zap } from 'lucide-react'
import type { Job } from '../../server/types.ts'
import { op } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Note } from '../ui.tsx'

/**
 * 编译被开着的编辑器挡住时（Live Coding 拒绝编译）的说明和处理方式，放在编译输出上面。
 * 「用 Live Coding 编译」只在编辑器里已经连上桥接时给：桥接没加载时 Live Coding 编不了这个插件（它只更新已加载的模块）。
 */
export function BuildHint({
  hint,
  busy,
  onBuild,
}: {
  hint: NonNullable<Job['hint']>
  busy: boolean
  onBuild: (force: boolean) => void
}) {
  const { project, state } = useUe()
  const { ui, toast } = h()
  const editorOnline = (state?.instances ?? []).some((i) => i.kind === 'editor' && i.online)
  const precheck = hint.blockers.length > 0

  return (
    <Note>
      <div className="ue:flex ue:flex-col ue:gap-2">
        <div className="ue:font-medium">{t('UE 编辑器开着，引擎拒绝编译')}</div>
        <div className="ue:text-subtle">
          {precheck
            ? t('这个引擎的编辑器还开着（{list}），这次没有开始编译。', {
                list: hint.blockers
                  .map((b) => `PID ${b.pid}${b.project ? ` · ${b.same ? t('本项目') : b.project}` : ''}`)
                  .join('、'),
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
          <ui.Button size="sm" disabled={busy} onClick={() => onBuild(false)}>
            <Hammer className="ue:h-3.5 ue:w-3.5" /> {t('已关掉编辑器，重新编译')}
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
            <ui.Button size="sm" variant="ghost" disabled={busy} onClick={() => onBuild(true)}>
              {t('不检查，仍然编译')}
            </ui.Button>
          )}
        </div>
      </div>
    </Note>
  )
}
