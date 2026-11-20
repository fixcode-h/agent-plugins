import { getAt, pathStr, validateRefs, type GtScript } from '../../../../shared/gt-script/index.ts'
import type { Check, Issue } from './types.ts'

/**
 * v4 对象引用（协议 game-test-ref 第 10 节）：引用的写法、in 成环、部件和属性路径的写法、op 和类型、v3 旧写法
 * （选择器、按控件写的条件、invoke / find / widget.*、text(sel)）、迁移留下的 todo。规则在数据层 validateRefs，
 * 编辑页当场标错用的是同一份。v1–v3 只报 schema_old（先升级再查别的）
 */
export const refs: Check = {
  name: 'refs',
  summary: 'v4 对象引用：引用、部件、属性路径、比较、旧写法、迁移待定',
  run({ doc }) {
    return validateRefs(doc as GtScript).map((x): Issue => {
      const owner = x.owner ? (getAt(doc, x.owner) as Record<string, unknown> | undefined) : undefined
      return {
        ...(owner && typeof owner.id === 'string' ? { id: owner.id } : {}),
        path: pathStr(x.at),
        code: x.code,
        message: x.message,
        level: x.level,
      }
    })
  },
}
