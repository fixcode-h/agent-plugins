import { MessageSquarePlus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { Task } from '../../sdk/web.ts'
import { useUe } from './ctx.tsx'
import { h, t } from './host.ts'

/**
 * 「发给对话」（设计稿「界面优化」第 16 条）：属性、对象路径、日志行、截图说明交给对话里的 Agent。
 * 面板的 hooks.useToChat 把内容接进对话输入框的草稿再打开那个对话，用户看过再发；旧面板没有这个钩子时按钮不出现。
 * 这里先弹一个小窗选发给哪个对话：这个项目最近的几个，或者新对话
 */
const noop = () => () => undefined

export function useToChat() {
  const { project } = useUe()
  const { hooks } = h()
  const has = !!hooks.useToChat
  // 钩子有没有在面板加载后就不会变，条件调用不会打乱钩子顺序
  const toChat = (hooks.useToChat ?? noop)()
  const [text, setText] = useState<string>()
  const dialog =
    text !== undefined ? (
      <PickChat
        onClose={() => setText(undefined)}
        onPick={(taskId) => {
          toChat({ projectId: project.id, taskId, text })
          setText(undefined)
        }}
      />
    ) : null
  return { available: has, send: (s: string) => setText(s), dialog }
}

function PickChat({ onClose, onPick }: { onClose: () => void; onPick: (taskId?: string) => void }) {
  const { project } = useUe()
  const { ui, hooks, cn } = h()
  const { tasks } = hooks.useTasks() as { tasks: (Task & { updatedAt?: string })[] }
  const recent = tasks
    .filter((x) => x.projectId === project.id && !x.plugin)
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
    .slice(0, 8)
  const row = (key: string, label: ReactNode, sub: string, onClick: () => void) => (
    <li key={key}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'ue:flex ue:w-full ue:cursor-pointer ue:flex-col ue:rounded-lg ue:px-3 ue:py-2 ue:text-left ue:hover:bg-hover',
        )}
      >
        <span className="ue:flex ue:items-center ue:gap-2 ue:truncate ue:text-body ue:text-fg">{label}</span>
        <span className="ue:truncate ue:text-caption ue:text-subtle">{sub}</span>
      </button>
    </li>
  )
  return (
    <ui.Modal open onOpenChange={(o: boolean) => !o && onClose()} title={t('发给哪个对话')} size="sm">
      <p className="ue:mb-2 ue:text-footnote ue:text-subtle">
        {t('内容会放进那个对话的输入框，不会直接发出去，你看过再发。')}
      </p>
      <ul className="ue:flex ue:flex-col ue:gap-0.5">
        {row(
          'new',
          <>
            <MessageSquarePlus className="ue:h-4 ue:w-4 ue:text-subtle" /> {t('新对话')}
          </>,
          project.name,
          () => onPick(undefined),
        )}
        {recent.map((x) =>
          row(x.id, x.title || t('（没有标题）'), x.status === 'running' ? t('进行中') : t('最近的对话'), () =>
            onPick(x.id),
          ),
        )}
      </ul>
    </ui.Modal>
  )
}
