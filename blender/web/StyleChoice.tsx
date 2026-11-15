import { useEffect, useState } from 'react'
import { StylePicker } from '@panel/web/src/components/ui/style-picker'
import type { SavedStyle } from '@panel/shared/style-types'
import { h, t } from './host.ts'

/**
 * 模型风格的选择（面板风格库里的「3D 模型」类）：用面板的风格选择器，列表每行带参考图缩略图，点缩略图看大图。
 * 风格列表从插件服务端取（自己存的 + 内置的），选了以后存在插件这边（server/style.ts）
 */
function useModelStyles() {
  const [styles, setStyles] = useState<SavedStyle[] | null>(null)
  const [last, setLast] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    h()
      .api.get<{ styles: SavedStyle[]; last: string }>('/styles')
      .then((r) => {
        setStyles(r.styles)
        setLast(r.last)
      })
      .catch((e) => setError((e as Error).message))
  }, [])
  return { styles, last, error }
}

/** 选择器加报错：换风格失败（服务端报的原因）照原文显示，不悄悄吞掉 */
function Picker({
  styles,
  value,
  error,
  save,
  align,
}: {
  styles: SavedStyle[] | null
  value: string
  error: string
  save: (s: SavedStyle) => Promise<unknown>
  align?: 'start' | 'end'
}) {
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')
  const pick = (s: SavedStyle) => {
    setBusy(true)
    setSaveError('')
    save(s)
      .catch((e) => setSaveError((e as Error).message))
      .finally(() => setBusy(false))
  }
  const problem = error || saveError
  return (
    <div className="bl:flex bl:min-w-0 bl:items-center bl:gap-2">
      <StylePicker styles={styles} kind="model" value={value} onChange={pick} busy={busy} align={align} />
      {problem && <span className="bl:min-w-0 bl:truncate bl:text-footnote bl:text-danger">{problem}</span>}
    </div>
  )
}

/**
 * 新建页的风格：一定有一个选中（默认通用，或上次选的）。选了马上记成「上次选的」，新对话第一次跑时认领它；
 * 返回选中的 id，发出去建好对话后再明确记到这个对话上
 */
export function NewModelStyle({ onValue }: { onValue: (id: string) => void }) {
  const { styles, last, error } = useModelStyles()
  const [value, setValue] = useState('')
  const cur = value || last
  useEffect(() => {
    if (cur) onValue(cur)
  }, [cur, onValue])
  return (
    <Picker
      styles={styles}
      value={cur}
      error={error}
      save={async (s) => {
        setValue(s.id)
        await h().api.post('/style', { styleId: s.id })
      }}
    />
  )
}

/** 模型对话里的风格：在「模型」页签顶上换；换了只管之后的步骤（下一轮告诉 Agent 改了，已建好的不推倒重来） */
export function TaskStyleChoice({ taskId }: { taskId: string }) {
  const { styles, error } = useModelStyles()
  const [value, setValue] = useState('')
  const [loadError, setLoadError] = useState('')
  const path = `/models/${encodeURIComponent(taskId)}/style`
  useEffect(() => {
    h()
      .api.get<{ styleId: string }>(path)
      .then((r) => setValue(r.styleId))
      .catch((e) => setLoadError((e as Error).message))
  }, [path])
  return (
    <Picker
      styles={styles}
      value={value}
      error={error || loadError}
      align="end"
      save={async (s) => {
        const r = await h().api.post<{ styleId: string }>(path, { styleId: s.id })
        setValue(r.styleId)
      }}
    />
  )
}
