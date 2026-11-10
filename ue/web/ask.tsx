import { useRef, useState, type ReactNode } from 'react'
import { h, t } from './host.ts'

interface AskOpts {
  title: string
  /** 有 label 时弹输入框；没有就是单纯的确认 */
  label?: string
  init?: string
  okText?: string
  danger?: boolean
  /** 输入框允许留空（例如留空取消绑定） */
  allowEmpty?: boolean
}

/**
 * 面板风格的输入 / 确认弹窗，代替 window.prompt / confirm（浏览器原生框和面板样式对不上，深色下也刺眼）。
 * 用法：const [dialog, ask] = useAsk()；把 dialog 放进 JSX，await ask({...}) 拿到输入（取消是 undefined，确认框成功是 ''）
 */
export function useAsk(): [ReactNode, (o: AskOpts) => Promise<string | undefined>] {
  const [opts, setOpts] = useState<AskOpts | null>(null)
  const [value, setValue] = useState('')
  const done = useRef<((v: string | undefined) => void) | null>(null)
  const ask = (o: AskOpts) =>
    new Promise<string | undefined>((resolve) => {
      done.current?.(undefined)
      done.current = resolve
      setValue(o.init ?? '')
      setOpts(o)
    })
  const finish = (v: string | undefined) => {
    done.current?.(v)
    done.current = null
    setOpts(null)
  }
  const { Modal, Button, Input, Field } = h().ui
  const okDisabled = !!opts?.label && !opts.allowEmpty && !value.trim()
  const ok = () => !okDisabled && finish(opts?.label ? value.trim() : '')
  const dialog = (
    <Modal
      open={!!opts}
      onOpenChange={(o: boolean) => !o && finish(undefined)}
      title={opts?.title ?? ''}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => finish(undefined)}>
            {t('取消')}
          </Button>
          <Button variant={opts?.danger ? 'danger' : 'primary'} disabled={okDisabled} onClick={ok}>
            {opts?.okText ?? t('确定')}
          </Button>
        </>
      }
    >
      {opts?.label ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            ok()
          }}
        >
          <Field label={opts.label}>
            <Input
              autoFocus
              value={value}
              onChange={(e: { target: { value: string } }) => setValue(e.target.value)}
              className="ue:font-mono"
            />
          </Field>
        </form>
      ) : null}
    </Modal>
  )
  return [dialog, ask]
}
