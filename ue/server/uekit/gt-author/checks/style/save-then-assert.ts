import { issue, type Issue } from '../types.ts'
import { inRecorded, label, type StyleRule } from './ctx.ts'

/**
 * 「调接口存成 $v」紧跟「assert $v == …」，而 $v 别处不用：一步 expect 就够了，画布上少一个节点，
 * 失败时报告也直接是那次调用的实际值
 */
export const saveThenAssert: StyleRule = {
  name: 'save-then-assert',
  run({ slots, varUses }) {
    const out: Issue[] = []
    for (const rows of slots.values())
      for (let i = 0; i + 1 < rows.length; i++) {
        const a = rows[i]
        const b = rows[i + 1]
        const v = a.step.saveAs
        if (typeof v !== 'string' || !['api', 'obj.call'].includes(String(a.step.action)) || inRecorded(a)) continue
        if (b.step.action !== 'assert' || typeof b.step.expr !== 'string') continue
        const used = [...b.step.expr.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1])
        if (!used.length || used.some((x) => x !== v)) continue
        // 只在这两步出现（saveAs 字段本身不带 $，所以 $v 的次数就是用到的次数）
        if ((varUses.get(v) ?? 0) !== used.length) continue
        out.push(
          issue(
            a,
            'style_save_then_assert',
            `${label(a)} 存的 $${v} 只给下一步 ${label(b)} 断言用：把判断写成 ${label(a)} 的 expect（例 {"equals": 1} / {"gte": 3}），删掉 ${label(b)} 和 saveAs`,
            'warning',
          ),
        )
      }
    return out
  },
}
