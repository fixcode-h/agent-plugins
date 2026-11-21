import { CircleCheck, Crosshair, Plus, TriangleAlert, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import {
  canNest,
  isIdentGroup,
  joinOf,
  kidsOf,
  makeGroup,
  normalizeIdent,
  updateGroupAt,
  type GtIdentGroup,
  type GtIdentItem,
  type GtIdentJoin,
  type GtIdentNode,
  type GtPropItem,
  type IdentPath,
} from '../../../../../shared/gt-script/index.ts'
import { h, t } from '../../../../host.ts'
import { defaultIdent } from '../compare-table.ts'
import { identTreeText } from '../describe.ts'
import { IdentRow } from '../IdentList.tsx'
import type { RefHits } from '../live.ts'
import { PropFind } from '../PropFind.tsx'

/** 两条位置是不是同一个组 */
export const samePath = (a: IdentPath, b: IdentPath) => a.length === b.length && a.every((x, i) => x === b[i])

/** 编辑栏共用的上下文：每层都要（改组、准星目标、此刻值），显式传下去，不写大闭包 */
interface Ctx {
  groups: GtIdentGroup[]
  onChange: (g: GtIdentGroup[]) => void
  target: IdentPath
  onTarget: (at: IdentPath) => void
  items: GtPropItem[]
  actual: (prop: string) => unknown
  /** 刚从准星加进来的那一条（组位置 + prop），闪一下 */
  flash?: { at: IdentPath; prop: string }
}

/** 改某个组里的项 */
const editKids = (c: Ctx, at: IdentPath, fn: (kids: GtIdentNode[]) => GtIdentNode[]) =>
  c.onChange(updateGroupAt(c.groups, at, (g) => makeGroup(joinOf(g), fn(kidsOf(g)), g.not)))

/**
 * 第 4 栏「唯一标识」（方案 A 嵌套框，用户 2026-11-21 定）：条件组之间都要满足，组里自己定「全部满足 / 任一满足」，
 * 可以套子组（括号）、每条和每组都能取反，变量、函数返回值、运行状态不限条数。
 * 准星加到「当前目标组」：卡片和子组头上点「准星加到这里」换目标，新加的那条闪一下；也能在组里按名字找一个加进来
 */
export function CondGroups({
  cls,
  live,
  me,
  groupHits,
  ...c
}: Ctx & { cls: string; live: boolean; me?: RefHits; groupHits: (RefHits | undefined)[] }) {
  const { cn } = h()
  const addGroup = () => {
    c.onChange([...c.groups, makeGroup('all', [])])
    c.onTarget([c.groups.length])
  }
  const text = identTreeText(normalizeIdent(c.groups))
  return (
    <>
      <div className="ue:flex ue:flex-col ue:gap-0.5 ue:px-3 ue:pt-2 ue:pb-1">
        <span className="ue:text-footnote ue:font-medium ue:text-fg">{t('唯一标识')}</span>
        <span className="ue:text-caption ue:text-subtle">
          {t('条件组之间都要满足；组里自己定「且 / 或」，可以套子组、取反')}
        </span>
      </div>
      {cls && live && typeof me?.count === 'number' && (
        <p
          className={cn(
            'ue:flex ue:items-start ue:gap-1.5 ue:px-3 ue:py-1 ue:text-caption',
            me.count === 1 ? 'ue:text-success' : 'ue:text-warning',
          )}
        >
          {me.count === 1 ? (
            <CircleCheck className="ue:mt-px ue:h-3.5 ue:w-3.5 ue:shrink-0" />
          ) : (
            <TriangleAlert className="ue:mt-px ue:h-3.5 ue:w-3.5 ue:shrink-0" />
          )}
          {me.count === 1
            ? t('此刻正好命中 1 个')
            : me.count === 0
              ? t('此刻一个也没命中：标识写得太严，或这个对象此刻不在')
              : t('此刻命中 {n} 个：再加一条各不相同的标识', { n: me.count })}
        </p>
      )}
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:overflow-auto ue:px-3 ue:pb-3">
        {!cls ? (
          <span className="ue:text-footnote ue:text-subtle">{t('还没定类')}</span>
        ) : (
          <>
            {!c.groups.length && (
              <p className="ue:rounded-(--c-row-radius) ue:border ue:border-dashed ue:border-line ue:px-3 ue:py-2 ue:text-footnote ue:text-subtle">
                {t('只按类认：同时开两份会报错。点细节里的准星加标识，会先建「条件组 1」')}
              </p>
            )}
            {c.groups.map((g, i) => (
              <div key={i}>
                {i > 0 && <AndBar />}
                <GroupCard c={c} at={[i]} group={g} index={i} hit={live ? groupHits[i] : undefined} />
              </div>
            ))}
            <button
              type="button"
              onClick={addGroup}
              className="ue:mt-2 ue:flex ue:items-center ue:justify-center ue:gap-1 ue:rounded-(--c-row-radius) ue:border ue:border-dashed ue:border-line ue:py-1.5 ue:text-caption ue:text-accent ue:hover:bg-hover"
            >
              <Plus className="ue:h-3 ue:w-3" />
              {t('新条件组')}
            </button>
            {text && c.groups.length > 0 && (
              <div className="ue:mt-2 ue:rounded-(--c-row-radius) ue:border ue:border-dashed ue:border-line ue:px-2.5 ue:py-1.5 ue:text-caption ue:text-muted">
                <span className="ue:text-subtle">{t('读起来是：')}</span>
                <span className="ue:text-fg">{text}</span>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

/** 组之间的「并且」 */
function AndBar() {
  return (
    <div className="ue:flex ue:items-center ue:gap-2 ue:py-1.5">
      <span className="ue:h-px ue:flex-1 ue:bg-line" />
      <span className="ue:rounded-full ue:border ue:border-line ue:px-2 ue:text-caption ue:text-muted">
        {t('并且（组之间都要满足）')}
      </span>
      <span className="ue:h-px ue:flex-1 ue:bg-line" />
    </div>
  )
}

/** 全部满足 / 任一满足 */
function JoinSwitch({ value, onChange }: { value: GtIdentJoin; onChange: (v: GtIdentJoin) => void }) {
  const { ui } = h()
  return (
    <ui.Segmented
      size="sm"
      label={t('组里怎么合')}
      value={value}
      onChange={onChange}
      options={[
        { id: 'all' as const, label: t('全部满足（且）') },
        { id: 'any' as const, label: t('任一满足（或）') },
      ]}
    />
  )
}

/** 「准星加到这里」：是目标时高亮，不是时点一下换成它 */
function TargetChip({ on, onClick }: { on: boolean; onClick: () => void }) {
  const { cn } = h()
  return (
    <button
      type="button"
      onClick={onClick}
      title={on ? t('细节栏点准星，加到这个组') : t('点一下：之后细节栏点准星加到这个组')}
      className={cn(
        'ue:flex ue:h-5 ue:shrink-0 ue:items-center ue:gap-1 ue:rounded-sm ue:px-1.5 ue:text-caption',
        on ? 'ue:bg-accent/15 ue:font-medium ue:text-accent' : 'ue:text-subtle ue:hover:bg-hover ue:hover:text-fg',
      )}
    >
      <Crosshair className="ue:h-3 ue:w-3" />
      {on ? t('准星加到这里') : t('加到这里')}
    </button>
  )
}

/** 「非」开关（整组取反） */
function NotChip({ on, onClick }: { on: boolean; onClick: () => void }) {
  const { cn } = h()
  return (
    <button
      type="button"
      onClick={onClick}
      title={on ? t('整组取反：组不成立才算（点一下取消）') : t('点一下整组取反')}
      className={cn(
        'ue:h-5 ue:shrink-0 ue:rounded-sm ue:px-1 ue:text-caption',
        on ? 'ue:bg-warning/15 ue:font-medium ue:text-warning' : 'ue:text-subtle ue:hover:bg-hover',
      )}
    >
      {t('非')}
    </button>
  )
}

/** 顶层的一个条件组：卡片 */
function GroupCard({
  c,
  at,
  group,
  index,
  hit,
}: {
  c: Ctx
  at: IdentPath
  group: GtIdentGroup
  index: number
  hit?: RefHits
}) {
  const { ui, cn } = h()
  const on = samePath(c.target, at)
  const set = (g: GtIdentGroup) => c.onChange(c.groups.map((x, i) => (i === index ? g : x)))
  const remove = () => {
    c.onChange(c.groups.filter((_, i) => i !== index))
    // 目标在它后面的往前挪一位；删的就是目标时落到相邻的组（找不到的位置由面板退回最后一组）
    const t0 = c.target[0]
    if (t0 > index) c.onTarget([t0 - 1, ...c.target.slice(1)])
    else if (t0 === index) c.onTarget([Math.max(0, Math.min(index, c.groups.length - 2))])
  }
  return (
    <div
      className={cn(
        'ue:rounded-(--c-row-radius) ue:border ue:bg-panel',
        on ? 'ue:border-accent/70 ue:ring-1 ue:ring-accent/30' : 'ue:border-line',
      )}
    >
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-1.5 ue:border-b ue:border-line/60 ue:px-2 ue:py-1.5">
        <span className="ue:text-footnote ue:font-medium ue:text-fg">{t('条件组 {n}', { n: index + 1 })}</span>
        <NotChip on={!!group.not} onClick={() => set(makeGroup(joinOf(group), kidsOf(group), !group.not))} />
        <JoinSwitch value={joinOf(group)} onChange={(j) => set(makeGroup(j, kidsOf(group), group.not))} />
        <span className="ue:ml-auto ue:flex ue:items-center ue:gap-1">
          {typeof hit?.count === 'number' && (
            <span className={cn('ue:text-caption', hit.count > 0 ? 'ue:text-success' : 'ue:text-warning')}>
              {t('单独命中 {n} 个', { n: hit.count })}
            </span>
          )}
          <TargetChip on={on} onClick={() => c.onTarget(at)} />
          <ui.IconButton size="sm" label={t('删掉这个条件组')} onClick={remove}>
            <X className="ue:h-3.5 ue:w-3.5" />
          </ui.IconButton>
        </span>
      </div>
      <div className="ue:flex ue:flex-col ue:gap-1 ue:p-2">
        <Kids c={c} at={at} group={group} />
      </div>
    </div>
  )
}

/** 组里的项：判断项是卡片，子组是缩进的框；项之间写「且 / 或」，底下加条件、加子组 */
function Kids({ c, at, group }: { c: Ctx; at: IdentPath; group: GtIdentGroup }) {
  const kids = kidsOf(group)
  const word = joinOf(group) === 'all' ? t('且') : t('或')
  const out: ReactNode[] = []
  kids.forEach((k, i) => {
    if (i > 0) out.push(<JoinWord key={`j${i}`} or={joinOf(group) === 'any'} word={word} />)
    if (isIdentGroup(k)) out.push(<SubBox key={i} c={c} at={[...at, i]} group={k} />)
    else
      out.push(
        <IdentRow
          key={`${k.prop}#${i}`}
          value={k}
          canNot
          flash={!!c.flash && samePath(c.flash.at, at) && c.flash.prop === k.prop}
          items={c.items}
          actual={c.actual(k.prop)}
          onChange={(v) => editKids(c, at, (list) => list.map((x, n) => (n === i ? v : x)))}
          onRemove={() => editKids(c, at, (list) => list.filter((_, n) => n !== i))}
        />,
      )
  })
  return (
    <>
      {out}
      {!kids.length && (
        <p className="ue:px-1 ue:text-caption ue:text-subtle">{t('空的：点细节里的准星，或在下面按名字加')}</p>
      )}
      <Adders c={c} at={at} group={group} />
    </>
  )
}

function JoinWord({ or, word }: { or: boolean; word: string }) {
  const { cn } = h()
  return (
    <div className="ue:flex ue:pl-5">
      <span
        className={cn(
          'ue:rounded-sm ue:px-1.5 ue:text-caption',
          or ? 'ue:bg-accent/15 ue:font-medium ue:text-accent' : 'ue:bg-hover ue:text-muted',
        )}
      >
        {word}
      </span>
    </div>
  )
}

/** 子组（括号）：自己的且 / 或、取反、准星目标、删掉 */
function SubBox({ c, at, group }: { c: Ctx; at: IdentPath; group: GtIdentGroup }) {
  const { ui, cn } = h()
  const on = samePath(c.target, at)
  const parent = at.slice(0, -1)
  const idx = at[at.length - 1]
  const set = (g: GtIdentGroup) => editKids(c, parent, (list) => list.map((x, n) => (n === idx ? g : x)))
  return (
    <div
      className={cn(
        'ue:ml-3 ue:flex ue:flex-col ue:gap-1 ue:rounded-(--c-row-radius) ue:border ue:border-l-2 ue:bg-hover/30 ue:px-2 ue:py-1.5',
        on ? 'ue:border-accent/70 ue:border-l-accent' : 'ue:border-line/70 ue:border-l-accent/50',
      )}
    >
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-1.5">
        <span className="ue:text-caption ue:text-subtle">{t('子组')}</span>
        <NotChip on={!!group.not} onClick={() => set(makeGroup(joinOf(group), kidsOf(group), !group.not))} />
        <JoinSwitch value={joinOf(group)} onChange={(j) => set(makeGroup(j, kidsOf(group), group.not))} />
        <span className="ue:ml-auto ue:flex ue:items-center ue:gap-1">
          <TargetChip on={on} onClick={() => c.onTarget(at)} />
          <ui.IconButton
            size="sm"
            label={t('删掉这个子组')}
            onClick={() => {
              editKids(c, parent, (list) => list.filter((_, n) => n !== idx))
              if (samePath(c.target, at)) c.onTarget(parent)
            }}
          >
            <X className="ue:h-3.5 ue:w-3.5" />
          </ui.IconButton>
        </span>
      </div>
      <Kids c={c} at={at} group={group} />
    </div>
  )
}

/** 组底下：「+ 条件」按名字找一个加进来，「+ 子组（括号）」 */
function Adders({ c, at, group }: { c: Ctx; at: IdentPath; group: GtIdentGroup }) {
  const { ui } = h()
  const [finding, setFinding] = useState(false)
  const have = new Set(kidsOf(group).flatMap((k) => (isIdentGroup(k) ? [] : [k.prop])))
  const addLeaf = (it: GtIdentItem) => editKids(c, at, (list) => [...list, it])
  return (
    <div className="ue:flex ue:flex-col ue:gap-1 ue:pt-0.5">
      {finding && (
        <PropFind
          items={c.items}
          skip={have}
          onAdd={(prop, item) => {
            addLeaf(item ? defaultIdent(item) : { prop, op: 'eq', value: '' })
            setFinding(false)
          }}
        />
      )}
      <div className="ue:flex ue:gap-1">
        <ui.Button size="sm" variant="ghost" onClick={() => setFinding((v) => !v)}>
          <Plus className="ue:h-3 ue:w-3" />
          {t('条件')}
        </ui.Button>
        {canNest(at) && (
          <ui.Button
            size="sm"
            variant="ghost"
            onClick={() => {
              // 子组默认「任一满足」：在一个都满足的组里套括号，多半是为了写「或」
              editKids(c, at, (list) => [...list, makeGroup(joinOf(group) === 'all' ? 'any' : 'all', [])])
              c.onTarget([...at, kidsOf(group).length])
            }}
          >
            <Plus className="ue:h-3 ue:w-3" />
            {t('子组（括号）')}
          </ui.Button>
        )}
      </div>
    </div>
  )
}
