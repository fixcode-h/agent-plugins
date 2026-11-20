import {
  Bomb,
  EyeOff,
  GripVertical,
  Keyboard,
  Layers,
  MousePointerClick,
  Plus,
  SquareFunction,
  FileCode2,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { MouseEvent } from 'react'
import type { GtCloseHow, GtCloseVerify } from '../../../../shared/gt-script/ref/types.ts'
import { h, t } from '../../../host.ts'
import { openMenu } from '../../../menu.tsx'
import { parseScalar, scalarText } from '../gt-cond/compare.tsx'
import { ArgsEdit } from '../gt-api/ApiPick.tsx'
import { PartInput } from './PropPathInput.tsx'

/** 关闭方式注册表（协议 5.2，面板这一份只管怎么画）：一种一项，加新方式在这里加一项 */
interface CloseBy {
  by: string
  icon: LucideIcon
  label: () => string
  hint: () => string
  /** 行里的一句话 */
  text: (h: GtCloseHow) => string
  make: () => GtCloseHow
  /** 要 allowDestroy 才能用 */
  needsDestroy?: boolean
}

const BYS: CloseBy[] = [
  {
    by: 'call',
    icon: SquareFunction,
    label: () => t('调函数'),
    hint: () => t('调对象上的反射函数（CloseShop、Hide…）'),
    text: (x) => t('调函数 {f}', { f: x.function ?? '' }),
    make: () => ({ by: 'call', function: '' }),
  },
  {
    by: 'lua',
    icon: FileCode2,
    label: () => t('Lua 函数'),
    hint: () => t('调对象绑的 Lua 表上的函数（运行设置要允许步骤调 Lua）'),
    text: (x) => t('调 Lua {f}', { f: x.function ?? '' }),
    make: () => ({ by: 'lua', function: '' }),
  },
  {
    by: 'click',
    icon: MousePointerClick,
    label: () => t('点部件'),
    hint: () => t('点它里面的关闭按钮'),
    text: (x) => t('点 {p}', { p: x.part ?? '' }),
    make: () => ({ by: 'click', part: '' }),
  },
  {
    by: 'visibility',
    icon: EyeOff,
    label: () => t('设可见性'),
    hint: () => t('SetVisibility(Collapsed / Hidden)'),
    text: (x) => t('设成 {v}', { v: x.value ?? 'Collapsed' }),
    make: () => ({ by: 'visibility' }),
  },
  {
    by: 'remove',
    icon: Trash2,
    label: () => t('移除'),
    hint: () => t('RemoveFromParent'),
    text: () => t('从父级移除'),
    make: () => ({ by: 'remove' }),
  },
  {
    by: 'pop',
    icon: Layers,
    label: () => t('CommonUI 弹出'),
    hint: () => t('DeactivateWidget，在层级容器里就弹出'),
    text: () => t('CommonUI 弹出'),
    make: () => ({ by: 'pop' }),
  },
  {
    by: 'key',
    icon: Keyboard,
    label: () => t('按键'),
    hint: () => t('发一个按键给游戏视口（默认 Escape）'),
    text: (x) => t('按键 {k}', { k: x.key ?? 'Escape' }),
    make: () => ({ by: 'key' }),
  },
  {
    by: 'destroy',
    icon: Bomb,
    label: () => t('销毁 Actor'),
    hint: () => t('AActor::Destroy，运行设置里允许了才能用'),
    text: () => t('销毁 Actor'),
    make: () => ({ by: 'destroy' }),
    needsDestroy: true,
  },
]

export const closeByOf = (by: string) => BYS.find((b) => b.by === by)

/** 关闭方式的一句话（设置表格、流程图节点）：`调函数 CloseShop → 点 Header.BtnClose` */
export const closeHowText = (list: GtCloseHow[] | undefined) =>
  (list ?? []).map((x) => closeByOf(x.by)?.text(x) ?? x.by).join(' → ')

/**
 * 关闭方式列表（协议 5.2、效果图 1）：从上往下试，做完核对没过就试下一种。可拖动排序、增删，按 by 出字段。
 * 用在 obj.close 的检查器和设置里「按类记住的关闭方式」
 */
export function CloseHowList({
  value,
  onChange,
  parts = [],
  allowDestroy,
}: {
  value: GtCloseHow[]
  onChange: (v: GtCloseHow[]) => void
  /** 部件下拉的选项（点部件、设可见性用） */
  parts?: { part: string; class?: string }[]
  allowDestroy?: boolean
}) {
  const { ui, cn } = h()
  const set = (i: number, x: GtCloseHow) => onChange(value.map((y, k) => (k === i ? x : y)))
  const move = (from: number, to: number) => {
    if (from === to) return
    const next = [...value]
    const [x] = next.splice(from, 1)
    next.splice(to > from ? to - 1 : to, 0, x)
    onChange(next)
  }
  const add = (e: MouseEvent) =>
    openMenu(
      e,
      BYS.map((b) => ({
        label: b.label(),
        icon: b.icon,
        hint: b.hint(),
        disabled: b.needsDestroy && !allowDestroy,
        onClick: () => onChange([...value, b.make()]),
      })),
    )
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5">
      {value.map((x, i) => {
        const b = closeByOf(x.by)
        const Icon = b?.icon ?? SquareFunction
        return (
          <div
            key={i}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const raw = e.dataTransfer.getData('text/gt-close')
              if (raw) move(Number(raw), i)
            }}
            className="ue:flex ue:gap-1.5 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card ue:p-2"
          >
            <span
              draggable
              title={t('拖动排序')}
              onDragStart={(e) => e.dataTransfer.setData('text/gt-close', String(i))}
              className="ue:mt-1 ue:cursor-grab ue:text-subtle"
            >
              <GripVertical className="ue:h-3.5 ue:w-3.5" />
            </span>
            <span className="ue:mt-0.5 ue:flex ue:h-5 ue:w-5 ue:shrink-0 ue:items-center ue:justify-center ue:rounded-full ue:bg-hover ue:text-caption ue:text-muted">
              {i + 1}
            </span>
            <div className="ue:flex ue:min-w-0 ue:flex-1 ue:flex-col ue:gap-1.5">
              <div className="ue:flex ue:items-center ue:gap-1.5">
                <Icon className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-muted" />
                <span className="ue:text-footnote ue:font-medium ue:text-fg">{b?.label() ?? x.by}</span>
                <span className={cn('ue:min-w-0 ue:truncate ue:text-caption', i ? 'ue:text-subtle' : 'ue:text-muted')}>
                  {i ? t('上一种核对没过才试') : b?.hint()}
                </span>
                <ui.IconButton
                  size="sm"
                  className="ue:ml-auto"
                  label={t('删掉这种方式')}
                  onClick={() => onChange(value.filter((_, k) => k !== i))}
                >
                  <X className="ue:h-3.5 ue:w-3.5" />
                </ui.IconButton>
              </div>
              <HowFields value={x} onChange={(y) => set(i, y)} parts={parts} allowDestroy={allowDestroy} />
            </div>
          </div>
        )
      })}
      {!value.length && (
        <p className="ue:rounded-(--c-row-radius) ue:border ue:border-dashed ue:border-line ue:px-3 ue:py-2 ue:text-footnote ue:text-subtle">
          {t('没写方式：用运行设置里这个类记住的；也没有时按推荐（像关闭的函数 → 关闭按钮 → CommonUI 弹出 → 移除）')}
        </p>
      )}
      <button
        type="button"
        onClick={add}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData('text/gt-close')
          if (raw) move(Number(raw), value.length)
        }}
        className="ue:flex ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-(--c-row-radius) ue:border ue:border-dashed ue:border-line ue:px-3 ue:py-2 ue:text-left ue:text-footnote ue:text-fg ue:hover:bg-hover"
      >
        <Plus className="ue:h-3.5 ue:w-3.5 ue:shrink-0" />
        {t('加一种方式')}
        <span className="ue:min-w-0 ue:truncate ue:text-caption ue:text-subtle">
          {BYS.map((b) => b.label()).join(' · ')}
        </span>
      </button>
    </div>
  )
}

