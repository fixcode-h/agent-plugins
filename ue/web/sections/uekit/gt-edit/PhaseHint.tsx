import { Lightbulb } from 'lucide-react'
import { cleanupRun, moveToPhase, precheckRun, type GtScript } from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'

/**
 * 执行段里混进了准备 / 收尾：在执行段顶上提一句并给一键挪过去的按钮（和服务端写法检查 style_precheck_in_steps /
 * style_cleanup_in_steps 用同一份判断，shared/gt-script/phase-hints.ts）
 */
export function PhaseHint({ doc, onChange }: { doc: GtScript; onChange: (d: GtScript) => void }) {
  const pre = precheckRun(doc)
  const post = cleanupRun(doc)
  if (!pre && !post) return null
  return (
    <div className="ue:flex ue:flex-col ue:gap-1 ue:px-3 ue:py-1.5">
      {pre > 0 && (
        <Line
          text={t(
            '开头 {n} 步只是在准备和检查前置，还没开始玩：放到「执行前」，缺配置时会报「前置不满足」而不是测试失败',
            { n: pre },
          )}
          action={t('挪到执行前')}
          onClick={() => onChange(moveToPhase(doc, 'setup', pre))}
        />
      )}
      {post > 0 && (
        <Line
          text={t('末尾 {n} 步是在收拾现场：放到「执行后」，失败、按停止也会做', { n: post })}
          action={t('挪到执行后')}
          onClick={() => onChange(moveToPhase(doc, 'teardown', post))}
        />
      )}
    </div>
  )
}

function Line({ text, action, onClick }: { text: string; action: string; onClick: () => void }) {
  return (
    <div
      data-gt-phase-hint
      className="ue:flex ue:min-w-0 ue:items-center ue:gap-2 ue:rounded-md ue:bg-warning/10 ue:px-2.5 ue:py-1.5 ue:text-caption ue:text-warning"
    >
      <Lightbulb className="ue:h-3.5 ue:w-3.5 ue:shrink-0" />
      <span className="ue:min-w-0 ue:flex-1">{text}</span>
      <button
        type="button"
        onClick={onClick}
        className="ue:shrink-0 ue:cursor-pointer ue:rounded-sm ue:bg-card ue:px-2 ue:py-0.5 ue:text-fg ue:shadow-card ue:hover:bg-hover"
      >
        {action}
      </button>
    </div>
  )
}
