import { Copy } from 'lucide-react'
import { h, t } from './host.ts'
import { copyText } from '@panel/web/src/components/ui/item-menu'

/**
 * 一行放不下的长路径（配置根、场景根这类本机绝对路径）：前面的目录省略成「…」，最后几段一直看得见，
 * 鼠标移上去看全路径，点一下复制。
 * 用户 2026-11-16：AssetForge 左栏底部和空状态里的配置根路径溢出、把左栏撑出横向滚动条。
 * 不用 direction: rtl 的老办法：路径里的「/」「.」在 rtl 下会跑到错的一头。
 */
export function PathText({
  path,
  tail = 2,
  className,
  copy = true,
}: {
  path: string
  /** 保证看得见的末尾段数 */
  tail?: number
  className?: string
  /** 点一下复制（默认开）；在按钮、链接里用时关掉 */
  copy?: boolean
}) {
  const { cn } = h()
  const norm = path.replace(/\\/g, '/')
  const parts = norm.split('/')
  const keep = Math.min(tail, Math.max(parts.length - 1, 0))
  const head = keep ? parts.slice(0, parts.length - keep).join('/') + '/' : ''
  const end = keep ? parts.slice(parts.length - keep).join('/') : norm
  const body = (
    <>
      {head && <span className="ue:min-w-0 ue:shrink ue:truncate">{head}</span>}
      <span className="ue:min-w-0 ue:shrink-0 ue:truncate ue:max-w-full">{end}</span>
    </>
  )
  const cls = cn('ue:inline-flex ue:max-w-full ue:min-w-0 ue:items-center ue:font-mono', className)
  if (!copy)
    return (
      <span className={cls} title={norm}>
        {body}
      </span>
    )
  return (
    <button
      type="button"
      title={t('{p}（点一下复制）', { p: norm })}
      onClick={() => copyText(norm)}
      className={cn(cls, 'ue:group ue:cursor-pointer ue:rounded-sm ue:text-left ue:hover:text-fg')}
    >
      {body}
      <Copy className="ue:ml-1 ue:h-3 ue:w-3 ue:shrink-0 ue:opacity-0 ue:transition-opacity ue:group-hover:opacity-70" />
    </button>
  )
}

/** 设置 →「组件」里的示例：短路径、长路径、窄容器里的长路径 */
export function PathTextSpecimen() {
  const long = 'G:/Project/qimei.hong_main/Project/docs/AssetForge'
  return (
    <div className="ue:flex ue:flex-col ue:gap-2 ue:text-caption ue:text-muted">
      <PathText path="docs/AssetForge" />
      <PathText path={long} />
      <div className="ue:w-56 ue:rounded-md ue:border ue:border-line ue:p-2">
        <PathText path={long} />
      </div>
      <div className="ue:w-40 ue:rounded-md ue:border ue:border-line ue:p-2">
        <PathText path={long} tail={1} copy={false} />
      </div>
    </div>
  )
}
