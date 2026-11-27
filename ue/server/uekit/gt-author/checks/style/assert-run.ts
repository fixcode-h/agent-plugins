import { apiNames, projectApis } from '../apis.ts'
import { issue, type Issue } from '../types.ts'
import { inRecorded, label, type Row, type StyleCtx, type StyleRule } from './ctx.ts'

/**
 * 连着好几步都只是在同一时刻「看一眼」（assert、只读接口带 expect）：合成一个 assert + {all: [...]}。
 * 统一条件失败时报告照样列出每一项的实际值，不会因为合并丢信息
 */
const MIN = 3

export const assertRun: StyleRule = {
  name: 'assert-run',
  async run(c) {
    const out: Issue[] = []
    const isCheck = await checker(c)
    for (const rows of c.slots.values()) {
      let start = -1
      const flush = (end: number) => {
        if (start >= 0 && end - start >= MIN) {
          const a = rows[start]
          const b = rows[end - 1]
          out.push(
            issue(
              a,
              'style_assert_run',
              `${label(a)}–${label(b)} 连着 ${end - start} 步都只是检查：合成一个 assert，cond 写 {"all": [每项一个判断]}（只读接口写 {"api": …, "args": …, "equals": …}），title 写这组检查想确认什么；失败时报告照样列出每一项的实际值`,
              'warning',
            ),
          )
        }
        start = -1
      }
      rows.forEach((r, i) => {
        if (isCheck(r)) {
          if (start < 0) start = i
        } else flush(i)
      })
      flush(rows.length)
    }
    return out
  },
}

/** 只读的接口才能当条件：项目接口看 _api.json 的 readOnly，自带接口离线不知道，不算 */
async function checker(c: StyleCtx) {
  const lib = projectApis(await c.env.api())
  const readOnly = (name: string) => lib.names.get(name)?.readOnly === true
  return (r: Row) => {
    if (inRecorded(r)) return false
    const s = r.step
    if (s.action === 'assert') return true
    if (s.action !== 'api' || s.expect === undefined || s.saveAs !== undefined) return false
    const names = apiNames({ api: s.api })
    return names.length === 1 && readOnly(names[0])
  }
}
