import type { ExprError } from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'

/** 表达式错误码 → 给人看的话（解析器在 shared，不带文案） */
export function exprErrorText(e: ExprError): string {
  switch (e.code) {
    case 'empty':
      return t('表达式是空的')
    case 'too_long':
      return t('表达式太长（最多 1000 字）')
    case 'bad_char':
      return t('不认识的字符「{c}」', { c: e.token ?? '' })
    case 'unterminated_string':
      return t('字符串没有收尾的引号')
    case 'expected':
      return t('这里少了「{c}」', { c: e.token ?? '' })
    case 'unexpected_end':
      return e.token ? t('没写完：少了「{c}」', { c: e.token }) : t('没写完')
    default:
      return t('这里不该出现「{c}」', { c: e.token ?? '' })
  }
}

/** 取值来源的一句说明（补全下拉里的灰字） */
export function sourceDoc(s: string): string {
  switch (s) {
    case 'gi':
      return t('GameInstance')
    case 'gs':
      return t('GameState')
    case 'gm':
      return t('GameMode（服务器 / 单机）')
    case 'ps':
      return t('本地 PlayerState')
    case 'pc':
      return t('PlayerController')
    case 'pawn':
      return t('玩家角色')
    case 'hud':
      return t('HUD')
    case 'sub':
      return t('子系统：@sub.类名')
    case 'actor':
      return t('Actor：@actor[tag=X]')
    case 'obj':
      return t('脚本里的对象：@obj.名字')
    case 'luaMod':
      return t('Lua 模块：@luaMod.require路径')
    case 'luaG':
      return t('Lua 全局变量')
    case 'cvar':
      return t('控制台变量')
    default:
      return ''
  }
}