/** 一种方式自己的字段 */
function HowFields({
  value,
  onChange,
  parts,
  allowDestroy,
}: {
  value: GtCloseHow
  onChange: (v: GtCloseHow) => void
  parts: { part: string; class?: string }[]
  allowDestroy?: boolean
}) {
  const { ui } = h()
  const set = (k: keyof GtCloseHow, v: unknown) => {
    const out = { ...value } as Record<string, unknown>
    if (v === undefined || v === '') delete out[k]
    else out[k] = v
    onChange(out as unknown as GtCloseHow)
  }
  const fn = (placeholder: string) => (
    <ui.Input
      size="sm"
      className="ue:w-full ue:font-mono"
      placeholder={placeholder}
      value={value.function ?? ''}
      onChange={(e: { target: { value: string } }) => set('function', e.target.value)}
    />
  )
  switch (value.by) {
    case 'call':
      return (
        <>
          {fn('CloseShop')}
          <ArgsEdit
            value={
              (value.args && typeof value.args === 'object' && !Array.isArray(value.args) ? value.args : {}) as Record<
                string,
                unknown
              >
            }
            onChange={(a) => set('args', Object.keys(a).length ? a : undefined)}
          />
        </>
      )
    case 'lua':
      return (
        <>
          {fn('Close')}
          <ui.Input
            size="sm"
            className="ue:w-full ue:font-mono"
            placeholder={t('参数，逗号隔开（可不填）')}
            value={Array.isArray(value.args) ? value.args.map((x) => scalarText(x)).join(', ') : ''}
            onChange={(e: { target: { value: string } }) => {
              const s = e.target.value.trim()
              set('args', s ? s.split(',').map((x) => parseScalar(x.trim())) : undefined)
            }}
          />
        </>
      )
    case 'click':
      return <PartInput value={value.part ?? ''} onChange={(v) => set('part', v)} parts={parts} />
    case 'visibility':
      return (
        <div className="ue:flex ue:items-center ue:gap-1.5">
          <ui.Segmented
            size="sm"
            label={t('设成')}
            value={value.value ?? 'Collapsed'}
            onChange={(v: string) => set('value', v === 'Collapsed' ? undefined : v)}
            options={[
              { id: 'Collapsed', label: 'Collapsed' },
              { id: 'Hidden', label: 'Hidden' },
            ]}
          />
          <PartInput
            className="ue:min-w-0 ue:flex-1"
            value={value.part ?? ''}
            onChange={(v) => set('part', v)}
            parts={parts}
          />
        </div>
      )
    case 'key':
      return (
        <ui.Input
          size="sm"
          className="ue:w-40 ue:font-mono"
          placeholder="Escape"
          value={value.key ?? ''}
          onChange={(e: { target: { value: string } }) => set('key', e.target.value)}
        />
      )
    case 'destroy':
      return allowDestroy ? null : (
        <span className="ue:text-caption ue:text-warning">{t('运行设置里没允许销毁 Actor：跑到这里会报错')}</span>
      )
    default:
      return null
  }
}

