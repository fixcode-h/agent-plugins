import { Box, ChevronDown, Crosshair, Library, Plus, Variable, X } from 'lucide-react'
import type { GmObject } from '../../../../shared/gm/schema.ts'
import { LIB_DROP_KEY, libPath, objValue } from '../../../../shared/obj-lib/link.ts'
import { pget } from '../../../api.ts'
import { useState, type MouseEvent } from 'react'
import { objOfVar, type GtRef, type GtRefLike, type GtTarget } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { openMenuAt, type MenuItem } from '../../../menu.tsx'
import { useEditCtx, type EditCtx } from '../gt-edit/ctx.ts'
import { classOfRef, classShort, identTreeText, inText, isRefObj } from './describe.ts'
import { useProps, useRefHit } from './live.ts'
import { RefDialog } from './RefDialog.tsx'

/** 引用对应的属性树（只按类读）：部件下拉、属性路径下拉、判断的类型都从这里来 */
export function useRefGroups(ref: GtRefLike | undefined) {
  const ctx = useEditCtx()
  const cls = classOfRef(ref, ctx.doc?.objects)
  const p = useProps(ctx.project, ctx.live && cls ? { class: cls } : undefined)
  return { groups: p.data?.groups, data: p.data, loading: p.loading, cls }
}

/**
 * 这一格实际指向的引用：命名对象取脚本里那一条，$变量取给它赋值的「找对象」那一步的对象（B4 同一份推断）；
 * 来源字符串（@sub.X）、跑起来才知道的 $变量 没有引用
 */
export function resolveObj(ctx: EditCtx, value: GtRefLike | undefined): { src?: GtRefLike; ref?: GtRef } {
  const objects = (ctx.doc?.objects ?? {}) as Record<string, unknown>
  const name = typeof value === 'string' ? value.trim() : ''
  const src = name.startsWith('$') && ctx.doc ? (objOfVar(ctx.doc, name, ctx.at) as GtRefLike | undefined) : value
  const ref = isRefObj(src)
    ? src
    : typeof src === 'string' && isRefObj(objects[src.trim()])
      ? (objects[src.trim()] as GtRef)
      : undefined
  return { src, ref }
}

/** 这一格现在填的是什么：脚本里的命名对象 / 前面存的 $变量 / 内联引用 / 空 */
type Kind = 'name' | 'var' | 'inline' | 'empty'
const kindOf = (v: GtRefLike | undefined): Kind =>
  isRefObj(v) ? 'inline' : typeof v === 'string' && v.trim() ? (v.trim().startsWith('$') ? 'var' : 'name') : 'empty'

/**
 * 对象块（分析文档 G9、效果图 1 / 5）：填对象的地方都用它。一整块写清是哪个对象（名字、类、唯一标识、此刻命中几个），
 * 点一下就弹 GM 页同一个抓取框（RefDialog）改它：命名对象改的是脚本「对象」里那一条（用到它的步骤都跟着变），
 * 内联的改这一格；右边 ⌄ 换成脚本里别的对象、前面「找对象」存的 $变量，或新抓一个。
 * $变量 编写时不知道是谁：按前面给它赋值的「找对象」那一步显示（B4 同一份推断），点它是换，不是改那一步
 */
