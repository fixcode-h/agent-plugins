import { CircleDot, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ASSET_KINDS } from './asset-icons.ts'
import { h, t } from './host.ts'

/** 下拉里的一行 */
export interface SuggestRow {
  key: string
  /** 选中后填进框里的文字 */
  value: string
  label: string
  /** 名字后面的灰字（资源路径） */
  detail?: string
  icon?: LucideIcon
  tone?: string
  /** 淡显（没认出来的，不一定对） */
  dim?: boolean
}

/**
 * 能手填、也能边打字边从下拉里挑的输入框（用户 2026-11-17：阻挡界面的 WBP 输入框要能下拉搜索）。
 * 和 SearchPick 不同，框本身就是输入框，下拉只是建议：不选也照样用手填的文字。
 * 候选由 suggest 同步给（本地索引里筛，不发请求）；聚焦就展开，上下键选、回车填入、Esc 收起。
 * 下拉和面板的菜单同一套样式（--c-menu-*），设置 →「组件」里跟「菜单」「输入框」的调节项
 */
export function SuggestInput({
  value,
  onChange,
  suggest,
  placeholder,
  className,
  inputClassName,
  status,
  empty,
}: {
  value: string
  onChange: (v: string) => void
  suggest: (q: string) => { rows: SuggestRow[]; total: number }
  placeholder?: string
  className?: string
  inputClassName?: string
  /** 下拉底部的一行小字：候选从哪来、正在读索引、读失败 */
  status?: ReactNode
  /** 一个候选都没有时（还没建索引）的说明 */
  empty?: string
}) {
  const { ui, cn } = h()
  const [open, setOpen] = useState(false)
  const [act, setAct] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const { rows, total } = open ? suggest(value) : { rows: [], total: 0 }

  // 点外面收起；输入框失焦不收（点下拉里的行时输入框会先失焦）
  useEffect(() => {
    if (!open) return
    const off = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', off)
    return () => document.removeEventListener('pointerdown', off)
  }, [open])

  // 键盘选到的行滚进可见范围
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${act}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [act])

  const pick = (r: SuggestRow) => {
    onChange(r.value)
    setOpen(false)
  }

  return (
    <div ref={box} className={cn('ue:relative', className)}>
      <ui.Input
        size="sm"
        className={cn('ue:w-full', inputClassName)}
        placeholder={placeholder}
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onChange={(e: { target: { value: string } }) => {
          onChange(e.target.value)
          setOpen(true)
          setAct(0)
        }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'ArrowDown') {
            if (!open) setOpen(true)
            else setAct((a) => Math.min(a + 1, rows.length - 1))
          } else if (e.key === 'ArrowUp') setAct((a) => Math.max(a - 1, 0))
          else if (e.key === 'Enter' && open && rows[act]) pick(rows[act])
          // 收起下拉时不让 Esc 冒到弹窗把整个设置关掉
          else if (e.key === 'Escape' && open) {
            setOpen(false)
            e.stopPropagation()
          } else return
          e.preventDefault()
        }}
      />
      {open && (rows.length > 0 || status || empty) && (
        <div
          role="listbox"
          className="ue:absolute ue:inset-x-0 ue:top-full ue:z-30 ue:mt-1 ue:flex ue:flex-col ue:rounded-(--c-menu-radius) ue:border-(length:--c-menu-border) ue:border-pop-edge ue:bg-(--c-menu-bg) ue:p-1 ue:text-footnote ue:shadow-pop ue:motion-safe:animate-pop"
        >
          <div ref={list} className="ue:max-h-60 ue:overflow-auto">
            {rows.map((r, i) => {
              const Icon = r.icon ?? CircleDot
              return (
                <button
                  key={r.key}
                  type="button"
                  data-i={i}
                  role="option"
                  aria-selected={i === act}
                  // 按下时不让输入框失焦，点完光标还在框里
                  onPointerDown={(e) => e.preventDefault()}
                  onPointerEnter={() => setAct(i)}
                  onClick={() => pick(r)}
                  className={cn(
                    'ue:flex ue:h-7 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-(--c-menu-itemRadius) ue:px-2 ue:text-left',
                    i === act && 'ue:bg-hover',
                    r.dim && 'ue:opacity-70',
                  )}
                >
                  <Icon className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0', r.tone ?? 'ue:text-subtle')} />
                  <span className="ue:shrink-0 ue:truncate ue:font-mono ue:text-fg">{r.label}</span>
                  {r.detail && (
                    <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-right ue:font-mono ue:text-caption ue:text-subtle">
                      {r.detail}
                    </span>
                  )}
                </button>
              )
            })}
            {!rows.length && (
              <p className="ue:px-2 ue:py-1.5 ue:text-subtle">
                {value.trim() ? t('没有匹配的，保存时照填的用') : (empty ?? t('没有候选，可以直接填'))}
              </p>
            )}
          </div>
          {(status || total > rows.length) && (
            <div className="ue:mt-1 ue:flex ue:items-center ue:gap-2 ue:border-t ue:border-line ue:px-2 ue:pt-1.5 ue:pb-0.5 ue:text-caption ue:text-subtle">
              {total > rows.length && <span>{t('还有 {n} 个，多打几个字', { n: total - rows.length })}</span>}
              {status && <span className="ue:ml-auto ue:min-w-0 ue:truncate">{status}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 设置 →「组件」里的示例：假数据，不连 UE */
const DEMO: SuggestRow[] = [
  'WBP_Notice /Game/UI/Notice',
  'WBP_Guide /Game/UI/Guide',
  'WBP_ActivityPopup /Game/UI/Activity',
  'WBP_Reconnect /Game/UI/Common',
  'W_LoginReward /Game/UI/Login',
].map((s) => {
  const [name, dir] = s.split(' ')
  const { icon, tone } = ASSET_KINDS['umg-widget']
  return { key: name, value: name, label: name, detail: `${dir}/${name}`, icon, tone }
})

export function SuggestInputSpecimen() {
  const [v, setV] = useState('')
  return (
    <div className="ue:flex ue:h-72 ue:w-full ue:max-w-xl ue:flex-col ue:gap-2 ue:text-body">
      <SuggestInput
        value={v}
        onChange={setV}
        inputClassName="ue:font-mono"
        placeholder={t('WBP 类名或资产路径，例如 WBP_Notice')}
        suggest={(q) => {
          const s = q.trim().toLowerCase()
          const rows = DEMO.filter((r) => !s || r.detail!.toLowerCase().includes(s))
          return { rows, total: rows.length }
        }}
        status={t('来自 UEToVS 索引 · 控件蓝图 {n} 个', { n: DEMO.length })}
      />
    </div>
  )
}
