import { aliasCheck } from './alias.tsx'
import { apiCheck } from './api.tsx'
import { exprCheck } from './expr.tsx'
import { fieldCheck } from './field.tsx'
import { numberCheck } from './number.tsx'
import { rawCheck } from './raw.tsx'
import { registerCheck } from './registry.ts'
import { textCheck } from './text.tsx'
import { valueCheck } from './value.tsx'
import { widgetCheck } from './widget.tsx'

/**
 * 注册全部判断种类。顺序就是认的顺序（字段多的先认：写了 field 的同时也有 target，要先当成「字段」），
 * 也是「+ 条件」菜单的顺序。加新种类：写一个文件，在这里注册
 */
for (const k of [
  widgetCheck,
  textCheck,
  numberCheck,
  fieldCheck,
  valueCheck,
  apiCheck,
  exprCheck,
  aliasCheck,
  rawCheck,
])
  registerCheck(k)

export { allChecks, checkKindOf, registerCheck, type CheckKind } from './registry.ts'
