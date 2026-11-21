import { RefreshCw } from 'lucide-react'
import { useContext, useMemo, useRef, useState, type ComponentProps } from 'react'
import {
  groupAt,
  groupHasProp,
  identLeaves,
  joinOf,
  kidsOf,
  makeGroup,
  normalizeIdent,
  toGroups,
  updateGroupAt,
  type GtClassItem,
  type GtIdentGroup,
  type GtIdentRule,
  type GtPropItem,
  type GtPropKind,
  type GtRef,
  type GtTarget,
  type IdentPath,
} from '../../../../shared/gt-script/index.ts'
import { Ctx } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { PANE_FILL, PANE_FIXED, SplitHandle, usePane } from '../../../split.tsx'
import { defaultIdent } from './compare-table.ts'
import { classShort, inText } from './describe.ts'
import { highlight, RefRpcProvider, useRefRpc } from './live.ts'
import { ClassPicker } from './pick/ClassPicker.tsx'
import { FromBrowser } from './pick/FromBrowser.tsx'
import { defaultSources, inOfSources, sourcesOfIn, type Source } from './pick/data.ts'
import { DetailPane, isTruncated } from './pick/DetailPane.tsx'
import { CondGroups } from './pick/CondGroups.tsx'
import { InstancePane } from './pick/InstancePane.tsx'
import { SourceChips } from './pick/SourceChips.tsx'
import { StructurePane } from './pick/StructurePane.tsx'
import { Summary } from './pick/Summary.tsx'
import { usePick } from './pick/use-pick.ts'
import { patchRunConfig, upsertIdentRule } from './rules-io.ts'

const NAME = /^[A-Za-z_]\w*$/

/** 不在编辑页里打开时（设置页、GM 面板）按 UE 页的项目状态判断连没连游戏；都拿不到当没连 */
function useLiveFallback(live: boolean | undefined) {
  const ue = useContext(Ctx)
  if (live !== undefined) return live
  return (ue?.state?.instances ?? []).some((i) => i.kind === 'editor' && i.online)
}

/**
 * 选对象（一页，效果图 GameTest选对象-一页）：顶上定类（可搜的类下拉，UObject 类树 / Lua 类两页）和在哪找（屏上界面 /
 * 关卡 Actor / Lua 对象，多选，都不选 = 全部），下面四栏都能拖边、记住宽度：此刻实例 · 结构（Widget 树 / 组件树）·
 * 细节（属性 · 方法 · Lua · 运行状态，行尾准星加标识）· 唯一标识组。底栏写存进脚本的样子。
 * 存进脚本的只有类、在哪找和标识，运行时按它重新找，不存那个对象本身。
 * 不依赖编辑页的上下文：设置页、GM 面板也能直接用（live 不给时按 UE 页的项目状态判断）。
 * withPart：动作落点用，结构栏里点的子控件 / 组件就是部件，保存时一起交出去（等于原来「连部件一起抓」）；
 * onSplit：条件里用，底栏多一个「按它分路」，把所在的如果换成按状态分支
 */
export function RefDialog(props: Omit<ComponentProps<typeof RefDialogBody>, 'onRefresh'>) {
  const base = useRefRpc()
  const [nonce, setNonce] = useState(0)
  // 刷新（用户 2026-11-21）：换一个新的 rpc 函数，类树、实例、结构、属性这些按 rpc 取数的都跟着重读；正在编辑的引用不动
  const rpc = useMemo<typeof base>(() => (p, n, a) => base(p, n, a), [base, nonce])
  return (
    <RefRpcProvider value={rpc}>
      <RefDialogBody {...props} onRefresh={() => setNonce((x) => x + 1)} />
    </RefRpcProvider>
  )
}

