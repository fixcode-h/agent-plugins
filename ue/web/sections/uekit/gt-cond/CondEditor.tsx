import {
  Braces,
  CircleCheck,
  CircleHelp,
  CircleX,
  Code2,
  Crosshair,
  GripVertical,
  Layers,
  Plus,
  Star,
  Trash2,
} from 'lucide-react'
import { useState, type DragEvent } from 'react'
import {
  addTo,
  childrenOf,
  groupKind,
  moveIn,
  rebasePath,
  removeAt,
  replaceAt,
  setKind,
  simplify,
  toEditable,
  toggleNot,
  wrapGroup,
  type CondNode,
  type GtPath,
  type GtTarget,
} from '../../../../shared/gt-script/index.ts'
import { ppost, show } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import { openMenu } from '../../../menu.tsx'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { NowBar } from '../gt-live/NowBar.tsx'
import { useCondNow } from '../gt-live/use-cond-now.ts'
import { widgetKindOf, type WidgetKind } from '../gt-blocks/state-presets.ts'
import { RefDialog } from '../gt-ref/RefDialog.tsx'
import { VarsDialog } from '../gt-vars/VarsDialog.tsx'
import { allChecks, checkKindOf } from './checks/index.ts'

const keyOf = (p: GtPath) => p.join('.')

/**
 * 条件组编辑器（定稿 4.1、效果图 2）：全部满足 / 任一满足，任意嵌套子组和「不」，每行一条判断，
 * 点开就地改；连着游戏时每条一直标着此刻成不成立和实际值（gt.watch 推送，GameTest 1.10.0 以前点「现在核对」问一次）。
 * 「从游戏里抓」打开选对象面板，从此刻的实例里挑一个对象（结构栏里点子控件就落到那个控件上），加一条「它存在」的判断，点开再换属性；
 * 在如果里还能「按它分路」，把所在的如果换成按状态分支。底下是稳住时间和存进场景里的样子。
 * if、循环、等到、守护、已达成就跳过、检查都用这一个
 */
