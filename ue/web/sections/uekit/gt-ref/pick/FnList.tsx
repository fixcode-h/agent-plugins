import { Crosshair } from 'lucide-react'
import type { GtPropItem, GtPropKind } from '../../../../../shared/gt-script/index.ts'
import { h, t } from '../../../../host.ts'

/** 行尾准星的提示：选对象时加进 / 移出标识组，抓取值时取 / 不取这个值 */
export const pickTip = (on: boolean, takeValue?: boolean) =>
  takeValue ? (on ? t('不取这个值') : t('取这个值')) : on ? t('移出标识组') : t('加进唯一标识组')

/**
 * 「方法」页的函数列表：函数没有值（用户 2026-11-21：没值就别画空的值框），一行是名字 + 参数占满，
 * 返回类型、定义在哪个父类放右边；悬停看完整签名。UE 类和 Lua 类共用。
 * 无参的取值函数（UE 给了路径 `@.名字()`）行尾有准星，加进唯一标识组当条件（用户 2026-11-21）
 */
export function FnList({
  items,
  picked,
  onPick,
  takeValue,
}: {
  items: GtPropItem[]
  /** 抓取值时：列进来的都是能取的取值函数（DetailPane 筛过），准星取它的返回值 */
  takeValue?: boolean
  picked: Set<string>
  onPick: (prop: string, kind: GtPropKind | undefined, value: unknown, item?: GtPropItem) => void
}) {
  const { cn } = h()
  const on = (it: GtPropItem) => picked.has(it.prop) || (!!it.luaFn?.path && picked.has(it.luaFn.path))
  return (
    <div role="list" className="ue:flex ue:flex-col ue:py-1">
      {items.map((it) => {
        const fn = it.luaFn!
        const name = it.name.replace(/\(.*$/, '')
        const sig = `${name}(${fn.params.join(', ')})${fn.ret ? ` → ${fn.ret}` : ''}`
        return (
          <div
            key={it.prop}
            role="listitem"
            title={[sig, fn.from ? t('定义在 {cls}', { cls: fn.from }) : '', it.note ?? '', it.why ?? '']
              .filter(Boolean)
              .join('\n')}
            className="ue:flex ue:min-h-7 ue:items-center ue:gap-2 ue:border-b ue:border-line/40 ue:px-3 ue:py-1 ue:text-footnote ue:hover:bg-hover"
          >
            <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono">
              <span className={cn(fn.from ? 'ue:text-muted' : 'ue:text-fg')}>{name}</span>
              <span className="ue:text-subtle">({fn.params.join(', ')})</span>
            </span>
            {fn.pure && (
              <span className="ue:shrink-0 ue:rounded-sm ue:bg-hover ue:px-1 ue:text-caption ue:text-subtle">
                {t('纯函数')}
              </span>
            )}
            {fn.ret && (
              <span className="ue:max-w-[30%] ue:shrink-0 ue:truncate ue:font-mono ue:text-caption ue:text-subtle">
                {fn.ret}
              </span>
            )}
            {fn.from && (
              <span className="ue:max-w-[30%] ue:shrink-0 ue:truncate ue:text-caption ue:text-subtle">{fn.from}</span>
            )}
            <span className="ue:flex ue:w-6 ue:shrink-0 ue:justify-center">
              {(takeValue || it.comparable !== false) && (
                <button
                  type="button"
                  aria-pressed={on(it)}
                  aria-label={pickTip(on(it), takeValue)}
                  title={pickTip(on(it), takeValue)}
                  onClick={() => onPick(takeValue && it.luaFn?.path ? it.luaFn.path : it.prop, it.kind, it.value, it)}
                  className={cn(
                    'ue:flex ue:h-6 ue:w-6 ue:cursor-pointer ue:items-center ue:justify-center ue:rounded-md',
                    on(it) ? 'ue:bg-accent ue:text-on-accent' : 'ue:text-subtle ue:hover:bg-hover ue:hover:text-fg',
                  )}
                >
                  <Crosshair className="ue:h-3.5 ue:w-3.5" />
                </button>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}
