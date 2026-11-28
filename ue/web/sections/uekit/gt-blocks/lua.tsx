import { BookOpen, Code2, FunctionSquare, Library } from 'lucide-react'
import { useState, type MouseEvent } from 'react'
import { blockOf, type GtStep } from '../../../../shared/gt-script/index.ts'
import { classIssues, fileWriteIssues } from '../../../../shared/gt-script/luafn/check.ts'
import { CodeField } from '@panel/web/src/components/ui/code-field'
import { openMenuAt, type MenuItem } from '@panel/web/src/components/ui/item-menu'
import { h, t } from '../../../host.ts'
import { ArgsEdit } from '../gt-api/ApiPick.tsx'
import { CondEditor } from '../gt-cond/CondEditor.tsx'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { LuaLibDialog } from '../gt-luafn/LuaLibDialog.tsx'
import { useLuaFns } from '../gt-luafn/use-luafn.ts'
import { ParamForm } from './call-inspector.tsx'
import { Row, TextField } from './parts.tsx'
import { registerBlockUi } from './registry.ts'

/**
 * 测试里自己写 Lua（用户 2026-11-28）：先用「执行 GM」「对象调用」，都不行才写 Lua。
 * Lua 只写在节点里（lua）或面板的函数库里（luafn），存在脚本 JSON / 函数库 JSON 里，绝不落成 .lua 文件、不进游戏项目
 */

const firstLine = (s: unknown) => (typeof s === 'string' ? (s.split('\n').find((l) => l.trim()) ?? '').trim() : '')

/**
 * 把函数库调用加进代码：空代码直接 return 它；最后一行已经是 return 时插在它前面存成局部变量
 * （Lua 里 return 后面不能再有语句，接在后面会编不过）；否则接在末尾
 */
function insertCall(code: string, call: string) {
  if (!code.trim()) return `return ${call}`
  const lines = code.replace(/\s+$/, '').split('\n')
  const last = lines.length - 1
  if (/^\s*return\b/.test(lines[last])) {
    const indent = /^\s*/.exec(lines[last])?.[0] ?? ''
    return [...lines.slice(0, last), `${indent}local r = ${call}`, lines[last]].join('\n') + '\n'
  }
  return `${lines.join('\n')}\n${call}\n`
}

/** 代码里的问题：类结构、写文件（和函数库存盘时同一套检查），只提示不拦 */
function CodeWarn({ code }: { code: string }) {
  const bad = [...classIssues(code), ...fileWriteIssues(code)]
  if (!bad.length) return null
  return (
    <span className="ue:text-caption ue:text-warning">{t('测试代码里不要这样写：{w}', { w: bad.join('、') })}</span>
  )
}

function LibButton() {
  const { ui } = h()
  const ctx = useEditCtx()
  const [open, setOpen] = useState(false)
  return (
    <>
      <ui.Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Library className="ue:h-3.5 ue:w-3.5" />
        {t('函数库…')}
      </ui.Button>
      {open && <LuaLibDialog project={ctx.project} onClose={() => setOpen(false)} />}
    </>
  )
}

/** Lua 代码节点：代码（带高亮）、传进去的变量、返回值存到、返回值要满足 */
function LuaInspector({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui } = h()
  const ctx = useEditCtx()
  const lib = useLuaFns(ctx.project)
  const code = typeof step.code === 'string' ? step.code : ''
  const args = (step.args && typeof step.args === 'object' && !Array.isArray(step.args) ? step.args : {}) as Record<
    string,
    unknown
  >
  const insert = (e: MouseEvent<HTMLElement>) => {
    const fns = lib.data?.fns ?? []
    const items: MenuItem[] = fns.length
      ? fns.map((f) => ({
          label: f.name,
          icon: FunctionSquare,
          hint: f.note ?? `(${f.params.join(', ')})`,
          onClick: () =>
            onChange({ ...step, code: insertCall(code, `fn[${JSON.stringify(f.name)}](${f.params.join(', ')})`) }),
        }))
      : [{ title: t('函数库还是空的：点「函数库…」加') }]
    openMenuAt(e.currentTarget, items, { search: t('搜函数…') })
  }
  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      <p className="ue:text-caption ue:text-subtle">
        {t(
          '能用「执行 GM」「对象调用」做到的先用它们。代码存在脚本里，不会生成 .lua 文件；可以 require 项目已有模块。',
        )}
      </p>
      <CodeField
        value={code}
        onChange={(v) => onChange({ ...step, code: v })}
        lang="lua"
        height={180}
        label={t('Lua 代码')}
        placeholder={'local Bag = require("Game.Bag.BagModule")\nreturn Bag.GetCount(itemId)'}
      />
      <CodeWarn code={code} />
      <div className="ue:flex ue:items-center ue:gap-1.5">
        <ui.Button size="sm" variant="secondary" onClick={insert}>
          <BookOpen className="ue:h-3.5 ue:w-3.5" />
          {t('插入函数库函数')}
        </ui.Button>
        <LibButton />
      </div>
      <Row label={t('传入变量')} hint={t('代码里直接当局部变量用；值可以写 $变量、= 表达式')}>
        <ArgsEdit value={args} onChange={(a) => onChange({ ...step, args: a })} />
      </Row>
      <Row label={t('返回值存到')}>
        <TextField step={step} k="saveAs" mono onChange={onChange} placeholder={t('变量名（可不填）')} />
      </Row>
      <span className="ue:text-footnote ue:text-subtle">{t('返回值要满足（不写就不检查）')}</span>
      <CondEditor compact value={step.expect} onChange={(c) => onChange({ ...step, expect: c })} />
    </div>
  )
}

