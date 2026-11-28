import { Plug } from 'lucide-react'
import { useState } from 'react'
import { h, t } from '../../../host.ts'
import { SuggestInput } from '../../../SuggestInput.tsx'
import { parseScalar, scalarText } from '../gt-cond/compare.tsx'
import { ValueInput } from '../gt-cond/ValueInput.tsx'
import { useEditCtx } from '../gt-edit/ctx.ts'
import type { ApiItem } from './model.ts'

/** 挑接口：边打字边从接口库里筛（名字、显示名、分类）；条件里只列只读的 */
export function ApiPick({
  value,
  onChange,
  readOnly,
}: {
  value: string
  onChange: (v: string) => void
  readOnly?: boolean
}) {
  const { apis } = useEditCtx()
  const suggest = (q: string) => {
    const low = q.toLowerCase()
    const hit = apis.filter(
      (a) =>
        (!readOnly || a.readOnly) &&
        (a.name.toLowerCase().includes(low) || (a.display ?? '').includes(q) || (a.category ?? '').includes(q)),
    )
    return {
      total: hit.length,
      rows: hit.slice(0, 40).map((a) => ({
        key: a.name,
        value: a.name,
        label: a.name,
        detail: a.display ?? a.category,
        icon: Plug,
        tone: a.readOnly ? 'ue:text-success' : 'ue:text-warning',
      })),
    }
  }
  return (
    <SuggestInput
      value={value}
      onChange={onChange}
      suggest={suggest}
      inputClassName="ue:font-mono"
      placeholder={t('接口名，例如 Widget.IsShown')}
      empty={apis.length ? undefined : t('还没有接口清单：编辑器开着时从 GameTest 取')}
    />
  )
}

/**
 * 接口的参数：认识这个接口时按它的参数一行一个（值可以是 $变量、= 表达式）；不认识（编辑器没开、接口库里没有）
 * 时直接写 JSON 对象，不丢参数
 */
export function ArgsEdit({
  api,
  value,
  onChange,
}: {
  api?: Pick<ApiItem, 'args'>
  value: Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
}) {
  const { ui } = h()
  const [text, setText] = useState(() => JSON.stringify(value))
  const [err, setErr] = useState('')
  // 外面换了值（「换函数…」填好参数名）时文字跟上（B3：以前只在挂载时取一次，再敲一个字就把新参数名覆盖掉）；
  // 自己敲出来的值不重排文字，免得光标跳
  const json = JSON.stringify(value)
  const [seen, setSeen] = useState(json)
  if (seen !== json) {
    setSeen(json)
    let same = false
    try {
      same = JSON.stringify(JSON.parse(text || '{}')) === json
    } catch {
      // 正在敲、还不是 JSON：按外面的值重写
    }
    if (!same) {
      setText(json)
      setErr('')
    }
  }
  const args = api?.args ?? []
  if (!args.length && !Object.keys(value).length && api) return null
  if (args.length)
    return (
      <div className="ue:grid ue:grid-cols-[auto_minmax(0,1fr)] ue:items-center ue:gap-x-2 ue:gap-y-1.5">
        {args.map((a) => (
          <div key={a.name} className="ue:contents">
            <span className="ue:font-mono ue:text-footnote ue:text-subtle" title={a.note ?? a.type}>
              {a.name}
            </span>
            <ValueInput
              value={scalarText(value[a.name])}
              placeholder={a.type}
              onChange={(s) => {
                const next = { ...value }
                if (s === '') delete next[a.name]
                else next[a.name] = parseScalar(s)
                onChange(next)
              }}
            />
          </div>
        ))}
      </div>
    )
  return (
    <div className="ue:flex ue:flex-col ue:gap-1">
      <ui.Input
        size="sm"
        className="ue:font-mono"
        placeholder={t('参数，JSON 对象：{"class": "BP_Npc_C"}')}
        value={text}
        onChange={(e: { target: { value: string } }) => {
          setText(e.target.value)
          try {
            const v = JSON.parse(e.target.value || '{}') as unknown
            if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(t('要是一个对象'))
            setErr('')
            onChange(v as Record<string, unknown>)
          } catch (x) {
            setErr((x as Error).message)
          }
        }}
      />
      {err && <span className="ue:text-caption ue:text-danger">{err}</span>}
    </div>
  )
}
