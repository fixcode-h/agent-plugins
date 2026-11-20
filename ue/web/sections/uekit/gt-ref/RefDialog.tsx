import { ChevronRight, CircleCheck, Crosshair } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { GtIdentItem, GtMany, GtPropItem, GtRef } from '../../../../shared/gt-script/ref/types.ts'
import { show } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import { PANE_FILL, PANE_FIXED, SplitHandle, usePane } from '../../../split.tsx'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { defaultIdent, testIdent } from './compare-table.ts'
import { classShort, inText } from './describe.ts'
import { IdentList } from './IdentList.tsx'
import { classOnly, useProps, useRefHits, type PropsArgs, type RefHits } from './live.ts'
import { PropTree } from './PropTree.tsx'
import { MANY_OPTIONS } from './RefCard.tsx'
import { patchRunConfig, upsertIdentRule } from './rules-io.ts'
import { WidgetTreePick } from './WidgetTreePick.tsx'

const NAME = /^[A-Za-z_]\w*$/
const IN_OPTIONS = () => [
  { value: '', label: t('自动（按类）') },
  { value: 'screen', label: t('屏上的界面') },
  { value: 'world', label: t('关卡里的 Actor') },
  { value: 'all', label: t('所有对象（最后才用）') },
]

/**
 * 对象：类和唯一标识（效果图 2，取代 ObjectKeyDialog）。存进脚本的只有类和你选的标识，运行时按它重新找。
 * 左边属性树点准星加标识（游戏开着时读此刻这个对象，没开按类读资产）；右边标识组（每条按类型比较）、
 * 此刻同类的实例表（哪个是它、别的被哪条排除）、命中多个时；底下「以后都按这个认」写进运行设置的 identRules。
 * 存进脚本的 JSON 只在折起来的「高级」里看
 */
