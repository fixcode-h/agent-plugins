import { Table, Table2 } from 'lucide-react'
import type { LuaGmBinding } from '../../../server/lua-gm/types.ts'
import { t } from '../../host.ts'

/** 关联写成一句「文件 · 页签 的 主列」：按钮悬停和下拉说明用 */
export function bindWhere(b: LuaGmBinding) {
  const file = b.table.split('/').pop() ?? b.table
  return b.sheet ? `${file} · ${b.sheet}` : file
}

/**
 * 参数行右侧的表格按钮（GM 页、测试页运行参数共用）：没关联时点它关联，关联了也一直在、点它改关联（用户 2026-11-23）。
 * 关联了用强调色，来源（文件 · 页签 · 主列）放悬停提示，不再塞进输入框里占地方
 */
export function BindButton({
  binding,
  title,
  onClick,
}: {
  binding?: LuaGmBinding
  /** 没关联时的提示 */
  title: string
  onClick: () => void
}) {
  const Icon = binding ? Table2 : Table
  return (
    <button
      type="button"
      title={
        binding ? t('已关联 {where} 的 {key}，点这里改关联', { where: bindWhere(binding), key: binding.key }) : title
      }
      aria-label={binding ? t('改关联') : t('关联表格')}
      onClick={onClick}
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
