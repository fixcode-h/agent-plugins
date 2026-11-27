import { Ellipsis, Layers, Play, X, type LucideIcon } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import { getAt, replace, type GtPath, type GtScript, type GtStep } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { openMenu } from '@panel/web/src/components/ui/item-menu'
import { blockUi, CommonFields, NoteField, TONE_TEXT, type BlockTone } from '../gt-blocks/index.ts'
import { HooksEditor } from '../gt-gm/HooksEditor.tsx'
import { canRun, commandMenuItems, COMMANDS, type CmdCtx } from './commands.ts'

/** 图标底下的浅色调小方块（效果图 1、11 右上）：和 TONE_TEXT 同一套色调，只是做成底色 */
const TONE_TINT: Record<BlockTone, string> = {
  accent: 'ue:bg-accent/10',
  warning: 'ue:bg-warning/10',
  success: 'ue:bg-success/10',
  run: 'ue:bg-run/10',
  danger: 'ue:bg-danger/10',
  subtle: 'ue:bg-hover',
}

/** 检查器头部：图标、标题、步骤 id，右边「⋯」出命令菜单、X 取消选中（右栏回到脚本设置） */
function Head({
  icon: Icon,
  tone,
  title,
  id,
  ctx,
}: {
  icon: LucideIcon
  tone: BlockTone
  title: ReactNode
  id?: string
  ctx: CmdCtx
}) {
  const { ui, cn } = h()
  return (
    <div className="ue:flex ue:h-12 ue:shrink-0 ue:items-center ue:gap-2 ue:border-b ue:border-line ue:pr-2 ue:pl-4">
      <span
        className={cn(
          'ue:flex ue:h-6 ue:w-6 ue:shrink-0 ue:items-center ue:justify-center ue:rounded-md',
          TONE_TINT[tone],
        )}
      >
        <Icon className={cn('ue:h-3.5 ue:w-3.5', TONE_TEXT[tone])} />
      </span>
      <span className="ue:truncate ue:text-body ue:font-medium ue:text-fg">{title}</span>
      {id && <code className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">#{id}</code>}
      <span className="ue:ml-auto ue:flex ue:shrink-0 ue:items-center ue:gap-0.5">
        <ui.IconButton
          icon={Ellipsis}
          size="sm"
          label={t('更多')}
          onClick={(e: MouseEvent) => openMenu(e, commandMenuItems(ctx))}
        />
        <ui.IconButton icon={X} size="sm" label={t('取消选中')} onClick={() => ctx.select([])} />
      </span>
    </div>
  )
}

/** 内容分节：小字灰色节标题，节之间用分隔线（外层 divide-y） */
function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="ue:flex ue:flex-col ue:gap-2.5 ue:px-4 ue:py-3.5">
      {title && <h3 className="ue:text-caption ue:font-normal ue:text-subtle">{title}</h3>}
      {children}
    </section>
  )
}

/**
 * 右栏检查器：选中一步时上面是这种块自己的字段（块 UI 注册表的 Inspector），下面是所有步骤共用的字段；
 * 选中多步时只给批量命令（包成段、停用、删）。什么都没选时外壳显示脚本设置
 */
export function Inspector({
  doc,
  selected,
  onChange,
  ctx,
  onTry,
  history,
  gtVersion,
}: {
  doc: GtScript
  selected: GtPath[]
  onChange: (r: ReturnType<typeof replace> | GtScript | undefined) => boolean
  ctx: CmdCtx
  onTry?: (p: GtPath) => void
  /** 这一步最近几次运行过没过（原来运行结果页步骤详情里的「最近几次」）；没有历史时返回空 */
  history?: (p: GtPath) => ReactNode
  /** 编辑器里 GameTest 的版本（名称字段要 2.6.0 起） */
  gtVersion?: string
}) {
  const { ui } = h()
  if (selected.length > 1)
    return (
      <div className="ue:flex ue:flex-col">
        <Head icon={Layers} tone="subtle" title={t('选了 {n} 步', { n: selected.length })} ctx={ctx} />
        <div className="ue:divide-y ue:divide-line">
          <Section title={t('批量操作')}>
            <div className="ue:flex ue:flex-wrap ue:gap-1.5">
              {COMMANDS.filter((c) => c.multi && canRun(c, ctx)).map((c) => (
                <ui.Button
                  key={c.id}
                  size="sm"
                  variant={c.danger ? 'danger-outline' : 'secondary'}
                  onClick={() => c.run(ctx)}
                >
                  <c.icon className="ue:h-3.5 ue:w-3.5" />
                  {c.label()}
                </ui.Button>
              ))}
            </div>
            <p className="ue:text-caption ue:text-subtle">
              {t('Ctrl 点选加减，Shift 点选连选；包成块要选同一层的步骤')}
            </p>
          </Section>
        </div>
      </div>
    )
  const path = selected[0]
  const step = path && (getAt(doc, path) as GtStep | undefined)
  if (!path || !step) return null
  const bu = blockUi(step.action)
  const set = (s: GtStep) => onChange(replace(doc, path, s))
  const Own = bu.Inspector
  const id = typeof step.id === 'string' ? step.id : undefined
  return (
    <div className="ue:flex ue:flex-col">
      <Head icon={bu.icon} tone={bu.tone} title={bu.title()} id={id} ctx={ctx} />
      <div className="ue:divide-y ue:divide-line">
        <Section>
          <NoteField step={step} onChange={set} gtVersion={gtVersion} />
          {Own && <Own key={id ?? path.join('.')} step={step} onChange={set} />}
        </Section>
        {onTry && (
          <Section title={t('在游戏里试')}>
            <div>
              <ui.Button size="sm" variant="secondary" onClick={() => onTry(path)}>
                <Play className="ue:h-3.5 ue:w-3.5" />
                {t('只做这一步')}
              </ui.Button>
            </div>
          </Section>
        )}
        <Section title={t('出错和跳过')}>
          <CommonFields step={step} onChange={set} />
        </Section>
        <Section title={t('附带 GM')}>
          <HooksEditor step={step} onChange={set} />
        </Section>
        {history && history(path) && (
          <Section title={t('最近几次')}>
            <div className="ue:text-footnote">{history(path)}</div>
          </Section>
        )}
      </div>
    </div>
  )
}
