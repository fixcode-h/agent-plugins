import { Check, ChevronDown, CircleDot, FlaskConical, Gamepad2, Loader2, Pencil, Play, PlayCircle } from 'lucide-react'
import { h, t } from '../../../host.ts'
import { openMenuAt } from '../../../menu.tsx'
import { kindLabel, useTargetInfo, worldLabel } from '../../../ui.tsx'
import type { ViewDef } from './views.ts'

/**
 * 编辑页顶栏（效果图 1）：左边面包屑（GameTest / 文件夹 / 脚本名 + 编写或录制的标签），
 * 右边依次是「编写 / 录制」、视图切换、目标（PIE · 客户端 0）、保存状态、「试这个节点」、「运行」。
 * 只管摆放和点击，动作都由外壳（GtEditor）给
 */
export function EditorHeader({
  name,
  folder,
  recorded,
  onBack,
  views,
  view,
  onView,
  onRecord,
  dirty,
  saving,
  onSave,
  onTry,
  onRun,
  onRunFrom,
  running,
}: {
  name: string
  /** 场景所在文件夹（相对场景根），根下的为空 */
  folder: string
  /** 录制出来的脚本（tags 含 recorded） */
  recorded: boolean
  onBack: () => void
  views: ViewDef[]
  view: string
  onView: (id: string) => void
  /** 开始录制（编辑器没连上、正在跑时不给） */
  onRecord?: () => void
  dirty: boolean
  saving: boolean
  onSave: () => void
  /** 试选中的这一步（没选、没连编辑器时不给） */
  onTry?: () => void
  /** 跑整个脚本（会先存盘） */
  onRun?: () => void
  /** 从选中的那一步跑到底（选中的是主流程的一步时才有） */
  onRunFrom?: () => void
  running: boolean
}) {
  const { ui, cn } = h()
  const { inst, world } = useTargetInfo()
  const w = world ?? inst?.worlds.find((x) => x.type === 'PIE') ?? inst?.worlds[0]
  const target = inst ? (w ? worldLabel(w) : kindLabel(inst.kind)) : t('编辑器没连上')
  return (
    <header className="ue:flex ue:min-h-12 ue:flex-wrap ue:items-center ue:gap-x-3 ue:gap-y-2 ue:border-b ue:border-line ue:px-4 ue:py-2">
      <nav aria-label={t('位置')} className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:text-body">
        <button
          type="button"
          title={t('回到运行结果')}
          onClick={onBack}
          className="ue:flex ue:shrink-0 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:font-mono ue:text-muted ue:hover:text-fg"
        >
          <FlaskConical className="ue:h-3.5 ue:w-3.5" />
          GameTest
        </button>
        {folder
          .split('/')
          .filter(Boolean)
          .map((f, i) => (
            <span key={i} className="ue:flex ue:shrink-0 ue:items-center ue:gap-1.5 ue:font-mono ue:text-muted">
              <span className="ue:text-subtle">/</span>
              {f}
            </span>
          ))}
        <span className="ue:text-subtle">/</span>
        <span className="ue:truncate ue:text-heading ue:font-semibold ue:text-fg">{name}</span>
        <span
          className={cn(
            'ue:shrink-0 ue:rounded-(--c-badge-radius) ue:px-1.5 ue:text-caption',
            recorded ? 'ue:bg-danger/10 ue:text-danger' : 'ue:bg-accent-soft ue:text-accent-text',
          )}
        >
          {recorded ? t('录制') : t('编写')}
        </span>
      </nav>
      <div className="ue:ml-auto ue:flex ue:flex-wrap ue:items-center ue:justify-end ue:gap-2">
        <ui.Segmented
          size="sm"
          label={t('编写 / 录制')}
          value="edit"
          onChange={(v: string) => v === 'record' && onRecord?.()}
          options={[
            { id: 'edit', label: t('编写'), icon: Pencil },
            { id: 'record', label: t('录制'), icon: CircleDot, disabled: !onRecord },
          ]}
        />
        <ui.Segmented
          size="sm"
          label={t('视图')}
          value={view}
          onChange={onView}
          options={views.map((v) => ({ id: v.id, label: v.label(), icon: v.icon }))}
        />
        <span
          title={t('跑脚本、试节点用的目标（左边栏的「目标」里换）')}
          className="ue:flex ue:h-7 ue:shrink-0 ue:items-center ue:gap-1.5 ue:rounded-(--c-badge-radius) ue:bg-hover ue:px-2 ue:font-mono ue:text-footnote ue:text-muted"
        >
          <Gamepad2 className="ue:h-3.5 ue:w-3.5" />
          {target}
          <span className={cn('ue:h-1.5 ue:w-1.5 ue:rounded-full', inst ? 'ue:bg-success' : 'ue:bg-subtle')} />
        </span>
        {dirty ? (
          <ui.Button size="sm" variant="secondary" disabled={saving} onClick={onSave} title={t('保存（Ctrl+S）')}>
            {saving && <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" />}
            {t('保存')}
          </ui.Button>
        ) : (
          <span className="ue:flex ue:shrink-0 ue:items-center ue:gap-1 ue:text-footnote ue:text-subtle">
            <Check className="ue:h-3.5 ue:w-3.5" />
            {t('已保存')}
          </span>
        )}
        <ui.Button
          size="sm"
          variant="secondary"
          disabled={!onTry}
          onClick={onTry}
          title={onTry ? t('在游戏里只做选中的这一步') : t('先在画布或列表里选一步，并连上编辑器')}
        >
          <PlayCircle className="ue:h-3.5 ue:w-3.5" />
          {t('试这个节点')}
        </ui.Button>
        <div className="ue:flex ue:shrink-0">
          <ui.Button
            size="sm"
            className="ue:rounded-r-none"
            disabled={!onRun || running}
            onClick={onRun}
            title={dirty ? t('先保存，再跑整个脚本') : t('跑整个脚本')}
          >
            {running ? (
              <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" />
            ) : (
              <Play className="ue:h-3.5 ue:w-3.5" />
            )}
            {t('运行')}
          </ui.Button>
          <ui.Button
            size="sm"
            className="ue:ml-px ue:rounded-l-none ue:px-1.5"
            aria-label={t('更多运行方式')}
            disabled={!onRun || running}
            onClick={(e: React.MouseEvent<HTMLElement>) =>
              openMenuAt(e.currentTarget, [
                { label: t('运行整个脚本'), icon: Play, onClick: () => onRun?.() },
                {
                  label: t('从选中的这一步跑到底'),
                  icon: Play,
                  hint: onRunFrom ? undefined : t('先选主流程里的一步'),
                  disabled: !onRunFrom,
                  onClick: () => onRunFrom?.(),
                },
              ])
            }
          >
            <ChevronDown className="ue:h-3.5 ue:w-3.5" />
          </ui.Button>
        </div>
      </div>
    </header>
  )
}