export function RefDialog({
  project,
  name: initialName,
  withName,
  value,
  objects,
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
  onClose: () => void
  onSave: (name: string, ref: GtRef) => void
}) {
  const { ui, cn } = h()
  const ctx = useEditCtx()
  const [name, setName] = useState(initialName ?? '')
  const [ref, setRef] = useState<GtRef>(value ?? { class: '' })
  const [cls, setCls] = useState(ref.class)
  const [node, setNode] = useState<string>()
  const [picking, setPicking] = useState(false)
  const [rule, setRule] = useState(false)
  const [adv, setAdv] = useState(false)
  const [busy, setBusy] = useState(false)
  const pane = usePane('gt-ref-dialog', '58%', 360)
  const paneRef = useRef<HTMLDivElement>(null)
  const ident = ref.ident ?? []

  // 属性从哪读：刚从树里抓的节点 > 游戏开着时按引用找此刻的对象 > 只按类（找不到实例时也退回这个）
  const [byClass, setByClass] = useState(!ctx.live)
  const args: PropsArgs | undefined = node
    ? { node }
    : !cls
      ? undefined
      : byClass
        ? { class: cls }
        : { target: { obj: { ...ref, class: cls } } }
  const props = useProps(project, args)
  // 按引用找不到此刻的实例（没开这个界面）：退回只按类读
  useEffect(() => {
    if (props.error && !byClass && !node) setByClass(true)
  }, [props.error, byClass, node])
  const groups = props.data?.groups

  const ids = ident.map((i) => i.prop)
  const hits = useRefHits(
    project,
    ctx.live && !!ref.class,
    [
      { id: 'me', ref },
      { id: 'all', ref: classOnly(ref) },
    ],
    objects,
    ids,
  )

  const toggle = (it: GtPropItem) =>
    setRef({
      ...ref,
      ident: ids.includes(it.prop) ? ident.filter((x) => x.prop !== it.prop) : [...ident, defaultIdent(it)],
    })

  const ok = (!withName || NAME.test(name.trim())) && ref.class.trim()
  const save = async () => {
    const out: GtRef = { ...ref, class: ref.class.trim() }
    if (!out.ident?.length) delete out.ident
    if (!out.many || out.many === 'error') delete out.many
    if (rule && ids.length) {
      setBusy(true)
      try {
        await patchRunConfig(project, (c) => {
          c.identRules = upsertIdentRule(c.identRules, {
            class: out.class,
            ...(typeof out.in === 'string' && out.in !== 'screen' && out.in !== 'world' ? { in: out.in } : {}),
            ident: ids,
          })
        })
      } catch (e) {
        h().toast.error(t('规则没存上：{e}', { e: (e as Error).message }))
      } finally {
        setBusy(false)
      }
    }
    onSave(name.trim(), out)
  }

  const inValue = typeof ref.in === 'string' ? ref.in : ''
  return (
    <ui.Modal
      open
      size="full"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={t('对象：类和唯一标识')}
      footer={
        <>
          <label className="ue:flex ue:min-w-0 ue:flex-1 ue:cursor-pointer ue:items-center ue:gap-2 ue:text-footnote ue:text-fg">
            <input
              type="checkbox"
              className="ue:accent-accent"
              checked={rule}
              disabled={!ids.length}
              onChange={(e) => setRule(e.target.checked)}
            />
            <span className="ue:truncate">
              {t('以后抓 {c} 默认选这几项', { c: classShort(ref.class) || t('这个类') })}
              <span className="ue:ml-1.5 ue:text-subtle">{t('（存进运行设置的「对象与标识」）')}</span>
            </span>
          </label>
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          <ui.Button disabled={!ok || busy} onClick={() => void save()}>
            {t('保存对象')}
          </ui.Button>
        </>
      }
    >
      <p className="ue:-mt-2 ue:mb-3 ue:text-footnote ue:text-subtle">
        {t('存进脚本的只有类和你选的标识，运行时按它重新找；不会存那个对象本身')}
      </p>
      <div className="ue:mb-3 ue:flex ue:flex-wrap ue:items-end ue:gap-3">
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
        <ui.Field label={t('类')} hint={t('按继承认，子类也算；_C 后缀、U/A 前缀可省')}>
          <ui.Input
            size="sm"
            className="ue:w-64 ue:font-mono"
            value={ref.class}
            placeholder="WBP_Shop"
            onChange={(e: { target: { value: string } }) => setRef({ ...ref, class: e.target.value })}
            onBlur={() => {
              if (ref.class.trim() === cls) return
              setCls(ref.class.trim())
              setNode(undefined)
              setByClass(!ctx.live)
            }}
          />
        </ui.Field>
        <ui.Field label={t('在哪找')}>
          {ref.in && typeof ref.in === 'object' ? (
            <div className="ue:flex ue:h-8 ue:items-center ue:gap-2 ue:font-mono ue:text-footnote ue:text-fg">
              {t('{w} 的条目', { w: inText(ref.in) })}
              <ui.Button size="sm" variant="ghost" onClick={() => setRef({ ...ref, in: undefined })}>
                {t('改成自动')}
              </ui.Button>
            </div>
          ) : (
            <ui.Select
              size="sm"
              className="ue:w-48"
              value={inValue}
              onChange={(e: { target: { value: string } }) => setRef({ ...ref, in: e.target.value || undefined })}
              options={
                inValue && !IN_OPTIONS().some((o) => o.value === inValue)
                  ? [...IN_OPTIONS(), { value: inValue, label: inValue }]
                  : IN_OPTIONS()
              }
            />
          )}
        </ui.Field>
      </div>
      <div className="ue:flex ue:min-h-[56vh] ue:flex-1 ue:flex-col ue:overflow-auto ue:rounded-(--c-row-radius) ue:border ue:border-line ue:lg:flex-row ue:lg:overflow-hidden">
        <section
          ref={paneRef}
          style={pane.style('75%')}
          className={cn(PANE_FIXED, 'ue:relative ue:flex ue:min-h-80 ue:flex-col ue:lg:min-h-0')}
        >
          <PropTree
            className="ue:flex-1"
            data={props.data}
            loading={props.loading}
            error={byClass ? props.error : undefined}
            mode="ident"
            selected={ids}
            onPick={toggle}
            loadPart={props.loadPart}
            toolbar={
              ctx.live && (
                <ui.Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
                  <Crosshair className="ue:h-3.5 ue:w-3.5" />
                  {t('从游戏里抓')}
                </ui.Button>
              )
            }
          />
          <SplitHandle pane={pane} paneRef={paneRef} reserve={() => 320} />
        </section>
        <section className={cn(PANE_FILL, 'ue:flex ue:min-h-0 ue:flex-col ue:gap-4 ue:overflow-auto ue:p-3')}>
          <div className="ue:flex ue:flex-col ue:gap-1.5">
            <span className="ue:text-footnote ue:font-medium ue:text-fg">
              {t('唯一标识组')}
              <span className="ue:ml-1.5 ue:font-normal ue:text-subtle">{t('都要满足 · 点左边的准星加')}</span>
            </span>
            <IdentList value={ident} onChange={(v) => setRef({ ...ref, ident: v })} groups={groups} />
          </div>
          {ctx.live && ref.class && (
            <Siblings cls={ref.class} ident={ident} me={hits.hits.me} all={hits.hits.all} error={hits.error} />
          )}
          <div className="ue:flex ue:flex-col ue:gap-1.5">
            <span className="ue:text-footnote ue:font-medium ue:text-fg">{t('命中多个时')}</span>
            <ui.Segmented
              size="sm"
              label={t('命中多个时')}
              value={ref.many ?? 'error'}
              onChange={(m: GtMany) => setRef({ ...ref, many: m })}
              options={MANY_OPTIONS()}
            />
            {(ref.many ?? 'error') === 'error' && (
              <span className="ue:text-caption ue:text-subtle">
                {t('报错并列出每个候选的标识值；「第一个」容易悄悄点错')}
              </span>
            )}
          </div>
          <div className="ue:flex ue:flex-col ue:gap-1">
            <button
              type="button"
              onClick={() => setAdv(!adv)}
              className="ue:flex ue:w-fit ue:cursor-pointer ue:items-center ue:gap-1 ue:text-caption ue:text-subtle ue:hover:text-fg"
            >
              <ChevronRight className={cn('ue:h-3 ue:w-3 ue:transition-transform', adv && 'ue:rotate-90')} />
              {t('高级：存进脚本的样子')}
            </button>
            {adv && (
              <pre className="ue:max-h-40 ue:overflow-auto ue:rounded-(--c-row-radius) ue:bg-term ue:p-2 ue:font-mono ue:text-caption ue:break-all ue:whitespace-pre-wrap ue:text-term">
                {JSON.stringify(ref)}
              </pre>
            )}
          </div>
        </section>
      </div>
      {picking && (
        <WidgetTreePick
          project={project}
          mode="ident"
          onClose={() => setPicking(false)}
          onUse={(r) => {
            setRef({ ...ref, ...r.ref })
            setCls(r.ref.class)
            setPicking(false)
          }}
        />
      )}
    </ui.Modal>
  )
}

