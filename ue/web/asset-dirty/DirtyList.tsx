import { Check, CheckCheck, ListChecks, Lock, Save, Square, Undo2, X } from 'lucide-react'
import { useState, type MouseEvent, type ReactNode } from 'react'
import { diffEmpty } from '../../shared/asset-diff/diff.ts'
import type { AssetDiff } from '../../shared/asset-diff/types.ts'
import { assetIcon } from '../asset-icons.ts'
import { Caret } from '../details/controls.tsx'
import { h, t } from '../host.ts'
import { guessClass } from '../inspect/layouts/pick.ts'
import type { Dirty } from './store.ts'

/** 列表最多露几行，再多在区里滚：别把下面的文件夹树挤没了 */
const MAX_ROWS = 7
const ROW = 44

/**
 * 资源页文件夹树上面的「当前修改」（效果图 designs/UE资源页当前修改-效果图）：编辑器里改了没保存的资源，一行一个，
 * 带「只读」「新建」标记；看过「改动」页的那一行补上改了什么的小标签。点一行打开它的「改动」页，悬停一行可以单独保存 / 放弃，
 * 「多选」进勾选模式只处理勾上的几个。没有改动时整组不画。
 * 只管显示和交互，数据由调用方给（store.ts），设置 →「组件」里的示例也用它
 */
