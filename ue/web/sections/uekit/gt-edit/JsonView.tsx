import { useEffect, useState } from 'react'
import { parseScript, serialize, tidyScript } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import type { ViewProps } from './views.ts'

/**
 * JSON 视图：直接改文件原文。改得合法才写回数据（补 id 后），不合法时标红、不动数据，切走再切回来以数据为准。
 * 选中的步骤在原文里搜它的 id 定位不做：长场景里原文和结构对不上的情况多，靠列表视图选
 */
export function JsonView({ doc, onChange }: ViewProps) {
  const { ui } = h()
  const [text, setText] = useState(() => serialize(doc))
  const [err, setErr] = useState('')
  // 别的视图改了数据（撤销、列表里挪了）时刷新原文；自己改出来的不刷，免得光标跳
  const [own, setOwn] = useState(doc)
  useEffect(() => {
    if (doc !== own) {
      setText(serialize(doc))
      setErr('')
      setOwn(doc)
    }
  }, [doc, own])

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-1 ue:p-3">
      <ui.Textarea
        spellCheck={false}
        className="ue:min-h-0 ue:flex-1 ue:resize-none ue:font-mono ue:text-footnote"
        value={text}
        onChange={(e: { target: { value: string } }) => {
          setText(e.target.value)
          const p = parseScript(e.target.value)
          if ('error' in p) return setErr(p.error)
          setErr('')
          const next = tidyScript(p.doc)
          setOwn(next)
          onChange(next)
        }}
      />
      <span className={err ? 'ue:text-caption ue:text-danger' : 'ue:text-caption ue:text-subtle'}>
        {err ? t('不是合法的 JSON，没写回：{e}', { e: err }) : t('改得合法就写回；没 id 的步骤会自动补上')}
      </span>
    </div>
  )
}