/** 关完核对（协议 5.2）：找不到了 / 不在屏上 / 不核对 + 最多等多久 */
export function CloseVerify({
  verify,
  verifyMs,
  onChange,
  noMs,
}: {
  verify?: GtCloseVerify
  verifyMs?: number
  /** 不给「最多等」（设置里按类记的规则只有核对方式，等多久用默认） */
  noMs?: boolean
  onChange: (v: { verify?: GtCloseVerify; verifyMs?: number }) => void
}) {
  const { ui } = h()
  return (
    <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
      <ui.Segmented
        size="sm"
        label={t('关完核对')}
        value={verify ?? 'gone'}
        onChange={(v: GtCloseVerify) => onChange({ verify: v === 'gone' ? undefined : v, verifyMs })}
        options={[
          { id: 'gone', label: t('找不到了') },
          { id: 'hidden', label: t('不在屏上') },
          { id: 'none', label: t('不核对') },
        ]}
      />
      {verify !== 'none' && !noMs && (
        <span className="ue:flex ue:items-center ue:gap-1.5 ue:text-caption ue:text-subtle">
          {t('最多等')}
          <ui.Input
            size="sm"
            className="ue:w-20 ue:font-mono"
            placeholder="2000"
            value={verifyMs === undefined ? '' : String(verifyMs)}
            onChange={(e: { target: { value: string } }) => {
              const n = Number(e.target.value)
              onChange({
                verify,
                verifyMs: e.target.value.trim() && Number.isFinite(n) ? Math.max(0, Math.round(n)) : undefined,
              })
            }}
          />
          {t('毫秒')}
        </span>
      )}
    </div>
  )
}