export function DirtyList({
  items,
  sums = {},
  open,
  onOpenChange,
  selected,
  multi,
  onMulti,
  picked,
  onPicked,
  onOpenItem,
  onSave,
  onRevert,
  saveLabel,
  saveAllLabel,
  onMenu,
}: {
  items: Dirty[]
  /** 算过的差异（包路径 → 差异），有的行补小标签 */
  sums?: Record<string, AssetDiff>
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 右边正在看的资源包 */
  selected?: string
  /** 勾选模式 */
  multi: boolean
  onMulti: (on: boolean) => void
  picked: string[]
  onPicked: (pkgs: string[]) => void
  onOpenItem: (d: Dirty) => void
  onSave: (items: Dirty[]) => void
  onRevert: (items: Dirty[]) => void
  /** 「保存」还是「签出并保存」（P4 项目） */
  saveLabel: string
  /** 「全部保存」还是「全部签出并保存」 */
  saveAllLabel: string
  onMenu?: (e: MouseEvent, d: Dirty) => void
}) {
  const { cn } = h()
  if (!items.length) return null
  const chosen = items.filter((d) => picked.includes(d.package))
  const all = chosen.length === items.length
  const toggle = (pkg: string) => onPicked(picked.includes(pkg) ? picked.filter((p) => p !== pkg) : [...picked, pkg])

  return (
    <div className="ue:border-b ue:border-line ue:py-1">
      <div className="ue:flex ue:h-7 ue:items-center ue:gap-1.5 ue:pr-1.5 ue:pl-1.5 ue:text-footnote">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
          className="ue:flex ue:min-w-0 ue:flex-1 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:text-muted ue:hover:text-fg"
        >
          <span className="ue:flex ue:h-4 ue:w-4 ue:shrink-0 ue:items-center ue:justify-center">
            <Caret open={open} />
          </span>
          {multi ? (
            <span className="ue:shrink-0 ue:font-medium ue:whitespace-nowrap ue:text-fg">
              {t('已选 {n} / {m}', { n: chosen.length, m: items.length })}
            </span>
          ) : (
            <>
              <span className="ue:h-1.5 ue:w-1.5 ue:shrink-0 ue:rounded-full ue:bg-warning" />
              <span className="ue:font-medium ue:text-fg">{t('当前修改')}</span>
              <span className="ue:text-caption ue:text-subtle">{items.length}</span>
            </>
          )}
        </button>
        {multi ? (
          <>
            <Mini
              icon={all ? <Square /> : <CheckCheck />}
              title={all ? t('全不选') : t('全选')}
              onClick={() => onPicked(all ? [] : items.map((d) => d.package))}
            />
            <Mini icon={<Save />} disabled={!chosen.length} onClick={() => onSave(chosen)}>
              {saveLabel}
            </Mini>
            <Mini icon={<Undo2 />} disabled={!chosen.length} onClick={() => onRevert(chosen)}>
              {t('放弃')}
            </Mini>
            <Mini icon={<X />} title={t('退出多选')} onClick={() => onMulti(false)} />
          </>
        ) : (
          <>
            <Mini icon={<ListChecks />} title={t('多选：只保存 / 放弃其中几个')} onClick={() => onMulti(true)} />
            <Mini
              icon={<Save />}
              border
              onClick={() => onSave(items)}
              title={t('保存全部 {n} 个', { n: items.length })}
            >
              {saveAllLabel}
            </Mini>
          </>
        )}
      </div>
      {open && (
        <div role="list" className="ue:overflow-y-auto" style={{ maxHeight: MAX_ROWS * ROW }}>
          {items.map((d) => {
            const name = d.package.split('/').pop() ?? d.package
            const dir = d.package.slice(0, d.package.length - name.length - 1)
            const sum = sums[d.package]
            const { icon: Icon, tone } = assetIcon(sum?.class ?? guessClass(d.package) ?? '')
            const on = picked.includes(d.package)
            return (
              <div
                key={d.package}
                role="listitem"
                tabIndex={0}
                title={d.file}
                onClick={() => (multi ? toggle(d.package) : onOpenItem(d))}
                onKeyDown={(e) => e.key === 'Enter' && (multi ? toggle(d.package) : onOpenItem(d))}
                onContextMenu={onMenu && ((e) => onMenu(e, d))}
                style={{ height: ROW }}
                className={cn(
                  'ue:group ue:mx-1 ue:flex ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-(--c-row-radius) ue:pr-1.5 ue:pl-[22px] ue:text-footnote ue:outline-none ue:focus-visible:bg-hover',
                  selected === d.package ? 'ue:bg-sel' : 'ue:hover:bg-hover',
                )}
              >
                {multi && (
                  <span
                    className={cn(
                      'ue:flex ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:items-center ue:justify-center ue:rounded-sm ue:border',
                      on ? 'ue:border-accent ue:bg-accent ue:text-on-accent' : 'ue:border-line-strong',
                    )}
                  >
                    {on && <Check className="ue:h-2.5 ue:w-2.5" strokeWidth={3} />}
                  </span>
                )}
                <Icon className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0', tone)} />
                <span className="ue:flex ue:min-w-0 ue:flex-1 ue:flex-col">
                  <span className="ue:truncate ue:font-mono ue:text-fg">{name}</span>
                  <span className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">{dir}</span>
                </span>
                <span className="ue:flex ue:shrink-0 ue:items-center ue:gap-1">
                  {d.isNew && <Chip tone="add">{t('新建')}</Chip>}
                  {d.readOnly && !d.isNew && (
                    <Chip title={t('文件只读：保存时先签出')}>
                      <Lock className="ue:h-2.5 ue:w-2.5" />
                      {t('只读')}
                    </Chip>
                  )}
                  {sum && !d.isNew && <SumChips diff={sum} />}
                  {!multi && (
                    <span className="ue:hidden ue:items-center ue:gap-0.5 ue:group-hover:flex ue:group-focus-visible:flex">
                      <Mini
                        icon={<Save />}
                        title={saveLabel}
                        onClick={(e) => {
                          e.stopPropagation()
                          onSave([d])
                        }}
                      />
                      <Mini
                        icon={<Undo2 />}
                        title={t('放弃改动')}
                        onClick={(e) => {
                          e.stopPropagation()
                          onRevert([d])
                        }}
                      />
                    </span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** 标题行和悬停行上的小按钮 */
function Mini({
  icon,
  children,
  title,
  border,
  disabled,
  onClick,
}: {
  icon?: ReactNode
  children?: ReactNode
  title?: string
  border?: boolean
  disabled?: boolean
  onClick: (e: MouseEvent) => void
}) {
  const { cn } = h()
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'ue:inline-flex ue:h-6 ue:shrink-0 ue:cursor-pointer ue:items-center ue:gap-1 ue:rounded-md ue:px-1.5 ue:text-caption ue:whitespace-nowrap ue:text-muted ue:hover:bg-hover ue:hover:text-fg ue:disabled:cursor-default ue:disabled:opacity-40 ue:[&>svg]:h-3.5 ue:[&>svg]:w-3.5',
        border && 'ue:border ue:border-line',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

function Chip({ tone, title, children }: { tone?: 'add' | 'mod'; title?: string; children: ReactNode }) {
  const { cn } = h()
  return (
    <span
      title={title}
      className={cn(
        'ue:inline-flex ue:h-[18px] ue:items-center ue:gap-0.5 ue:rounded-(--c-badge-radius) ue:px-1.5 ue:text-caption ue:whitespace-nowrap',
        tone === 'add'
          ? 'ue:bg-[color-mix(in_oklab,var(--c-grid-added)_14%,transparent)] ue:text-[var(--c-grid-added)]'
          : tone === 'mod'
            ? 'ue:bg-[color-mix(in_oklab,var(--c-grid-edited)_16%,transparent)] ue:text-fg'
            : 'ue:bg-sel ue:text-muted',
      )}
    >
      {children}
    </span>
  )
}

/** 看过「改动」页之后补的小标签：只放最要紧的一两个，行里放不下 */
function SumChips({ diff }: { diff: AssetDiff }) {
  const s = diff.stats
  if (diffEmpty(diff)) return <Chip>{t('结构没变')}</Chip>
  const parts = [
    s.props > 0 && t('属性 {n}', { n: s.props }),
    s.compAdd + s.compDel > 0 && t('组件 {n}', { n: s.compAdd + s.compDel }),
    s.rows > 0 && t('行 {n}', { n: s.rows }),
    s.vars + s.settings > 0 && t('变量 {n}', { n: s.vars + s.settings }),
    s.graphs > 0 && t('图 {n}', { n: s.graphs }),
  ].filter(Boolean) as string[]
  return (
    <>
      {parts.slice(0, 2).map((p) => (
        <Chip key={p} tone="mod">
          {p}
        </Chip>
      ))}
    </>
  )
}

/** 设置 →「组件」里的示例：四种状态各一行（普通、只读、新建、看过改动的） */
export function DirtyListSpecimen() {
  const items: Dirty[] = [
    {
      package: '/Game/AgentTest/AssetForge/DA_ForgeConfig',
      file: 'Content/AgentTest/AssetForge/DA_ForgeConfig.uasset',
      readOnly: false,
    },
    { package: '/Game/Characters/Hero/BP_Hero', file: 'Content/Characters/Hero/BP_Hero.uasset', readOnly: true },
    { package: '/Game/UI/Menu/WBP_MainMenu', file: 'Content/UI/Menu/WBP_MainMenu.uasset', readOnly: false },
    {
      package: '/Game/AgentTest/AssetForge/MI_ForgeGlow_Blue',
      file: 'Content/AgentTest/AssetForge/MI_ForgeGlow_Blue.uasset',
      readOnly: false,
      isNew: true,
    },
  ]
  const [open, setOpen] = useState(true)
  const [multi, setMulti] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [sel, setSel] = useState(items[0].package)
  const sums = {
    [items[0].package]: {
      class: 'PrimaryDataAsset',
      stats: { props: 4, compAdd: 0, compDel: 0, rows: 0, vars: 0, settings: 0, graphs: 0 },
    } as unknown as AssetDiff,
  }
  return (
    <div className="ue:w-full ue:max-w-sm ue:overflow-hidden ue:rounded-lg ue:border ue:border-line ue:bg-card">
      <DirtyList
        items={items}
        sums={sums}
        open={open}
        onOpenChange={setOpen}
        selected={sel}
        multi={multi}
        onMulti={(on) => {
          setMulti(on)
          if (!on) setPicked([])
        }}
        picked={picked}
        onPicked={setPicked}
        onOpenItem={(d) => setSel(d.package)}
        onSave={() => undefined}
        onRevert={() => undefined}
        saveLabel={t('签出并保存')}
        saveAllLabel={t('全部签出并保存')}
      />
    </div>
  )
}
