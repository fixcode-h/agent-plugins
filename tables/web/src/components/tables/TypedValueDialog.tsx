import { useRef, useState } from 'react'
import { t } from '@shared/i18n'
import {
  formatShow,
  formatStore,
  nodeText,
  parseStore,
  type Codec,
  type TValue,
  type TypeNode,
} from '@shared/table-codec'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Field, Textarea } from '@/components/ui/input'
import type { CellMove } from './CellEditor'
import { TypedValueForm, type TypedOpts } from './TypedValueForm'

/**
 * 结构体、映射这类格子的编辑：弹窗里按字段、按项一个个填（用户 2026-11-13 要求「这类值编辑应该弹出一个窗口，
 * 每个值单独填写」）。底下能看到会存成什么、显示成什么，也能直接改存储的原文；确定后按存储样式写回格子
 */
export function TypedValueDialog({
  init,
  node,
  codec,
  field,
  opts,
  onDone,
}: {
  init: string
  node: TypeNode
  codec: Codec
  /** 这一列的字段名（标题） */
  field: string
  opts?: TypedOpts
  onDone: (v: string | null, move?: CellMove) => void
}) {
  const first = parseStore(node, init, codec)
  const [value, setValue] = useState<TValue | null>(first.ok ? first.v : null)
  // 原文：拆不开的格子先只给原文，改对了再回到逐项填
  const [raw, setRaw] = useState(init)
  const [rawErr, setRawErr] = useState(first.ok ? '' : first.err)
  const ended = useRef(false)
  const end = (v: string | null) => {
    if (ended.current) return
    ended.current = true
    onDone(v)
  }
  const put = (v: TValue) => {
    setValue(v)
    setRaw(formatStore(node, v, codec))
    setRawErr('')
  }
  const editRaw = (s: string) => {
    setRaw(s)
    const p = parseStore(node, s, codec)
    if (p.ok) {
      setValue(p.v)
      setRawErr('')
    } else setRawErr(p.err)
  }
  // 弹窗是从格子里打开的：React 的事件会穿过传送门冒泡回格子和表格（按键当成表格快捷键、点击当成选格子），在这里截住
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  return (
    <span
      className="tb:contents"
      onKeyDown={stop}
      onMouseDown={stop}
      onPointerDown={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      <Modal
        open
        onOpenChange={(o) => !o && end(null)}
        title={t('编辑 {field}', { field: field || nodeText(node) })}
        size="md"
        footer={
          <>
            <span className="tb:mr-auto tb:min-w-0 tb:truncate tb:font-mono tb:text-caption tb:text-subtle">
              {nodeText(node)}
            </span>
            <Button variant="secondary" onClick={() => end(null)}>
              {t('取消')}
            </Button>
            <Button disabled={!!rawErr} onClick={() => end(raw)}>
              {t('确定')}
            </Button>
          </>
        }
      >
        <div className="tb:flex tb:flex-col tb:gap-4">
          {value ? (
            <TypedValueForm node={node} value={value} onChange={put} opts={opts} label={field} />
          ) : (
            <p className="tb:rounded-lg tb:bg-sel tb:px-2.5 tb:py-2 tb:text-caption tb:text-subtle">
              {t('这一格按类型拆不开，先在下面改原文，改对了就能逐项填。')}
            </p>
          )}
          <Field
            label={t('存储的原文')}
            tip={t('表格文件里实际写的字，按项目类型表里的存储样式拼；也可以直接改')}
            error={rawErr || undefined}
          >
            <Textarea
              rows={2}
              value={raw}
              spellCheck={false}
              aria-label={t('存储的原文')}
              onChange={(e) => editRaw(e.target.value)}
              className="tb:font-mono tb:text-footnote"
            />
          </Field>
          {value && (
            <div className="tb:flex tb:flex-col tb:gap-1 tb:text-caption">
              <span className="tb:text-subtle">{t('表格里显示为')}</span>
              <code className="tb:break-all tb:rounded-lg tb:bg-sel tb:px-2.5 tb:py-1.5 tb:font-mono tb:text-fg">
                {formatShow(node, value, codec.formats) || '—'}
              </code>
            </div>
          )}
        </div>
      </Modal>
    </span>
  )
}