function RefDialogBody({
  project,
  name: initialName,
  withName,
  value,
  objects,
  lockClass,
  live: liveProp,
  withPart,
  part: initialPart,
  onSplit,
  onRefresh,
  onClose,
  onSave,
}: {
  onRefresh: () => void
  project: string
  name?: string
  /** 命名对象（脚本设置里）要填名字；步骤里内联的不要 */
  withName?: boolean
  value?: GtRef
  /** 场景的 objects（in.obj 写了名字时展开用） */
  objects?: Record<string, unknown>
  /** 只能选这个类或它的子类（类下拉的根换成它）；`lua:模块` 时只列 Lua 类 */
  lockClass?: string
  /** 连没连着游戏；不给时按 UE 页的项目状态判断 */
  live?: boolean
  /** 结构栏选的子控件当部件交出去（onSave 的第三个参数，`Header.BtnClose`；对象自己时不给） */
  withPart?: boolean
  /** 打开时选中的部件（动作落点原来的） */
  part?: string
  /** 「按它分路」：落点（对象 + 选中的部件）和选中那一项的类名 */
  onSplit?: (target: GtTarget, widgetClass?: string) => void
  onClose: () => void
  onSave: (name: string, ref: GtRef, part?: string) => void
}) {
  const { ui, cn } = h()
  const rpc = useRefRpc()
  const live = useLiveFallback(liveProp)
  const [name, setName] = useState(initialName ?? '')
  const [ref, setRef] = useState<GtRef>(() => value ?? { class: lockClass ?? '' })
  // in 的三个开关：写法是对象 / @来源时不归开关管（显示原样，能改回开关）
  const [sources, setSources] = useState<Source[] | undefined>(() => sourcesOfIn(value?.in))
  // 用户没碰过开关、原来也没写 in 时，存的时候照旧不写（运行时按类自动）
  const [touched, setTouched] = useState(false)
  const p = usePick({ project, live, ref, objects, initialPart: initialPart?.split('.').join('/') })
  // 「以后都按这个认」：勾上时保存对象的同时写进运行设置的 identRules
  const [rule, setRule] = useState(false)
  const [busy, setBusy] = useState(false)
  // 编辑时 ref.ident 存条件组本身（空组也留着），保存时才收拾成存盘写法（normalizeIdent）
  const groups = useMemo(() => toGroups(ref.ident), [ref.ident])
  const [target, setTarget] = useState<IdentPath>([0])
  // 目标组不在了（删掉、挪走）时退回最后一组
  const tgt: IdentPath = groupAt(groups, target) ? target : [Math.max(0, groups.length - 1)]
  const tgtGroup = groupAt(groups, tgt)
  // 准星的「已加」按目标组看：同一条属性可以在别的组里再写一次（比如 A 或 B 的两个分支）
  const picked = new Set(tgtGroup ? kidsOf(tgtGroup).flatMap((k) => ('prop' in k ? [k.prop] : [])) : [])
  const [flash, setFlash] = useState<{ at: IdentPath; prop: string }>()

  const panes = {
    inst: usePane('gt-pick-inst', '17%', 180),
    tree: usePane('gt-pick-tree', '22%', 200),
    ident: usePane('gt-pick-ident', '26%', 280),
  }
  const instRef = useRef<HTMLElement>(null)
  const treeRef = useRef<HTMLElement>(null)
  const identRef = useRef<HTMLElement>(null)
  const width = (r: { current: HTMLElement | null }) => r.current?.offsetWidth ?? 0

  const setGroups = (v: GtIdentGroup[]) => setRef((r) => ({ ...r, ident: v }))
  const pickClass = (cls: string, item?: GtClassItem) => {
    if (cls === ref.class) return
    // 换类：标识是按旧类的属性挑的，清掉；开关按新类的种类给默认
    setRef((r) => ({ class: cls, ...(r.many ? { many: r.many } : {}) }))
    if (!touched || sources === undefined)
      setSources(defaultSources(item?.kind ?? (cls.startsWith('lua:') ? 'lua' : undefined)))
  }
  const onPick = (prop: string, kind: GtPropKind | undefined, v: unknown, item?: GtPropItem) => {
    const on = picked.has(prop)
    // 截过的长字符串不能拿去比「等于」：改成「开头是」前 200 字
    const it = isTruncated(v)
      ? { prop, op: 'startsWith', value: v.slice(0, -1) }
      : defaultIdent({ prop, kind: item?.kind ?? kind ?? 'string', value: v })
    if (!tgtGroup) {
      // 还没有组：建「条件组 1」放进去
      setGroups([makeGroup('all', [it])])
      setTarget([0])
    } else
      setGroups(
        updateGroupAt(groups, tgt, (g) =>
          makeGroup(
            joinOf(g),
            on ? kidsOf(g).filter((k) => !('prop' in k) || k.prop !== prop) : [...kidsOf(g), it],
            g.not,
          ),
        ),
      )
    if (!on) {
      const at = tgtGroup ? tgt : [0]
      setFlash({ at, prop })
      window.setTimeout(() => setFlash((f) => (f?.prop === prop ? undefined : f)), 1400)
    }
  }

  const inValue: GtRef['in'] =
    sources === undefined ? ref.in : touched || value?.in !== undefined ? inOfSources(sources) : undefined
  const out: GtRef = { ...ref, class: ref.class.trim() }
  if (inValue === undefined) delete out.in
  else out.in = inValue
  const ident = normalizeIdent(groups)
  if (ident.length) out.ident = ident
  else delete out.ident
  if (!out.many || out.many === 'error') delete out.many
  const ok = (!withName || NAME.test(name.trim())) && !!out.class
  // 部件写法用 . 连（validPart），结构栏里是 / 连
  const outPart = (withPart || onSplit) && p.part ? p.part.split('/').join('.') : undefined

  const save = async () => {
    if (rule && out.ident?.length) {
      setBusy(true)
      try {
        // 只有对象写法、@来源这种「哪里的」才进规则；屏上 / 关卡这类开关是找法，不属于这个类的标识
        const ruleIn = sourcesOfIn(out.in) === undefined ? out.in : undefined
        const next: GtIdentRule = {
          class: out.class,
          ...(ruleIn !== undefined ? { in: ruleIn as GtIdentRule['in'] } : {}),
          ident: identLeaves(out.ident).map((i) => i.prop),
        }
        await patchRunConfig(project, (c) => {
          c.identRules = upsertIdentRule(c.identRules, next)
        })
      } catch (e) {
        h().toast.error(t('规则没存上：{e}', { e: (e as Error).message }))
      } finally {
        setBusy(false)
      }
    }
    onSave(name.trim(), out, outPart)
  }

  const structTitle =
    p.kind === 'actor' || p.kind === 'component'
      ? t('组件树 · {c}', { c: p.shown ?? classShort(p.cls) })
      : p.kind === 'umg'
        ? t('Widget 树 · {c}', { c: p.shown ?? classShort(p.cls) })
        : t('结构')
  const structHead = withPart ? `${structTitle} · ${t('点子控件选部件')}` : structTitle
  const col = 'ue:relative ue:flex ue:min-h-48 ue:flex-col ue:lg:min-h-0'

  return (
    <ui.Modal
      open
      size="full"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('选对象')}
      footer={
        <>
          <span className="ue:flex ue:min-w-0 ue:flex-1 ue:flex-col ue:gap-1">
            <Summary cls={out.class} inn={out.in} ident={ident} part={outPart} />
            <label className="ue:flex ue:w-fit ue:cursor-pointer ue:items-center ue:gap-2 ue:text-footnote ue:text-fg">
              <input
                type="checkbox"
                className="ue:accent-accent"
                checked={rule}
                disabled={!ident.length}
                onChange={(e) => setRule(e.target.checked)}
              />
              {t('以后抓 {c} 默认选这几项', { c: classShort(out.class) || t('这个类') })}
              <span className="ue:text-subtle">{t('（存进运行设置的「对象与标识」）')}</span>
            </label>
          </span>
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          {onSplit && (
            <ui.Button
              variant="secondary"
              disabled={!ok}
              onClick={() => onSplit({ obj: out, ...(outPart ? { part: outPart } : {}) }, p.selectedNode?.class)}
            >
              {t('按它分路')}
            </ui.Button>
          )}
          <ui.Button disabled={!ok || busy} onClick={() => void save()}>
            {t('保存对象')}
          </ui.Button>
        </>
      }
    >
      <div className="ue:flex ue:min-h-[70vh] ue:flex-1 ue:flex-col ue:gap-3">
        <div className="ue:flex ue:flex-wrap ue:items-end ue:gap-3">
          {withName && (
            <ui.Field label={t('名字')} hint={t('步骤里写这个名字引用它')}>
              <ui.Input
                size="sm"
                className="ue:w-40 ue:font-mono"
                value={name}
                placeholder="shop"
                onChange={(e: { target: { value: string } }) => setName(e.target.value)}
              />
            </ui.Field>
          )}
          {/* 不用 ui.Field：它是 <label>，点下拉里的行会把焦点送回输入框、把下拉又打开 */}
          <div className="ue:flex ue:min-w-0 ue:flex-col ue:gap-1.5">
            <span className="ue:text-xs ue:text-muted">{t('类')}</span>
            <ClassPicker project={project} value={ref.class} kind={p.kind} lockClass={lockClass} onPick={pickClass} />
          </div>
          {!lockClass && <FromBrowser project={project} onPick={pickClass} />}
          <ui.Button size="sm" variant="ghost" title={t('重新读类树、此刻实例和属性')} onClick={onRefresh}>
            <RefreshCw className="ue:h-3.5 ue:w-3.5" />
            {t('刷新')}
          </ui.Button>
          <ui.Field label={t('在哪找')}>
            {sources === undefined ? (
              <div className="ue:flex ue:h-8 ue:items-center ue:gap-2 ue:text-footnote ue:text-fg">
                {inText(ref.in)}
                <ui.Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSources(defaultSources(p.kind))
                    setTouched(true)
                  }}
                >
                  {t('改成按开关找')}
                </ui.Button>
              </div>
            ) : (
              <SourceChips
                value={sources}
                allowed={p.allowed}
                counts={p.counts}
                onChange={(s) => {
                  setSources(s)
                  setTouched(true)
                }}
              />
            )}
          </ui.Field>
        </div>
        <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:divide-y ue:divide-line ue:overflow-auto ue:rounded-(--c-row-radius) ue:border ue:border-line ue:lg:flex-row ue:lg:divide-x ue:lg:divide-y-0 ue:lg:overflow-hidden">
          <section ref={instRef} style={panes.inst.style('30%')} className={cn(PANE_FIXED, col)}>
            <InstancePane
              live={live}
              cls={p.cls}
              screen={p.screen.nodes}
              ident={identLeaves(ident)}
              me={p.hits.me}
              all={p.hits.all}
              error={p.hits.error || p.screen.error}
              selected={p.shown}
              onSelect={(n) => {
                p.setInst(n)
                p.setPart('')
              }}
              onUseClass={(cls, inst) => {
                pickClass(cls, { name: cls, kind: 'umg', kids: 0 })
                if (inst) p.setInst(inst)
              }}
            />
            <SplitHandle pane={panes.inst} paneRef={instRef} reserve={() => 560 + width(treeRef) + width(identRef)} />
          </section>
          <section ref={treeRef} style={panes.tree.style('35%')} className={cn(PANE_FIXED, col)}>
            <StructurePane
              title={structHead}
              nodes={p.structure}
              kind={p.kind}
              selected={p.part}
              onSelect={(n) => p.setPart(n.part)}
              onHover={live && p.structureFromTree ? (node) => void hover(project, node, rpc) : undefined}
              onUseClass={(cls) => pickClass(cls, { name: cls, kind: 'umg', kids: 0 })}
              empty={
                p.cls ? p.subError || (p.props.loading ? t('正在读…') : t('这个类没有子控件 / 组件')) : t('先定类')
              }
            />
            <SplitHandle pane={panes.tree} paneRef={treeRef} reserve={() => 380 + width(instRef) + width(identRef)} />
          </section>
          <section className={cn(PANE_FILL, col, 'ue:min-h-80')}>
            <DetailPane
              noClass={!p.cls}
              items={p.items}
              loading={p.props.loading}
              error={
                p.props.error && !p.props.data
                  ? live
                    ? p.props.error
                    : t('UE 没在运行：类的属性要开着编辑器才读得到；类树、Lua 字段照样能看')
                  : undefined
              }
              note={p.props.data?.unavailable}
              siblings={p.props.data?.siblings}
              groupTitle={p.groupTitle}
              picked={picked}
              onPick={onPick}
            />
          </section>
          <section ref={identRef} style={panes.ident.style('40%')} className={cn(PANE_FIXED, col)}>
            <SplitHandle
              pane={panes.ident}
              paneRef={identRef}
              side="right"
              reserve={() => 380 + width(instRef) + width(treeRef)}
            />
            <CondGroups
              cls={p.cls}
              groups={groups}
              onChange={setGroups}
              target={tgt}
              onTarget={setTarget}
              flash={flash}
              items={p.known.length ? p.known : p.items}
              actual={p.actual}
              live={live}
              me={p.hits.me}
              groupHits={p.groupHits}
            />
          </section>
        </div>
      </div>
    </ui.Modal>
  )
}

/** 悬停结构树的节点时在游戏画面上描边；移开清掉 */
function hover(project: string, node: string | undefined, rpc: ReturnType<typeof useRefRpc>) {
  return highlight(project, node ? { node } : { clear: true }, rpc)
}
