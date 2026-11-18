import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { show } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import { SearchBox } from '../../../ui.tsx'
import { SRC_ORDER, type VarGroup, type VarItem, type VarSrc } from './model.ts'

export const srcLabel = (s: VarSrc) => ({ cpp: 'C++', bp: t('蓝图'), lua: 'Lua' })[s]

/** 组标题前的小标签：三组三个颜色，一眼分开 */
export function SrcBadge({ src }: { src: VarSrc }) {
  const { cn } = h()
  return (
    <span
      className={cn(
        'ue:shrink-0 ue:rounded-sm ue:px-1.5 ue:py-px ue:text-caption',
        src === 'cpp' && 'ue:bg-accent/12 ue:text-accent',
        src === 'bp' && 'ue:bg-run/12 ue:text-run',
        src === 'lua' && 'ue:bg-warning/12 ue:text-warning',
      )}
    >
      {srcLabel(src)}
    </span>
  )
}

export const itemKey = (g: VarGroup, it: VarItem) => `${g.src}:${g.class ?? g.file ?? ''}:${it.path}`

/**
 * 按 C++ / 蓝图 / Lua 分组的字段表（定稿 9.4）：代码变量弹窗、对象标识弹窗、检查器共用。
 * 顶上「全部 / C++ n / 蓝图 n / Lua n」筛选加搜索；每组标题是类名 + 头文件 / 资产 / Lua 文件，可以折叠，
 * 引擎基类默认收起；像动画、计时的字段灰掉。pick 是单选（圆点）还是多选（勾）由调用方定
 */
export function FieldGroups({
  groups,
  selected,
  onToggle,
  multi,
  extra,
  showValue,
}: {
  groups: VarGroup[]
  selected: Set<string>
  onToggle: (g: VarGroup, it: VarItem) => void
  multi?: boolean
  /** 名字后面的附加一列（对象标识的「同类唯一」） */
  extra?: (it: VarItem) => ReactNode
  showValue?: boolean
}) {
  const { ui, cn } = h()
  const [src, setSrc] = useState<'all' | VarSrc>('all')
  const [q, setQ] = useState('')
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const count = (s: VarSrc) => groups.filter((g) => g.src === s).reduce((n, g) => n + g.items.length, 0)
  const low = q.trim().toLowerCase()
  const shown = [...groups]
    .sort((a, b) => SRC_ORDER.indexOf(a.src) - SRC_ORDER.indexOf(b.src))
    .filter((g) => src === 'all' || g.src === src)
    .map((g) => ({
      g,
      items: low
        ? g.items.filter((x) => x.name.toLowerCase().includes(low) || (x.note ?? '').toLowerCase().includes(low))
        : g.items,
    }))
    .filter((x) => x.items.length || !low)
  const total = groups.reduce((n, g) => n + g.items.length, 0)

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-3 ue:py-2">
        <SearchBox live onSearch={setQ} placeholder={t('搜字段名、说明')} />
        <ui.Segmented
          size="sm"
          className="ue:ml-auto"
          label={t('来源')}
          value={src}
          onChange={setSrc}
          options={[
            { id: 'all' as const, label: t('全部 {n}', { n: total }) },
            ...SRC_ORDER.filter((s) => count(s)).map((s) => ({ id: s, label: `${srcLabel(s)} ${count(s)}` })),
          ]}
        />
      </div>
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
        {!shown.length && (
          <p className="ue:px-4 ue:py-6 ue:text-center ue:text-footnote ue:text-subtle">{t('没有字段')}</p>
        )}
        {shown.map(({ g, items }) => {
          const gk = `${g.src}:${g.class ?? g.file ?? g.title}`
          const isFolded = folded[gk] ?? !!g.collapsed
          return (
            <div key={gk}>
              <button
                type="button"
                onClick={() => setFolded({ ...folded, [gk]: !isFolded })}
                className="ue:sticky ue:top-0 ue:z-10 ue:flex ue:h-8 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:border-b ue:border-line/60 ue:bg-panel ue:px-3 ue:text-left ue:text-footnote"
              >
                {isFolded ? (
                  <ChevronRight className="ue:h-3.5 ue:w-3.5 ue:text-subtle" />
                ) : (
                  <ChevronDown className="ue:h-3.5 ue:w-3.5 ue:text-subtle" />
                )}
                <SrcBadge src={g.src} />
                <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-fg">
                  {g.title}
                  {(g.file ?? g.asset) && <span className="ue:text-subtle"> · {g.file ?? g.asset}</span>}
                </span>
                <span className="ue:ml-auto ue:text-caption ue:text-subtle ue:tabular-nums">{items.length}</span>
              </button>
              {!isFolded &&
                items.map((it) => {
                  const k = itemKey(g, it)
                  const on = selected.has(k)
                  const disabled = it.kind === 'fn' && it.callable === false
                  return (
                    <button
                      key={k}
                      type="button"
                      disabled={disabled}
                      title={disabled ? it.why : it.note}
                      aria-pressed={on}
                      onClick={() => onToggle(g, it)}
                      className={cn(
                        'ue:grid ue:h-8 ue:w-full ue:cursor-pointer ue:grid-cols-[16px_minmax(0,1.2fr)_minmax(0,0.7fr)_auto_minmax(0,1.4fr)_auto] ue:items-center ue:gap-2 ue:border-b ue:border-line/40 ue:px-3 ue:text-left ue:text-footnote ue:hover:bg-hover ue:disabled:cursor-not-allowed',
                        on && 'ue:bg-sel',
                        (it.dim || disabled) && 'ue:opacity-55',
                      )}
                    >
                      <span
                        className={cn(
                          'ue:h-3.5 ue:w-3.5 ue:border ue:border-line',
                          multi ? 'ue:rounded-sm' : 'ue:rounded-full',
                          on && 'ue:border-accent ue:bg-accent',
                        )}
                      />
                      <span className="ue:truncate ue:font-mono ue:text-fg">
                        {it.kind === 'fn' ? `${it.name}()` : it.path || it.name}
                      </span>
                      <span className="ue:truncate ue:font-mono ue:text-subtle">{it.type}</span>
                      <span className="ue:flex ue:items-center ue:gap-1">
                        {it.kind === 'fn' && (
                          <span className="ue:rounded-sm ue:bg-success/12 ue:px-1 ue:text-caption ue:text-success">
                            {t('只读函数')}
                          </span>
                        )}
                        {it.line && <span className="ue:font-mono ue:text-caption ue:text-warning">:{it.line}</span>}
                        {extra?.(it)}
                      </span>
                      <span className="ue:truncate ue:text-subtle">{it.note}</span>
                      <span className="ue:max-w-28 ue:truncate ue:text-right ue:font-mono ue:text-fg">
                        {showValue && it.value !== undefined ? show(it.value) : ''}
                      </span>
                    </button>
                  )
                })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
