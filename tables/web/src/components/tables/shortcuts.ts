import { t } from '@shared/i18n'
import { KEYS, type ShortcutGroup } from '@/components/layout/ShortcutsHelp'

/** 表格页的快捷键（F1 / Ctrl+/ 打开面板的快捷键一览时排最前）：原来写在面板 ShortcutsHelp 里，搬成插件后由这里给 */
export function tablesShortcuts(): ShortcutGroup {
  const { MOD, SHIFT, ALT } = KEYS
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
      ['PageUp / PageDown', t('翻一屏')],
      [`${SHIFT}Space / ${MOD}Space`, t('选中整行 / 整列')],
      [t('点行号 / 列名'), t('选中整行 / 整列；按住拖动多选，{shift}点击扩大', { shift: SHIFT })],
      [t('拖到表格边上'), t('拖选时自动滚动，离边越远滚得越快')],
      [`${MOD}${SHIFT}= / ${MOD}-`, t('在上方插入行（选中几行插几行）/ 删除选中的行')],
      [`${ALT}↑ / ${ALT}↓`, t('选中的行上移 / 下移一行')],
      [`${MOD}D / ${MOD}${SHIFT}D`, t('向下填充 / 按序列递增填充')],
      [
        t('拖选区右下角的小方块'),
        t('往下、往右填充：几格数字按步长递增，结尾带数字的文字往后数；按住 {mod}复制和递增对调', { mod: MOD }),
      ],
      [`${MOD}C / X / V`, t('复制、剪切、粘贴（和 Excel / WPS 互通）')],
      [`${MOD}Z / ${MOD}Y`, t('撤销 / 重做')],
      [`${MOD}S`, t('保存')],
      [`${MOD}${t('点击')}`, t('引用格：跳到被引用的那一行')],
      [`F1 / ${MOD}/`, t('打开这份快捷键一览')],
    ] as [string, string][],
  }
}
