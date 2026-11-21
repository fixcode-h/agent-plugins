import { useContext, useRef, useState } from 'react'
import type { GtClassItem, GtIdentItem, GtPropItem, GtPropKind, GtRef } from '../../../../shared/gt-script/index.ts'
import { Ctx } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { PANE_FILL, PANE_FIXED, SplitHandle, usePane } from '../../../split.tsx'
import { defaultIdent } from './compare-table.ts'
import { classShort, inText } from './describe.ts'
import { highlight, useRefRpc } from './live.ts'
import { ClassPicker } from './pick/ClassPicker.tsx'
import { defaultSources, inOfSources, sourcesOfIn, type Source } from './pick/data.ts'
import { DetailPane } from './pick/DetailPane.tsx'
import { IdentPane } from './pick/IdentPane.tsx'
import { InstancePane } from './pick/InstancePane.tsx'
import { SourceChips } from './pick/SourceChips.tsx'
import { StructurePane } from './pick/StructurePane.tsx'
import { Summary } from './pick/Summary.tsx'
import { usePick } from './pick/use-pick.ts'

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
 * 不依赖编辑页的上下文：设置页、GM 面板也能直接用（live 不给时按 UE 页的项目状态判断）
 */
export function RefDialog({
  project,
  name: initialName,
  withName,
  value,
  objects,
  lockClass,
  live: liveProp,
  onClose,
  onSave,
}: {
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
  onClose: () => void
  onSave: (name: string, ref: GtRef) => void
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
  const p = usePick({ project, live, ref, objects })
  const ident = ref.ident ?? []
  const picked = new Set(ident.map((i) => i.prop))

  const panes = {
    inst: usePane('gt-pick-inst', '17%', 180),
    tree: usePane('gt-pick-tree', '22%', 200),
    ident: usePane('gt-pick-ident', '26%', 280),
  }
  const instRef = useRef<HTMLElement>(null)
  const treeRef = useRef<HTMLElement>(null)
  const identRef = useRef<HTMLElement>(null)
  const width = (r: { current: HTMLElement | null }) => r.current?.offsetWidth ?? 0

  const setIdent = (v: GtIdentItem[]) => setRef((r) => ({ ...r, ident: v }))
  const pickClass = (cls: string, item?: GtClassItem) => {
    if (cls === ref.class) return
    // 换类：标识是按旧类的属性挑的，清掉；开关按新类的种类给默认
    setRef((r) => ({ class: cls, ...(r.many ? { many: r.many } : {}) }))
    if (!touched || sources === undefined)
      setSources(defaultSources(item?.kind ?? (cls.startsWith('lua:') ? 'lua' : undefined)))
  }
  const onPick = (prop: string, kind: GtPropKind | undefined, v: unknown, item?: GtPropItem) => {
    const on = picked.has(prop)
    const it = defaultIdent({ prop, kind: item?.kind ?? kind ?? 'string', value: v })
    setIdent(p.toggleIdent(it, on))
  }

  const inValue: GtRef['in'] =
    sources === undefined ? ref.in : touched || value?.in !== undefined ? inOfSources(sources) : undefined
  const out: GtRef = { ...ref, class: ref.class.trim() }
  if (inValue === undefined) delete out.in
  else out.in = inValue
  if (!out.ident?.length) delete out.ident
  if (!out.many || out.many === 'error') delete out.many
  const ok = (!withName || NAME.test(name.trim())) && !!out.class

  const structTitle =
    p.kind === 'actor' || p.kind === 'component'
      ? t('组件树 · {c}', { c: p.shown ?? classShort(p.cls) })
      : p.kind === 'umg'
        ? t('Widget 树 · {c}', { c: p.shown ?? classShort(p.cls) })
        : t('结构')
  const col = 'ue:relative ue:flex ue:min-h-48 ue:flex-col ue:lg:min-h-0'

  return (
    <ui.Modal
      open
      size="full"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('选对象')}
      footer={
        <>
          <span className="ue:min-w-0 ue:flex-1">
            <Summary cls={out.class} inn={out.in} ident={ident} />
          </span>
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          <ui.Button disabled={!ok} onClick={() => onSave(name.trim(), out)}>
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
          <ui.Field label={t('类')}>
            <ClassPicker project={project} value={ref.class} kind={p.kind} lockClass={lockClass} onPick={pickClass} />
          </ui.Field>
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
              ident={ident}
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
              title={structTitle}
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
              error={p.props.error && !p.props.data ? p.props.error : undefined}
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
            <IdentPane
              cls={p.cls}
              ident={ident}
              onChange={setIdent}
              items={p.known.length ? p.known : p.items}
              actual={p.actual}
              live={live}
              me={p.hits.me}
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