/**
 * 此刻同类的实例表（效果图 2 右中）：每个候选的标识值，按标识组命中的标「就是它」，没命中的写被哪条排除。
 * 候选和值来自 gt.resolve（只按类的那一项，带 show 要这几个属性的值）
 */
function Siblings({
  cls,
  ident,
  me,
  all,
  error,
}: {
  cls: string
  ident: GtIdentItem[]
  me?: RefHits
  all?: RefHits
  error?: string
}) {
  const { cn } = h()
  const mine = new Set((me?.candidates ?? []).map((c) => c.name))
  const rows = all?.candidates ?? []
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5">
      <span className="ue:flex ue:items-center ue:gap-1.5 ue:text-footnote ue:font-medium ue:text-fg">
        {t('此刻的 {c}', { c: classShort(cls) })}
        {me && (
          <span
            className={cn(
              'ue:flex ue:items-center ue:gap-1 ue:text-caption ue:font-normal',
              me.count === 1 ? 'ue:text-success' : 'ue:text-warning',
            )}
          >
            {me.count === 1 && <CircleCheck className="ue:h-3.5 ue:w-3.5" />}
            {t('命中 {n} 个', { n: me.count })}
          </span>
        )}
        {all && (
          <span className="ue:text-caption ue:font-normal ue:text-subtle">{t('同类 {n} 个', { n: all.count })}</span>
        )}
      </span>
      {error && <span className="ue:text-caption ue:text-warning">{error}</span>}
      {rows.length > 0 && (
        <div className="ue:overflow-auto ue:rounded-(--c-row-radius) ue:border ue:border-line">
          {rows.map((c) => {
            const hit = mine.has(c.name)
            const actual = new Map((c.ident ?? []).map((x) => [x.prop, x.actual]))
            const why = hit
              ? undefined
              : ident.find((it) => actual.has(it.prop) && testIdent(it, actual.get(it.prop)) === false)
            return (
              <div
                key={c.name}
                className={cn(
                  'ue:flex ue:h-8 ue:items-center ue:gap-3 ue:border-b ue:border-line/40 ue:px-2.5 ue:text-footnote ue:last:border-b-0',
                  hit && 'ue:bg-accent/8',
                )}
              >
                <span className="ue:w-36 ue:shrink-0 ue:truncate ue:font-mono ue:text-fg">{c.name}</span>
                {ident.map((it) => (
                  <span
                    key={it.prop}
                    className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono ue:text-muted"
                    title={it.prop}
                  >
                    {actual.has(it.prop) ? show(actual.get(it.prop)) : '—'}
                  </span>
                ))}
                <span
                  className={cn('ue:ml-auto ue:shrink-0 ue:text-caption', hit ? 'ue:text-success' : 'ue:text-subtle')}
                >
                  {hit ? t('就是它') : why ? t('排除：{p}', { p: why.prop.replace(/^@(self\.)?/, '') }) : t('排除')}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