export function ObjInput({
  value,
  onChange,
  part,
  onTarget,
  wantClass,
}: {
  value: GtRefLike | undefined
  onChange: (v: GtRefLike | undefined) => void
  /** 动作落点：现在的部件，面板结构栏里打开时选中它 */
  part?: string
  /** 动作落点：面板里连部件一起选，保存时交回对象 + 部件（不给时只交引用） */
  onTarget?: (t: GtTarget) => void
  /** 这一格要的类型（函数参数是 AActor 时只列 Actor）：新抓时类按它预填 */
  wantClass?: string
}) {
  const { ui, cn } = h()
  const ctx = useEditCtx()
  const [dialog, setDialog] = useState<'edit' | 'new'>()
  const objects = (ctx.doc?.objects ?? {}) as Record<string, unknown>
  const kind = kindOf(value)
  const name = typeof value === 'string' ? value.trim() : ''
  const { src, ref } = resolveObj(ctx, value)
  const { hit } = useRefHit(ctx.project, ctx.live, ref, objects)
  const canEdit = kind === 'inline' || (kind === 'name' && !!ref && !!ctx.setObject)

  const switchMenu = async (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation()
    const at = e.currentTarget
    // 对象库（objects.json，第三期 3.3）点开时现读：选了拷进脚本、记来源（值写 {$lib}，改脚本时收成名字，shared/obj-lib/link.ts）
    const lib = ctx.project
      ? await pget<{ objects: GmObject[] }>(ctx.project, 'objlib').catch(() => undefined)
      : undefined
    const libItems = (lib?.objects ?? []).slice(0, 40)
    const vars = ctx.doc ? savedVars(ctx.doc) : []
    const items: MenuItem[] = [
      { label: t('新抓一个对象…'), icon: Crosshair, onClick: () => setDialog('new') },
      ...(Object.keys(objects).length ? [{ title: t('脚本里的对象') }] : []),
      ...Object.keys(objects).map((n) => ({
        label: n,
        icon: Box,
        hint: classShort((objects[n] as GtRef)?.class),
        checked: kind === 'name' && n === name,
        onClick: () => onChange(n),
      })),
      ...(libItems.length ? [{ title: t('对象库') }] : []),
      ...libItems.map((o) => ({
        label: o.name,
        icon: Library,
        hint: o.folder ?? classShort(o.ref?.class),
        onClick: () =>
          onChange({ [LIB_DROP_KEY]: { name: o.name, path: libPath(o), value: objValue(o) } } as unknown as GtRefLike),
      })),
      ...(vars.length ? [{ title: t('前面「找对象」存的') }] : []),
      ...vars.map((v) => ({
        label: `$${v}`,
        icon: Variable,
        checked: kind === 'var' && name === `$${v}`,
        onClick: () => onChange(`$${v}`),
      })),
      ...(kind !== 'empty' ? [{ label: t('不填（调静态函数时）'), icon: X, onClick: () => onChange(undefined) }] : []),
    ]
    openMenuAt(at, items)
  }

  const open = () => {
    if (kind === 'empty') return setDialog('new')
    if (canEdit) return setDialog('edit')
  }
  const title =
    kind === 'empty'
      ? t('点一下抓取对象')
      : kind === 'var'
        ? name
        : kind === 'name'
          ? name
          : classShort(ref?.class) || t('对象')
  const sub =
    kind === 'var'
      ? ref
        ? t('前面「找对象」存的：{o}', { o: typeof src === 'string' ? src : classShort(ref.class) })
        : t('跑起来才知道是哪个对象')
      : ref?.ident?.length
        ? identTreeText(ref.ident)
        : ref
          ? t('只按类认')
          : kind === 'name'
            ? t('脚本「对象」里没有这一条')
            : ''
  return (
    <div className="ue:flex ue:min-w-0 ue:items-stretch ue:gap-1">
      <div
        role="button"
        tabIndex={0}
        title={canEdit ? t('点一下在抓取框里改') : kind === 'empty' ? t('弹出抓取框') : undefined}
        onClick={open}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open()}
        className={cn(
          'ue:flex ue:min-w-0 ue:flex-1 ue:flex-col ue:gap-1 ue:rounded-(--c-input-radius) ue:border-(length:--c-input-border) ue:bg-(--c-input-bg) ue:px-2.5 ue:py-1.5 ue:text-left',
          kind === 'empty' ? 'ue:border-dashed ue:border-line-strong' : 'ue:border-line-strong',
          (canEdit || kind === 'empty') && 'ue:cursor-pointer ue:hover:border-accent',
        )}
      >
        <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
          {kind === 'var' ? (
            <Variable className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
          ) : kind === 'empty' ? (
            <Crosshair className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-accent" />
          ) : (
            <Box className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
          )}
          <span
            className={cn(
              'ue:max-w-[60%] ue:shrink-0 ue:truncate ue:text-body',
              kind === 'empty' ? 'ue:text-accent-text' : 'ue:font-medium ue:text-fg',
              kind === 'var' && 'ue:font-mono',
            )}
          >
            {title}
          </span>
          {ref?.class && kind !== 'inline' && (
            <span
              title={ref.class}
              className="ue:shrink-0 ue:rounded-(--c-badge-radius) ue:bg-hover ue:px-1.5 ue:font-mono ue:text-caption ue:text-muted"
            >
              {classShort(ref.class)}
            </span>
          )}
          {ref?.in !== undefined && (
            <span className="ue:min-w-0 ue:truncate ue:text-caption ue:text-subtle">{inText(ref.in)}</span>
          )}
        </span>
        {(sub || hit) && (
          <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
            {sub && <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-caption ue:text-muted">{sub}</span>}
            {hit && <HitBadge count={hit.count} error={hit.error} />}
          </span>
        )}
      </div>
      <ui.IconButton
        size="sm"
        className="ue:self-start"
        label={t('换成别的对象')}
        icon={kind === 'empty' ? Plus : ChevronDown}
        onClick={(e: MouseEvent<HTMLElement>) => void switchMenu(e)}
      />
      {dialog && (
        <RefDialog
          project={ctx.project}
          live={ctx.live}
          value={dialog === 'edit' ? ref : undefined}
          name={dialog === 'edit' && kind === 'name' ? name : undefined}
          lockClass={dialog === 'new' ? wantClass : undefined}
          objects={objects}
          withPart={!!onTarget}
          part={part}
          onClose={() => setDialog(undefined)}
          onSave={(_, r, pt) => {
            // 命名对象改的是脚本里那一条：用到它的步骤都跟着变，这一格还是写名字
            if (dialog === 'edit' && kind === 'name' && ctx.setObject) {
              ctx.setObject(name, r)
              if (onTarget && pt !== part) onTarget(pt ? { obj: name, part: pt } : { obj: name })
            } else if (onTarget) onTarget(pt ? { obj: r, part: pt } : { obj: r })
            else onChange(r)
            setDialog(undefined)
          }}
        />
      )}
    </div>
  )
}

/** 此刻命中几个：1 个绿，0 个红，多个黄（多个时步骤按「命中多个时」走） */
function HitBadge({ count, error }: { count: number; error?: string }) {
  const { cn } = h()
  return (
    <span
      title={error}
      className={cn(
        'ue:shrink-0 ue:rounded-(--c-badge-radius) ue:px-1.5 ue:text-caption',
        error || count === 0
          ? 'ue:bg-danger/10 ue:text-danger'
          : count === 1
            ? 'ue:bg-success/12 ue:text-success'
            : 'ue:bg-warning/12 ue:text-warning',
      )}
    >
      {error ? t('找不到') : t('命中 {n}', { n: count })}
    </span>
  )
}

/** 脚本里「找对象」存下的变量名（按出现顺序，去重） */
function savedVars(doc: { steps?: unknown }): string[] {
  const out: string[] = []
  const visit = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(visit)
    if (!v || typeof v !== 'object') return
    const o = v as Record<string, unknown>
    if (o.action === 'obj.find' && typeof o.saveAs === 'string' && o.saveAs && !out.includes(o.saveAs))
      out.push(o.saveAs)
    Object.values(o).forEach(visit)
  }
  visit(doc)
  return out
}
