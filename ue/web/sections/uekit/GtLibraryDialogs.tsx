import { ArrowRight, TriangleAlert } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { h, t } from '../../host.ts'
import { Confirm } from '../../ui.tsx'
import type { DeletePlan, MovePlan } from './gt-library.ts'

/**
 * 场景库整理的三个弹窗（GtLibrary.tsx 用）：起名字（新建文件夹 / 脚本、改名）、移动前确认要跟着改的 call、删除前确认。
 * 都是共用的 Confirm（小号弹窗），列表超过一屏在框里滚动。
 */

/** 列表最多画几行：几百处 call 一次全画出来没用，后面的写个「还有 n 处」 */
const MAX_ROWS = 60

/** 框起来的滚动列表 */
function ListBox({ children, more }: { children: ReactNode; more: number }) {
  return (
    <div className="ue:flex ue:max-h-56 ue:flex-col ue:gap-0.5 ue:overflow-auto ue:rounded-(--c-row-radius) ue:bg-field ue:p-2 ue:font-mono ue:text-caption">
      {children}
      {more > 0 && <span className="ue:text-subtle">{t('…还有 {n} 处', { n: more })}</span>}
    </div>
  )
}

export function NameDialog({
  open,
  title,
  okText,
  initial,
  placeholder,
  note,
  validate,
  onOk,
  onCancel,
}: {
  open: boolean
  title: string
  okText: string
  initial?: string
  placeholder?: string
  note?: ReactNode
  /** 名字不能用时返回原因（脚本不许同名），弹窗里显示、不让确定 */
  validate?: (name: string) => string | undefined
  onOk: (name: string) => void
  onCancel: () => void
}) {
  const { ui } = h()
  const [name, setName] = useState(initial ?? '')
  // 每次打开换成这次的初值（同一个弹窗先后用来新建和改名）
  useEffect(() => {
    if (open) setName(initial ?? '')
  }, [open, initial])
  const error = name.trim() ? validate?.(name) : undefined
  const ok = () => name.trim() && !error && onOk(name.trim())
  return (
    <Confirm open={open} title={title} okText={okText} onOk={ok} onCancel={onCancel}>
      <div className="ue:flex ue:flex-col ue:gap-2">
        <ui.Input
          autoFocus
          value={name}
          placeholder={placeholder}
          onChange={(e: { target: { value: string } }) => setName(e.target.value)}
          onKeyDown={(e: { key: string }) => e.key === 'Enter' && ok()}
        />
        {error && <p className="ue:text-footnote ue:text-danger">{error}</p>}
        {note && <p className="ue:text-footnote ue:leading-relaxed ue:text-subtle">{note}</p>}
      </div>
    </Confirm>
  )
}

/** 移动 / 改名前：哪些 call 路径要跟着改（只有要改的时候才弹，没有就直接挪） */
export function MoveDialog({ plan, onOk, onCancel }: { plan?: MovePlan; onOk: () => void; onCancel: () => void }) {
  const refs = plan?.refs ?? []
  return (
    <Confirm
      open={!!plan}
      title={plan?.dir ? t('移动文件夹') : t('移动脚本')}
      okText={t('移动并改 {n} 处', { n: refs.length })}
      onOk={onOk}
      onCancel={onCancel}
    >
      <div className="ue:flex ue:flex-col ue:gap-2 ue:text-footnote ue:leading-relaxed">
        <p className="ue:flex ue:flex-wrap ue:items-center ue:gap-1 ue:text-fg">
          <code className="ue:font-mono">{plan?.path}</code>
          <ArrowRight className="ue:h-3 ue:w-3 ue:text-subtle" />
          <code className="ue:font-mono">{plan?.to}</code>
          {plan?.dir && <span className="ue:text-subtle">{t('（{n} 个脚本）', { n: plan.scripts })}</span>}
        </p>
        <p className="ue:text-subtle">
          {t('下面这些脚本在 call 被挪动的脚本，路径会跟着改成新的；运行历史也跟过去。')}
        </p>
        <ListBox more={refs.length - MAX_ROWS}>
          {refs.slice(0, MAX_ROWS).map((r) => (
            <div key={`${r.file}:${r.at}`} className="ue:flex ue:flex-col">
              <span className="ue:truncate ue:text-muted" title={`${r.file} · ${r.at}`}>
                {r.file}
              </span>
              <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1 ue:pl-3 ue:text-fg">
                <span className="ue:truncate ue:text-subtle ue:line-through">{r.from}</span>
                <ArrowRight className="ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle" />
                <span className="ue:truncate">{r.to}</span>
              </span>
            </div>
          ))}
        </ListBox>
      </div>
    </Confirm>
  )
}

/** 删除前：会删哪些脚本、谁还在 call 它们 */
export function DeleteDialog({
  plan,
  rootLabel,
  onOk,
  onCancel,
}: {
  plan?: DeletePlan
  rootLabel: string
  onOk: () => void
  onCancel: () => void
}) {
  const scripts = plan?.scripts ?? []
  const callers = plan?.callers ?? []
  return (
    <Confirm
      open={!!plan}
      danger
      title={plan?.dir ? t('删除文件夹') : t('删除脚本')}
      okText={t('删除')}
      onOk={onOk}
      onCancel={onCancel}
    >
      <div className="ue:flex ue:flex-col ue:gap-2 ue:text-footnote ue:leading-relaxed">
        <p className="ue:text-fg">
          {plan?.dir
            ? scripts.length
              ? t('删除 {root}/{p} 和里面的 {n} 个脚本？', { root: rootLabel, p: plan.path, n: scripts.length })
              : t('删除空文件夹 {root}/{p}？', { root: rootLabel, p: plan.path })
            : t('删除 {root}/{p}？', { root: rootLabel, p: plan?.path ?? '' })}
        </p>
        {plan?.dir && scripts.length > 0 && (
          <ListBox more={scripts.length - MAX_ROWS}>
            {scripts.slice(0, MAX_ROWS).map((s) => (
              <span key={s} className="ue:truncate ue:text-fg">
                {s}
              </span>
            ))}
          </ListBox>
        )}
        {callers.length > 0 && (
          <>
            <p className="ue:flex ue:items-start ue:gap-1.5 ue:text-warning">
              <TriangleAlert className="ue:mt-0.5 ue:h-3.5 ue:w-3.5 ue:shrink-0" />
              {t('还有 {n} 处在 call 要删的脚本，删了以后这些脚本运行到那一步会失败：', { n: callers.length })}
            </p>
            <ListBox more={callers.length - MAX_ROWS}>
              {callers.slice(0, MAX_ROWS).map((c) => (
                <span key={`${c.file}:${c.at}`} className="ue:truncate ue:text-fg" title={c.at}>
                  {c.file} <span className="ue:text-subtle">call {c.script}</span>
                </span>
              ))}
            </ListBox>
          </>
        )}
        <p className="ue:text-subtle">{t('文件直接从磁盘删掉，不进回收站；用 git、P4 管着的可以从版本库找回。')}</p>
      </div>
    </Confirm>
  )
}
