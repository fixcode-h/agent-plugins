import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, MoreHorizontal, Plus, Power, Repeat1, Trash2, TriangleAlert } from 'lucide-react'
import { useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { GtStep } from '../../../../shared/gt-script/index.ts'
import {
  addHook,
  HOOK_GROUPS,
  hookList,
  makeHook,
  moveHook,
  moveHookTo,
  removeHook,
  setHook,
  type HookGroup,
  type HookItem,
} from '../../../../shared/gt-script/gm/hooks.ts'
import { h, t } from '../../../host.ts'
import { openMenu } from '../../../menu.tsx'
import { refText } from './gm-ref.ts'
import { onAddRequest } from './hook-commands.ts'
import { GmPickDialog, KIND_ICON } from './GmPickDialog.tsx'
import { GmRefEditor } from './GmRefEditor.tsx'

export const HOOK_LABEL: Record<HookGroup, () => string> = {
  before: () => t('执行前'),
  after: () => t('成功后'),
  fail: () => t('失败时'),
}

const HOOK_HINT: Record<HookGroup, () => string> = {
  before: () => t('这一步开始前跑（重做时不再跑）'),
  after: () => t('这一步通过后跑；$ret 是这一步「存到」的值'),
  fail: () => t('这一步最终失败后跑，跑完这一步照样算失败'),
}

/**
 * 检查器的「附带 GM」（分析文档 G10 / G12，效果图 6）：执行前 / 成功后 / 失败时 三组，每组按顺序跑。
 * 一项一行：点开改参数；↑↓ 或 Alt+↑↓ 排序；⋯ 里复制、挪到另一组、只第一次、出错时只记一笔 / 算失败、开关、删掉。
 * 数据操作都在 shared/gt-script/gm/hooks.ts
 */
export function HooksEditor({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui } = h()
  const [open, setOpen] = useState<string>()
  const [adding, setAdding] = useState<HookGroup>()
  // 节点右键「附带 GM：…加一条」走这里打开选 GM 的窗
  useEffect(() => onAddRequest(setAdding), [])

  const itemMenu = (e: MouseEvent, g: HookGroup, i: number, it: HookItem) => {
    e.stopPropagation()
    openMenu(e, [
      { label: t('复制一份'), icon: Copy, onClick: () => onChange(addHook(step, g, structuredClone(it))) },
      ...HOOK_GROUPS.filter((x) => x !== g).map((x) => ({
        label: t('挪到「{g}」', { g: HOOK_LABEL[x]() }),
        icon: ArrowDown,
        onClick: () => onChange(moveHookTo(step, g, i, x)),
      })),
      'sep',
      {
        label: t('循环里只第一次跑'),
        icon: Repeat1,
        checked: !!it.once,
        onClick: () => onChange(setHook(step, g, i, toggle(it, 'once'))),
      },
      { title: t('这条 GM 出错时') },
      {
        label: t('只记一笔（报告标黄，不算失败）'),
        checked: it.onError !== 'fail',
        onClick: () => onChange(setHook(step, g, i, withoutKey({ ...it }, 'onError'))),
      },
      {
        label: t('这一步算失败'),
        checked: it.onError === 'fail',
        onClick: () => onChange(setHook(step, g, i, { ...it, onError: 'fail' })),
      },
      'sep',
      {
        label: it.disabled ? t('打开') : t('关掉（先不跑）'),
        icon: Power,
        onClick: () => onChange(setHook(step, g, i, toggle(it, 'disabled'))),
      },
      { label: t('删掉'), icon: Trash2, danger: true, onClick: () => onChange(removeHook(step, g, i)) },
    ])
  }

  const onKey = (e: KeyboardEvent, g: HookGroup, i: number) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    onChange(moveHook(step, g, i, e.key === 'ArrowUp' ? i - 1 : i + 1))
  }

  return (
    <div className="ue:flex ue:flex-col ue:gap-3">
      {HOOK_GROUPS.map((g) => {
        const list = hookList(step, g)
        return (
          <div key={g} className="ue:flex ue:flex-col ue:gap-1">
            <div className="ue:flex ue:items-center ue:gap-2">
              <span className="ue:text-footnote ue:font-medium ue:text-fg">{HOOK_LABEL[g]()}</span>
              <span className="ue:min-w-0 ue:truncate ue:text-caption ue:text-subtle">{HOOK_HINT[g]()}</span>
              <ui.IconButton
                icon={Plus}
                size="sm"
                className="ue:ml-auto"
                label={t('加 GM 到「{g}」…', { g: HOOK_LABEL[g]() })}
                onClick={() => setAdding(g)}
              />
            </div>
            {list.map((it, i) => {
              const key = `${g}.${i}`
              const Icon = KIND_ICON[it.gm?.kind] ?? Plus
              const expanded = open === key
              return (
                <div
                  key={key}
                  className="ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card"
                  onContextMenu={(e) => itemMenu(e, g, i, it)}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    className="ue:flex ue:cursor-pointer ue:items-center ue:gap-1.5 ue:px-2 ue:py-1 ue:outline-none ue:focus-visible:ring-1 ue:focus-visible:ring-accent"
                    onClick={() => setOpen(expanded ? undefined : key)}
                    onKeyDown={(e) => onKey(e, g, i)}
                  >
                    {expanded ? (
                      <ChevronDown className="ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle" />
                    ) : (
                      <ChevronRight className="ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle" />
                    )}
                    <Icon className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-run" />
                    <span
                      className={`ue:min-w-0 ue:truncate ue:font-mono ue:text-footnote ${it.disabled ? 'ue:text-subtle ue:line-through' : 'ue:text-fg'}`}
                    >
                      {refText(it.gm)}
                    </span>
                    {it.once && <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{t('只第一次')}</span>}
                    {it.onError === 'fail' && (
                      <span className="ue:inline-flex ue:shrink-0 ue:items-center ue:gap-0.5 ue:text-caption ue:text-danger">
                        <TriangleAlert className="ue:h-3 ue:w-3" />
                        {t('出错算失败')}
                      </span>
                    )}
                    <span className="ue:ml-auto ue:flex ue:shrink-0 ue:items-center">
                      <ui.IconButton
                        icon={ArrowUp}
                        size="sm"
                        label={t('往前（Alt+↑）')}
                        disabled={i === 0}
                        onClick={(e: MouseEvent) => {
                          e.stopPropagation()
                          onChange(moveHook(step, g, i, i - 1))
                        }}
                      />
                      <ui.IconButton
                        icon={ArrowDown}
                        size="sm"
                        label={t('往后（Alt+↓）')}
                        disabled={i === list.length - 1}
                        onClick={(e: MouseEvent) => {
                          e.stopPropagation()
                          onChange(moveHook(step, g, i, i + 1))
                        }}
                      />
                      <ui.IconButton icon={MoreHorizontal} size="sm" label={t('更多')} onClick={(e: MouseEvent) => itemMenu(e, g, i, it)} />
                    </span>
                  </div>
                  {expanded && (
                    <div className="ue:border-t ue:border-line ue:px-2 ue:py-2">
                      <GmRefEditor
                        value={it.gm}
                        withRet={g !== 'before'}
                        onChange={(gm) => onChange(setHook(step, g, i, { ...it, gm }))}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
      {adding && (
        <GmPickDialog
          title={t('加 GM 到「{g}」', { g: HOOK_LABEL[adding]() })}
          onClose={() => setAdding(undefined)}
          onPick={(ref) => {
            const g = adding
            setAdding(undefined)
            onChange(addHook(step, g, makeHook(ref)))
            setOpen(`${g}.${hookList(step, g).length}`)
          }}
        />
      )}
    </div>
  )
}

function withoutKey<T extends object>(o: T, k: keyof T): T {
  delete o[k]
  return o
}

/** 开关类字段：开了写 true，关了去掉（默认值不写进文件） */
function toggle(it: HookItem, k: 'once' | 'disabled'): HookItem {
  return it[k] ? withoutKey({ ...it }, k) : { ...it, [k]: true }
}
