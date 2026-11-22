import {
  Check,
  ChevronDown,
  CircleDot,
  FlaskConical,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  PlayCircle,
  StepForward,
} from 'lucide-react'
import { h, t } from '../../../host.ts'
import { openMenuAt, type MenuItem } from '../../../menu.tsx'
import { ConnPill } from '../../../conn/ConnPill.tsx'
import type { ViewDef } from './views.ts'

/** 面包屑里的一级：名字和点了去哪 */
export interface Crumb {
  label: string
  onClick: () => void
}

function CrumbLink({ crumb, last, title }: { crumb: Crumb; last?: boolean; title: string }) {
  const { cn } = h()
  return (
    <span className="ue:flex ue:min-w-0 ue:shrink ue:items-center ue:gap-1.5 ue:font-mono">
      <span className="ue:text-subtle">/</span>
      {last ? (
        <span className="ue:truncate ue:text-heading ue:font-semibold ue:text-fg">{crumb.label}</span>
      ) : (
        <button
          type="button"
          title={title}
          onClick={crumb.onClick}
          className={cn('ue:min-w-0 ue:cursor-pointer ue:truncate ue:text-muted ue:hover:text-fg')}
        >
          {crumb.label}
        </button>
      )}
    </span>
  )
}

/**
 * 编辑页顶栏（效果图 1）：左边面包屑（GameTest / 文件夹 / 脚本名 + 编写或录制的标签），
 * 右边依次是「编写 / 录制」、视图切换、目标（PIE · 客户端 0）、保存状态、「⋯」、「试这个节点」、「运行」。
 * 进 GameTest 就是编辑页（2026-11-19 取消了运行结果页），面包屑不再回到别的页：点文件夹是在左栏场景库里定位到它。
 * 原来运行结果页头上的整理、核对选择器、复制 / 导出 JSON 和场景列表上的设置入口收进「⋯」，批量运行并进「运行」的下拉。
 * 只管摆放和点击，动作都由外壳（GtEditor）给
 */
export function EditorHeader({
  name,
  folder,
  recorded,
  onFolder,
  more,
  runExtra,
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
  onRunTo,
  running,
  callers,
  scopes,
  onRoot,
}: {
  /** 从别的脚本「调用脚本」节点双击进来的：调用方一层一层（点了回到那个脚本），这个脚本标「引用」 */
  callers?: Crumb[]
  /** 在画布上进到了哪几层块里面（子图），点了回到那一层 */
  scopes?: Crumb[]
  /** 进到块里面时点脚本名回到最外层 */
  onRoot?: () => void
  name: string
  /** 场景所在文件夹（相对场景根），根下的为空 */
  folder: string
  /** 录制出来的脚本（tags 含 recorded） */
  recorded: boolean
  /** 点面包屑里的文件夹：在左栏场景库里定位到它（folder 是到这一级的相对路径） */
  onFolder?: (folder: string) => void
  /** 「⋯」菜单 */
  more: (MenuItem | false | undefined)[]
  /** 「运行」下拉里接在后面的（全部照做、批量运行） */
  runExtra?: (MenuItem | false | undefined)[]
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
  /** 跑到选中的这一步停下（GameTest 1.9 起；选了一步才有） */
  onRunTo?: () => void
  running: boolean
}) {
  const { ui, cn } = h()
  return (
    <header className="ue:flex ue:min-h-12 ue:flex-wrap ue:items-center ue:gap-x-3 ue:gap-y-2 ue:border-b ue:border-line ue:px-4 ue:py-2">
      <nav aria-label={t('位置')} className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:text-body">
        <span className="ue:flex ue:shrink-0 ue:items-center ue:gap-1.5 ue:font-mono ue:text-muted">
          <FlaskConical className="ue:h-3.5 ue:w-3.5" />
          GameTest
        </span>
        {callers?.length
          ? callers.map((c, i) => <CrumbLink key={`c${i}`} crumb={c} title={t('回到调用它的脚本')} />)
          : folder
              .split('/')
              .filter(Boolean)
              .map((f, i, all) => (
                <span key={i} className="ue:flex ue:shrink-0 ue:items-center ue:gap-1.5 ue:font-mono ue:text-muted">
                  <span className="ue:text-subtle">/</span>
                  <button
                    type="button"
                    title={t('在场景库里定位到这个文件夹')}
                    disabled={!onFolder}
                    onClick={() => onFolder?.(all.slice(0, i + 1).join('/'))}
                    className="ue:cursor-pointer ue:hover:text-fg ue:disabled:cursor-default"
                  >
                    {f}
                  </button>
                </span>
              ))}
        <span className="ue:text-subtle">/</span>
        {onRoot ? (
          <button
            type="button"
            title={t('回到最外层')}
            onClick={onRoot}
            className="ue:min-w-0 ue:cursor-pointer ue:truncate ue:text-heading ue:font-semibold ue:text-muted ue:hover:text-fg"
          >
            {name}
          </button>
        ) : (
          <span className="ue:truncate ue:text-heading ue:font-semibold ue:text-fg">{name}</span>
        )}
        {!!callers?.length && (
          <span
            title={t('这是被调用的脚本本身：在这里改就是改它，调用它的地方都跟着变')}
            className="ue:shrink-0 ue:rounded-(--c-badge-radius) ue:bg-warning/12 ue:px-1.5 ue:text-caption ue:text-warning"
          >
            {t('引用')}
          </span>
        )}
        {scopes?.map((c, i) => (
          <CrumbLink key={`s${i}`} crumb={c} last={i === scopes.length - 1} title={t('回到这一层')} />
        ))}
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
        {/* 连接状态和 GM 页同一个胶囊（分析文档 U6）：绿 游戏在跑、黄 只连着编辑器（给「开始 PIE」）、灰 UE 没在运行（给「启动编辑器」），
            点它换执行目标；以前这里只写目标名，没连上的原因和启动按钮在页顶另一条里 */}
        <ConnPill />
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
        <ui.IconButton
          icon={MoreHorizontal}
          size="sm"
          label={t('更多：整理、核对选择器、复制 / 导出 JSON、运行设置')}
          onClick={(e: React.MouseEvent<HTMLElement>) => openMenuAt(e.currentTarget, more)}
        />
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
                  hint: onRunFrom ? undefined : t('先选一步'),
                  disabled: !onRunFrom,
                  onClick: () => onRunFrom?.(),
                },
                {
                  label: t('运行到选中的这一步'),
                  icon: StepForward,
                  hint: onRunTo ? undefined : t('先选一步'),
                  disabled: !onRunTo,
                  onClick: () => onRunTo?.(),
                },
                ...(runExtra?.length ? ['sep' as const, ...runExtra] : []),
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
