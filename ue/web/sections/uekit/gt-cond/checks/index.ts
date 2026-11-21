import { aliasCheck } from './alias.tsx'
import { apiCheck } from './api.tsx'
import { exprCheck } from './expr.tsx'
import { rawCheck } from './raw.tsx'
import { registerCheck } from './registry.ts'
import { propCheck } from './prop.tsx'
import { valueCheck } from './value.tsx'

/**
 * 注册全部判断种类。顺序就是认的顺序（写了 obj 的先当成「对象的属性」，协议 game-test-ref 第 4 节），
 * 也是「+ 条件」菜单的顺序。加新种类：写一个文件，在这里注册。
 * v3 按控件写的（target + visible / text / number / field）v4 不认，打开旧脚本时落到 raw（旧格式不迁移，按新写法重写成 prop）
 */
for (const k of [propCheck, valueCheck, apiCheck, exprCheck, aliasCheck, rawCheck]) registerCheck(k)

export { allChecks, checkKindOf, registerCheck, type CheckKind } from './registry.ts'
