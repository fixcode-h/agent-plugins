import { ClipboardPaste, Copy, Pencil, Table, Table2 } from 'lucide-react'
import type { MouseEvent } from 'react'
import { openMenu } from '@panel/web/src/components/ui/item-menu'
import type { LuaGmBinding } from '../../../server/lua-gm/types.ts'
import { h, t } from '../../host.ts'
import { copyBinding, heldBinding, pasteBinding, sameBinding } from './bind-clipboard.ts'

/** 关联写成一句「文件 · 页签 的 主列」：按钮悬停和下拉说明用 */
export function bindWhere(b: LuaGmBinding) {
  const file = b.table.split('/').pop() ?? b.table
  return b.sheet ? `${file} · ${b.sheet}` : file
}

/**
 * 参数行右侧的表格按钮（GM 页、测试页运行参数共用）：没关联时点它关联，关联了也一直在、点它改关联（用户 2026-11-23）。
 * 关联了用强调色，来源（文件 · 页签 · 主列）放悬停提示，不再塞进输入框里占地方。
 * 右键：复制关联、粘贴关联（把一个参数的关联套到别的参数上，用户 2026-11-24），粘贴直接保存
 */
export function BindButton({
  binding,
  title,
  onClick,
  onPaste,
}: {
  binding?: LuaGmBinding
  /** 没关联时的提示 */
  title: string
  onClick: () => void
  /** 粘贴关联：不传时菜单里「粘贴」灰掉 */
  onPaste?: (b: LuaGmBinding) => void
}) {
  const { toast } = h()
  const Icon = binding ? Table2 : Table
  const menu = (e: MouseEvent) => {
    // 打开菜单时再取：复制是在别的参数的按钮上做的，这个按钮不会因此重画
    const held = heldBinding()
    openMenu(e, [
      { label: binding ? t('改关联…') : t('关联表格…'), icon: Pencil, onClick },
      'sep',
      {
        label: t('复制关联'),
        icon: Copy,
        disabled: !binding,
        hint: binding ? `${bindWhere(binding)} · ${binding.key}` : undefined,
        onClick: () => binding && copyBinding(binding),
      },
      {
        label: t('粘贴关联'),
        icon: ClipboardPaste,
        disabled: !onPaste || sameBinding(held, binding),
        hint: held ? `${bindWhere(held)} · ${held.key}` : undefined,
        onClick: async () => {
          const b = await pasteBinding()
          if (!b) return void toast.error(t('剪贴板里没有关联：先在别的参数的表格按钮上右键「复制关联」'))
          onPaste?.(b)
        },
      },
    ])
  }
  return (
    <button
      type="button"
      title={
        binding
          ? t('已关联 {where} 的 {key}，点这里改关联，右键复制粘贴', { where: bindWhere(binding), key: binding.key })
          : title
      }
      aria-label={binding ? t('改关联') : t('关联表格')}
      onClick={onClick}
      onContextMenu={menu}
      className={
        binding
          ? 'ue:grid ue:shrink-0 ue:cursor-pointer ue:text-accent-text ue:hover:text-fg'
          : 'ue:grid ue:shrink-0 ue:cursor-pointer ue:text-subtle ue:hover:text-fg'
      }
    >
      <Icon className="ue:h-3.5 ue:w-3.5" />
    </button>
  )
}
