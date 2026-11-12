import { t } from '@shared/i18n'
import { KEYS, type ShortcutGroup } from '@/components/layout/ShortcutsHelp'

/** 表格页的快捷键（F1 / Ctrl+/ 打开面板的快捷键一览时排最前）：原来写在面板 ShortcutsHelp 里，搬成插件后由这里给 */
export function tablesShortcuts(): ShortcutGroup {
  const { MOD, SHIFT } = KEYS
  return {
    key: 'tables',
    title: t('表格'),
    rows: [
      ['Enter / F2', t('改当前格；改的时候 Enter 确认、Esc 取消')],
      [`${MOD}Enter`, t('改格子时把值填进选中的每一格')],
      [`${MOD}F`, t('表格顶上的查找条（Enter 下一个、{shift}Enter 上一个）', { shift: SHIFT })],
      [`${MOD}H`, t('查找替换')],
      [`${MOD}G`, t('跳到第几行或某个主键')],
      [`${MOD}↑ ↓ ← →`, t('跳到这一段数据的边缘')],
      [`${MOD}Home / ${MOD}End`, t('跳到开头 / 结尾')],
      ['PageUp / PageDown', t('翻页')],
      [`${SHIFT}Space / ${MOD}Space`, t('选中整行 / 整列')],
      [`${MOD}${SHIFT}= / ${MOD}-`, t('在上方插入一行 / 删除选中的行')],
      [`${MOD}D / ${MOD}${SHIFT}D`, t('向下填充 / 按序列递增填充')],
      [`${MOD}C / X / V`, t('复制、剪切、粘贴（和 Excel / WPS 互通）')],
      [`${MOD}Z / ${MOD}Y`, t('撤销 / 重做')],
      [`${MOD}S`, t('保存')],
      [`${MOD}${t('点击')}`, t('引用格：跳到被引用的那一行')],
      [`F1 / ${MOD}/`, t('打开这份快捷键一览')],
    ] as [string, string][],
  }
}