/**
 * Lua 参数没有类型：像数字、true / false 的文字按数字、布尔传（不然 Lua 里拿到的是字符串 "1001"），
 * 真要传这种字符串时写成 JSON 字符串（"\"1001\""）
 */
function luaArg(v: unknown): unknown {
  if (typeof v !== 'string') return v
  const s = v.trim()
  if (s === 'true' || s === 'false') return s === 'true'
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  if (/^".*"$/.test(s))
    try {
      return JSON.parse(s)
    } catch {
      // 不是合法的 JSON 字符串就按原文
    }
  return v
}

/** 脚本函数节点：选函数库里的一个函数，按参数名填值 */
function LuaFnInspector({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui } = h()
  const ctx = useEditCtx()
  const lib = useLuaFns(ctx.project)
  const name = typeof step.fn === 'string' ? step.fn : ''
  const fn = lib.data?.fns.find((f) => f.name === name)
  const args = (step.args && typeof step.args === 'object' && !Array.isArray(step.args) ? step.args : {}) as Record<
    string,
    unknown
  >
  const options = [
    { value: '', label: t('选一个函数…') },
    ...(lib.data?.fns ?? []).map((f) => ({ value: f.name, label: f.name })),
    ...(name && !fn ? [{ value: name, label: t('{n}（函数库里没有）', { n: name }) }] : []),
  ]
  const pick = (v: string) => {
    const f = lib.data?.fns.find((x) => x.name === v)
    onChange({ ...step, fn: v, args: Object.fromEntries((f?.params ?? []).map((p) => [p, args[p] ?? ''])) })
  }
  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      <Row label={t('函数')}>
        <div className="ue:flex ue:flex-col ue:gap-1">
          <div className="ue:flex ue:items-center ue:gap-1.5">
            <ui.Select
              size="sm"
              value={name}
              onChange={(e: { target: { value: string } }) => pick(e.target.value)}
              options={options}
            />
            <LibButton />
          </div>
          {fn?.note && <span className="ue:text-caption ue:text-subtle">{fn.note}</span>}
          {name && !fn && !lib.loading && (
            <span className="ue:text-caption ue:text-danger">{t('函数库里找不到它：存盘和运行时这一步会失败')}</span>
          )}
          {lib.error && <span className="ue:text-caption ue:text-danger">{lib.error}</span>}
        </div>
      </Row>
      {fn && (
        <Row label={t('参数')}>
          <ParamForm
            params={fn.params.map((p) => ({ name: p, type: '' }))}
            values={args}
            onChange={(k, v) => onChange({ ...step, args: { ...args, [k]: luaArg(v) } })}
            onReset={() => pick(fn.name)}
          />
        </Row>
      )}
      <Row label={t('返回值存到')}>
        <TextField step={step} k="saveAs" mono onChange={onChange} placeholder={t('变量名（可不填）')} />
      </Row>
      <span className="ue:text-footnote ue:text-subtle">{t('返回值要满足（不写就不检查）')}</span>
      <CondEditor compact value={step.expect} onChange={(c) => onChange({ ...step, expect: c })} />
    </div>
  )
}

registerBlockUi(
  {
    action: 'lua',
    title: () => t('Lua 代码'),
    icon: Code2,
    tone: 'accent',
    summary: (s) => `${firstLine(s.code) || t('（还没写代码）')}${s.saveAs ? ` → $${String(s.saveAs)}` : ''}`,
    Inspector: LuaInspector,
  },
  [
    {
      id: 'lua',
      group: () => t('自己写 Lua'),
      label: () => t('Lua 代码'),
      hint: () => t('在节点里写一段 Lua 跑（GM、对象调用做不到时才用），不会生成 .lua 文件'),
      slash: 'lua',
      action: 'lua',
      make: () => blockOf('lua')!.make(),
    },
  ],
)

registerBlockUi(
  {
    action: 'luafn',
    title: () => t('脚本函数'),
    icon: FunctionSquare,
    tone: 'accent',
    summary: (s) =>
      `${typeof s.fn === 'string' && s.fn ? s.fn : t('（还没选函数）')}${s.saveAs ? ` → $${String(s.saveAs)}` : ''}`,
    Inspector: LuaFnInspector,
  },
  [
    {
      id: 'luafn',
      group: () => t('自己写 Lua'),
      label: () => t('脚本函数'),
      hint: () => t('调面板函数库里写好的 Lua 函数（一组普通函数，没有类）'),
      slash: 'luafn',
      action: 'luafn',
      make: () => blockOf('luafn')!.make(),
    },
  ],
)