export function CondEditor({
  value,
  onChange,
  elseSettle,
  compact,
  onSplit,
}: {
  value: unknown
  onChange: (cond: CondNode) => void
  /** 「按它分路」：抓到对象（和部件）后把所在的如果换成按状态分支（只有如果给） */
  onSplit?: (target: GtTarget, kind?: WidgetKind) => void
  /** 有「否」那一边的（if、loop while）显示「走否前」的稳住时间 */
  elseSettle?: boolean
  /** 嵌在守护、按状态分支卡片里时不显示稳住时间和 JSON */
  compact?: boolean
}) {
  const { ui, cn } = h()
  const ctx = useEditCtx()
  const root = toEditable(value)
  const [open, setOpen] = useState<string>()
  const [vars, setVars] = useState<GtPath>()
  const [picking, setPicking] = useState<GtPath>()
  const [json, setJson] = useState(false)
  // 「存成常用」：起名字的小弹窗
  const [aliasDraft, setAliasDraft] = useState<{ node: CondNode; name: string }>()
  const set = (next: CondNode) => onChange(simplify(next))

  const now = useCondNow([{ id: 'c', cond: root }])
  const resolved = now.byId.get('c')
  const parts = new Map((resolved?.parts ?? []).map((p) => [p.path, p]))

  const addMenu = (e: React.MouseEvent, group: GtPath) =>
    openMenu(
      e,
      allChecks()
        .filter((k) => !k.hidden)
        .map((k) => ({
          label: k.label(),
          hint: k.hint?.(),
          onClick: () => {
            const next = addTo(root, group, k.make())
            if (!next) return
            // 新加的那条直接展开，接着填
            const g = (group.reduce<unknown>((n, key) => (n as Record<string | number, unknown>)[key], next) ??
              {}) as CondNode
            set(next)
            setOpen(keyOf([...group, groupKind(g) ?? 'all', childrenOf(g).length - 1]))
          },
        })),
    )

  const aliasMenu = (e: React.MouseEvent, group: GtPath) =>
    openMenu(
      e,
      ctx.aliases.length
        ? ctx.aliases.map((a) => ({ label: a, onClick: () => set(addTo(root, group, { alias: a }) ?? root) }))
        : [
            {
              label: t('_vars.json 里还没有常用名：在行的菜单里「存成常用」'),
              disabled: true,
              onClick: () => undefined,
            },
          ],
    )

  const saveAlias = async () => {
    const name = aliasDraft?.name.trim()
    if (!aliasDraft || !name) return
    try {
      await ppost(ctx.project, 'ext/gt/aliases', { root: ctx.root, action: 'save', name, check: aliasDraft.node })
      h().toast.success(t('已存成常用名「{n}」', { n: name }))
      setAliasDraft(undefined)
    } catch (x) {
      h().toast.error((x as Error).message)
    }
  }

  const renderGroup = (node: CondNode, path: GtPath, depth: number) => {
    const kind = groupKind(node) as 'all' | 'any'
    const kids = childrenOf(node)
    const listKey: GtPath = [...path, kind]
    const onDrop = (e: DragEvent, to: number) => {
      const raw = e.dataTransfer.getData('text/gt-cond')
      if (!raw) return
      const { group, from } = JSON.parse(raw) as { group: string; from: number }
      if (group !== keyOf(path)) return
      e.preventDefault()
      set(moveIn(root, path, from, to))
    }
    return (
      <div
        className={cn(
          'ue:flex ue:flex-col ue:gap-1.5',
          depth > 0 &&
            'ue:rounded-(--c-row-radius) ue:border ue:border-dashed ue:border-warning/50 ue:bg-warning/4 ue:p-2',
        )}
      >
        <div className="ue:flex ue:items-center ue:gap-2">
          <ui.Segmented
            size="sm"
            label={t('怎么组合')}
            value={kind}
            onChange={(k: 'all' | 'any') => set(setKind(root, path, k))}
            options={[
              { id: 'all', label: t('全部满足') },
              { id: 'any', label: t('任一满足') },
            ]}
          />
          <span className="ue:text-footnote ue:text-subtle">{t('下面 {n} 条', { n: kids.length })}</span>
          {depth > 0 && (
            <ui.IconButton
              size="sm"
              className="ue:ml-auto"
              label={t('删掉这个条件组')}
              onClick={() => set(removeAt(root, path))}
            >
              <Trash2 className="ue:h-3.5 ue:w-3.5" />
            </ui.IconButton>
          )}
        </div>
        {kids.map((kid, i) => renderNode(kid, [...listKey, i], depth, path, i))}
        {!kids.length && (
          <p className="ue:rounded-(--c-row-radius) ue:border ue:border-dashed ue:border-line ue:px-3 ue:py-2.5 ue:text-center ue:text-footnote ue:text-subtle">
            {depth ? t('空的条件组：点下面加条件') : t('还没有条件：没有条件时按成立算')}
          </p>
        )}
        <div
          className="ue:flex ue:flex-wrap ue:gap-1"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => onDrop(e, kids.length)}
        >
          <ui.Button size="sm" variant="ghost" onClick={(e: React.MouseEvent) => addMenu(e, path)}>
            <Plus className="ue:h-3.5 ue:w-3.5" />
            {t('条件')}
          </ui.Button>
          <ui.Button size="sm" variant="ghost" onClick={() => set(addTo(root, path, { any: [] }) ?? root)}>
            <Layers className="ue:h-3.5 ue:w-3.5" />
            {t('条件组')}
          </ui.Button>
          {ctx.live && (
            <ui.Button size="sm" variant="ghost" onClick={() => setPicking(path)}>
              <Crosshair className="ue:h-3.5 ue:w-3.5" />
              {t('从游戏里抓')}
            </ui.Button>
          )}
          <ui.Button size="sm" variant="ghost" onClick={() => setVars(path)}>
            <Code2 className="ue:h-3.5 ue:w-3.5" />
            {t('从代码选')}
          </ui.Button>
          <ui.Button size="sm" variant="ghost" onClick={(e: React.MouseEvent) => aliasMenu(e, path)}>
            <Star className="ue:h-3.5 ue:w-3.5" />
            {t('常用')}
          </ui.Button>
        </div>
      </div>
    )
  }

  const renderNode = (node: CondNode, path: GtPath, depth: number, group: GtPath, index: number) => {
    const k = groupKind(node)
    if (k === 'all' || k === 'any') return <div key={keyOf(path)}>{renderGroup(node, path, depth + 1)}</div>
    const negated = k === 'not'
    const leaf = negated ? (node.not as CondNode) : node
    const leafPath = negated ? [...path, 'not'] : path
    if (groupKind(leaf))
      return (
        <div key={keyOf(path)} className="ue:flex ue:items-start ue:gap-1.5">
          <span className="ue:mt-2 ue:text-footnote ue:font-medium ue:text-danger">{t('不')}</span>
          <div className="ue:min-w-0 ue:flex-1">{renderGroup(leaf, leafPath, depth + 1)}</div>
        </div>
      )
    const kind = checkKindOf(leaf)
    const res = parts.get(keyOf(path)) ?? parts.get(keyOf(leafPath))
    const expanded = open === keyOf(path)
    return (
      <div
        key={keyOf(path)}
        className="ue:flex ue:flex-col ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData('text/gt-cond')
          if (!raw) return
          const { group: g, from } = JSON.parse(raw) as { group: string; from: number }
          if (g !== keyOf(group)) return
          e.preventDefault()
          set(moveIn(root, group, from, index))
        }}
      >
        <div className="ue:flex ue:h-9 ue:items-center ue:gap-1.5 ue:px-1.5">
          <span
            draggable
            title={t('拖动排序')}
            onDragStart={(e) =>
              e.dataTransfer.setData('text/gt-cond', JSON.stringify({ group: keyOf(group), from: index }))
            }
            className="ue:cursor-grab ue:text-subtle"
          >
            <GripVertical className="ue:h-3.5 ue:w-3.5" />
          </span>
          <span className="ue:shrink-0 ue:rounded-sm ue:bg-hover ue:px-1.5 ue:py-px ue:text-caption ue:text-muted">
            {kind.badge(leaf)}
          </span>
          <button
            type="button"
            onClick={() => setOpen(expanded ? undefined : keyOf(path))}
            className="ue:min-w-0 ue:flex-1 ue:cursor-pointer ue:truncate ue:text-left ue:font-mono ue:text-footnote ue:text-fg"
          >
            {negated && <span className="ue:mr-1 ue:font-sans ue:text-danger">{t('不')}</span>}
            {kind.summary(leaf) || t('（没填）')}
          </button>
          {res && (
            <span
              className="ue:flex ue:max-w-32 ue:shrink-0 ue:items-center ue:gap-1 ue:text-caption ue:text-subtle"
              title={res.unresolved ? t('读不到：{r}', { r: res.unresolved }) : undefined}
            >
              {res.unresolved ? (
                <CircleHelp className="ue:h-3.5 ue:w-3.5 ue:text-warning" />
              ) : res.holds ? (
                <CircleCheck className="ue:h-3.5 ue:w-3.5 ue:text-success" />
              ) : (
                <CircleX className="ue:h-3.5 ue:w-3.5 ue:text-danger" />
              )}
              <span className="ue:truncate ue:font-mono">{res.unresolved ? '' : show(res.actual)}</span>
            </span>
          )}
          <ui.Button
            size="sm"
            variant="ghost"
            aria-pressed={negated}
            title={t('取反：不成立才算成立')}
            className={negated ? 'ue:text-danger' : undefined}
            onClick={() => set(toggleNot(root, path))}
          >
            {t('不')}
          </ui.Button>
          <ui.IconButton
            size="sm"
            label={t('更多')}
            onClick={(e: React.MouseEvent) =>
              openMenu(e, [
                { label: t('包成条件组'), onClick: () => set(wrapGroup(root, path)) },
                { label: t('存成常用'), onClick: () => setAliasDraft({ node: leaf, name: '' }) },
                { label: t('删掉'), danger: true, onClick: () => set(removeAt(root, path)) },
              ])
            }
          >
            <Trash2 className="ue:h-3.5 ue:w-3.5" />
          </ui.IconButton>
        </div>
        {expanded && (
          <div className="ue:border-t ue:border-line/60 ue:p-2">
            <kind.Editor value={leaf} onChange={(c) => set(replaceAt(root, leafPath, c))} />
          </div>
        )}
      </div>
    )
  }

  const settle = (key: 'settleMs' | 'elseSettleMs', def: number) => (
    <ui.Input
      size="sm"
      type="number"
      min={0}
      className="ue:w-24 ue:font-mono"
      placeholder={String(def)}
      value={typeof root[key] === 'number' ? String(root[key]) : ''}
      onChange={(e: { target: { value: string } }) => {
        const next = { ...root }
        if (e.target.value === '') delete next[key]
        else next[key] = Math.max(0, Math.round(Number(e.target.value)))
        set(next)
      }}
    />
  )

  return (
    <div className="ue:flex ue:flex-col ue:gap-2">
      {renderGroup(root, [], 0)}
      <NowBar now={now} holds={resolved?.holds} />
      {!compact && (
        <div className="ue:grid ue:grid-cols-[auto_auto_minmax(0,1fr)] ue:items-center ue:gap-x-2 ue:gap-y-1.5 ue:text-footnote">
          <span className="ue:text-subtle">{t('稳住')}</span>
          {settle('settleMs', 300)}
          <span className="ue:text-subtle">{t('毫秒内一直成立才算（界面刚打开、数据还没刷时不误判）')}</span>
          {elseSettle && (
            <>
              <span className="ue:text-subtle">{t('走「否」前')}</span>
              {settle('elseSettleMs', 1000)}
              <span className="ue:text-subtle">{t('毫秒内一直不成立才走「否」')}</span>
            </>
          )}
        </div>
      )}
      {!compact && (
        <div className="ue:flex ue:flex-col ue:gap-1">
          <button
            type="button"
            onClick={() => setJson(!json)}
            className="ue:flex ue:cursor-pointer ue:items-center ue:gap-1 ue:text-left ue:text-footnote ue:text-subtle ue:hover:text-fg"
          >
            <Braces className="ue:h-3.5 ue:w-3.5" />
            {t('存在场景里的样子')}
          </button>
          {json && (
            <pre className="ue:max-h-48 ue:overflow-auto ue:rounded-(--c-row-radius) ue:bg-term ue:p-2 ue:font-mono ue:text-caption ue:text-term">
              {JSON.stringify(simplify(root), null, 1)}
            </pre>
          )}
        </div>
      )}
      {aliasDraft && (
        <ui.Modal
          open
          size="sm"
          onOpenChange={(o: boolean) => !o && setAliasDraft(undefined)}
          title={t('存成常用名')}
          footer={
            <>
              <ui.Button variant="secondary" onClick={() => setAliasDraft(undefined)}>
                {t('取消')}
              </ui.Button>
              <ui.Button disabled={!aliasDraft.name.trim()} onClick={() => void saveAlias()}>
                {t('存')}
              </ui.Button>
            </>
          }
        >
          <ui.Field
            label={t('名字')}
            hint={t('存进场景根的 _vars.json，进版本库，团队共用；条件里写 {"alias": "名字"}')}
          >
            <ui.Input
              autoFocus
              value={aliasDraft.name}
              placeholder={t('例如 引导到最后一页')}
              onChange={(e: { target: { value: string } }) => setAliasDraft({ ...aliasDraft, name: e.target.value })}
            />
          </ui.Field>
        </ui.Modal>
      )}
      {picking && (
        <RefDialog
          project={ctx.project}
          live={ctx.live}
          objects={(ctx.doc?.objects ?? {}) as Record<string, unknown>}
          withPart
          onClose={() => setPicking(undefined)}
          onSave={(_, ref, part) => {
            const prop = rebasePath('@:exists', part)
            set(addTo(root, picking, { obj: ref, prop, op: 'is', value: true } as CondNode) ?? root)
            setPicking(undefined)
          }}
          onSplit={
            onSplit &&
            ((target, cls) => {
              onSplit(target, widgetKindOf(cls))
              setPicking(undefined)
            })
          }
        />
      )}
      {vars && (
        <VarsDialog
          onClose={() => setVars(undefined)}
          onPick={(c) => {
            set(addTo(root, vars, c) ?? root)
            setVars(undefined)
          }}
        />
      )}
    </div>
  )
}
