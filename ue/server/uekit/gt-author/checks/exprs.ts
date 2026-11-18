import {
  exprFunction,
  exprOfValue,
  parseExpr,
  refsOf,
  VALUE_SOURCES,
  type ExprError,
} from '../../../../shared/gt-script/index.ts'
import { ownFields } from '../walk.ts'
import { issue, type Check, type Issue, type StepRef } from './types.ts'

/**
 * 表达式（协议第 3 节）：值里的 "=…"、条件里的 { expr }、assert 的 expr。语法用数据层的 parseExpr（和面板的表达式框同一份），
 * 再看用到的函数和来源认不认识。接口（Object.Count、项目.…）是不是只读、在不在，要编辑器或 _api.json（apis 检查）
 */
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

const WHY: Record<ExprError['code'], string> = {
  empty: '是空的',
  too_long: '超过 1000 字，写成项目接口更好维护',
  bad_char: '有不认识的字符',
  unterminated_string: '字符串没有收尾的引号',
  unexpected: '这里不该出现',
  expected: '这里少了',
  unexpected_end: '没写完',
}

/** 一步里所有的表达式：{ text, where } */
export function exprsOf(v: unknown, out: { text: string; where: string }[] = [], where = ''): typeof out {
  if (typeof v === 'string') {
    const e = exprOfValue(v)
    if (e !== undefined) out.push({ text: e, where })
  } else if (Array.isArray(v)) v.forEach((x, i) => exprsOf(x, out, `${where}[${i}]`))
  else if (isObj(v))
    for (const [k, x] of Object.entries(v)) {
      if (k === 'expr' && typeof x === 'string') out.push({ text: x, where: where ? `${where}.expr` : 'expr' })
      else exprsOf(x, out, where ? `${where}.${k}` : k)
    }
  return out
}

function checkOne(s: StepRef, text: string, where: string, out: Issue[]) {
  const r = parseExpr(text)
  if ('error' in r) {
    const e = r.error
    const near = text.slice(Math.max(0, e.at - 8), e.at + 8)
    out.push(
      issue(
        s,
        'expr_syntax',
        `${where} 的表达式第 ${e.at + 1} 个字符${WHY[e.code]}${e.token ? `「${e.token}」` : ''}（…${near}…）：${text}`,
      ),
    )
    return
  }
  const refs = refsOf(r.ast)
  for (const src of refs.sources)
    if (!(VALUE_SOURCES as readonly string[]).includes(src))
      out.push(issue(s, 'path_missing', `${where}：没有 @${src} 这种来源（能用 ${VALUE_SOURCES.map((x) => '@' + x).join(' ')}）`))
  for (const c of refs.calls) {
    if (c.onSource || c.name.includes('.')) continue // 对象上的只读函数、接口：要编辑器认
    const fn = exprFunction(c.name)
    if (!fn) out.push(issue(s, 'fn_missing', `${where}：没有内置函数 ${c.name}`))
  }
  for (const b of refs.bareIds)
    out.push(issue(s, 'expr_type', `${where}：${b.name} 单独出现，变量要写成 $${b.name}，代码变量写 @来源.路径`, 'warning'))
}

export const exprs: Check = {
  name: 'exprs',
  summary: '表达式的语法、内置函数名、@来源',
  run({ steps }) {
    const out: Issue[] = []
    for (const s of steps) for (const e of exprsOf(ownFields(s.step))) checkOne(s, e.text, e.where || 'value', out)
    return out
  },
}
