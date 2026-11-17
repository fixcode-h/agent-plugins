import { runPromptInProject } from '@panel/web/src/lib/assist-conv'
import { Sparkles, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ppost } from '../../api.ts'
import { h, t } from '../../host.ts'
import { Confirm } from '../../ui.tsx'
import { parseTidyPlan, tidyBlockOf } from '../../../server/uekit/gt-tidy-plan.ts'
import { tidyPrompt, type TidySource } from './gt-tidy-prompt.ts'

/**
 * GameTest 页「AI 整理」（2026-11-16 用户提，2026-11-17 改成 AI 分析对话）：录制交给 Agent 看截图、读项目代码，
 * 给出以原步骤为基准的改动列表和每步说明。流程：写一句这份测试要验证什么 → 在项目里开一个 AI 分析对话 →
 * Agent 回复里的 gametest-tidy 代码块画在对话右侧的应用面板（GtTidyReport.tsx），逐条勾选后写回场景，原录制备份成 .json.bak。
 */
export function useGtTidy(o: { project: string; root: string; path: string; name: string; onSaved: () => void }) {
  const { toast } = h()
  const [backup, setBackup] = useState('')
  const [asking, setAsking] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const call = <T,>(action: string, extra: Record<string, unknown> = {}) =>
    ppost<T>(o.project, 'ext/gt/tidy', { root: o.root, path: o.path, action, ...extra })

  const refresh = () =>
    void call<{ backup: string }>('status')
      .then((r) => setBackup(r.backup))
      .catch(() => undefined)
  useEffect(() => {
    if (!o.root) return
    refresh()
    // 应用面板在别的窗口里写回场景：回到这页时重看有没有备份
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
    // 换场景时重看；refresh 每次渲染都是新函数
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [o.project, o.root, o.path])

  const send = (need: string) => {
    setAsking(false)
    let steps = 0
    runPromptInProject({
      projectId: o.project,
      title: t('AI 整理录制：{name}', { name: o.name }),
      prompt: async () => {
        const src = await call<TidySource>('source')
        steps = src.steps.length
        return tidyPrompt(src, need)
      },
      // 记成 run：右侧不画面板自己的项目设置，按回复里的 gametest-tidy 代码块画本插件的应用面板（web/index.tsx 的 reports）
      analysis: 'run',
      resolve: async (reply) => {
        const block = tidyBlockOf(reply)
        if (!block) return { error: '回复里没有 gametest-tidy 代码块：按提示词第 5 条的格式给出整理方案' }
        try {
          parseTidyPlan(JSON.parse(block), steps)
        } catch (e) {
          return { error: `gametest-tidy 代码块不对：${(e as Error).message}` }
        }
        toast.success(t('AI 整理好了：在分析窗口右侧逐条勾选，应用后写回场景'))
        return {}
      },
    })
  }

  const restore = async () => {
    setRestoring(false)
    try {
      await call('restore')
      toast.success(t('已恢复成原录制'))
      refresh()
      o.onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const dialogs = (
    <>
      {asking && <TidyAsk onClose={() => setAsking(false)} onSend={send} />}
      <Confirm
        open={restoring}
        danger
        title={t('恢复成原录制')}
        okText={t('恢复')}
        onOk={() => void restore()}
        onCancel={() => setRestoring(false)}
      >
        {t('用备份 {b} 盖回场景文件，整理过的步骤和说明都会丢掉（用 git、P4 管着的可以从版本库找回）。', {
          b: backup,
        })}
      </Confirm>
    </>
  )

  return {
    hasBackup: !!backup,
    ask: () => setAsking(true),
    restore: () => setRestoring(true),
    dialogs,
  }
}

/** 交给 Agent 前问一句：这份测试要验证什么（可以不填，Agent 按录制自己判断） */
function TidyAsk({ onClose, onSend }: { onClose: () => void; onSend: (need: string) => void }) {
  const { ui } = h()
  const [need, setNeed] = useState('')
  return (
    <ui.Modal
      open
      onOpenChange={(v: boolean) => !v && onClose()}
      title={t('AI 整理录制')}
      footer={
        <>
          <span className="ue:flex-1" />
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          <ui.Button onClick={() => onSend(need)}>
            <Sparkles className="ue:h-3.5 ue:w-3.5" />
            {t('开始分析')}
          </ui.Button>
        </>
      }
    >
      <div className="ue:flex ue:flex-col ue:gap-3">
        <p className="ue:text-footnote ue:leading-relaxed ue:text-subtle">
          {t(
            'Agent 会看录制截图、读项目里界面和点击处理的代码，判断每一步合不合理：去掉重复点击、误按和多余的等待，给每一步写中文说明，代码里看出的问题单独列出来。结果在分析窗口右侧逐条勾选，应用后才改场景文件，原录制会备份。',
          )}
        </p>
        <ui.Field label={t('这份测试要验证什么')} hint={t('可以不填：Agent 按录制自己判断哪些步骤有用')}>
          <ui.Textarea
            rows={3}
            value={need}
            placeholder={t('例如：用 GM 加一件道具，确认背包里出现它')}
            onChange={(e: { target: { value: string } }) => setNeed(e.target.value)}
          />
        </ui.Field>
      </div>
    </ui.Modal>
  )
}

/** 场景页头的两个按钮：AI 整理、恢复成原录制（有备份时） */
export function TidyButtons({ tidy, disabled }: { tidy: ReturnType<typeof useGtTidy>; disabled?: boolean }) {
  const { ui } = h()
  return (
    <>
      <ui.IconButton
        icon={Sparkles}
        size="sm"
        label={t('AI 整理：Agent 看截图、读项目代码优化步骤，每步写中文说明；逐条确认后再写回')}
        disabled={disabled}
        onClick={tidy.ask}
      />
      {tidy.hasBackup && (
        <ui.IconButton
          icon={Undo2}
          size="sm"
          label={t('恢复成原录制（AI 整理前的备份）')}
          disabled={disabled}
          onClick={tidy.restore}
        />
      )}
    </>
  )
}
