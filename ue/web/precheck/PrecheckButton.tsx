import { ListChecks } from 'lucide-react'
import { useState } from 'react'
import { ppost, useAction } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Badge, ErrorText } from '../ui.tsx'

interface Item {
  path: string
  result: string
  errors: number
  warnings: number
  error?: string
  issues?: { severity: string; text: string }[]
}
interface Res {
  items: Item[]
  errors: number
  warnings: number
  report?: string
  checked?: number
  skipped?: number
  empty?: string
}

/**
 * 资源页页头「提交前检查」（设计稿「UE 插件优化与扩展」二 P1）：没保存的和版本管理里改过的资源一次校验（服务端 precheck.ts，
 * UELink 2.4 的 asset.validate paths）。结果弹窗里按资源列，有问题的在前，点资源在右边打开。旧 UELink 不显示按钮
 */
export function PrecheckButton({ onOpen }: { onOpen: (path: string) => void }) {
  const { project, state } = useUe()
  const { ui, cn } = h()
  const { busy, run } = useAction()
  const [res, setRes] = useState<Res>()
  const [error, setError] = useState('')
  const supported = (state?.instances ?? []).some((i) => i.ops?.includes('asset.validate') && i.ops.includes('editor.selection'))
  if (!supported) return null
  const check = () =>
    run('precheck', async () => {
      setError('')
      try {
        setRes(await ppost<Res>(project.id, 'precheck'))
      } catch (e) {
        setError((e as Error).message)
        setRes({ items: [], errors: 0, warnings: 0 })
      }
    })
  const items = [...(res?.items ?? [])].sort((a, b) => b.errors - a.errors || b.warnings - a.warnings)
  return (
    <>
      <ui.Button size="sm" variant="secondary" disabled={busy === 'precheck'} onClick={check}>
        <ListChecks className="ue:h-3.5 ue:w-3.5" /> {busy === 'precheck' ? t('检查中…') : t('提交前检查')}
      </ui.Button>
      {res && (
        <ui.Modal open onOpenChange={(o: boolean) => !o && setRes(undefined)} title={t('提交前检查')} size="lg">
          <ErrorText>{error}</ErrorText>
          {res.empty ? (
            <p className="ue:text-footnote ue:text-subtle">{res.empty}</p>
          ) : (
            !error && (
              <>
                <p className="ue:mb-2 ue:flex ue:items-center ue:gap-2 ue:text-footnote ue:text-subtle">
                  {t('查了 {n} 个资源', { n: res.checked ?? items.length })}
                  <Badge tone={res.errors ? 'danger' : 'ok'}>{t('{n} 个错误', { n: res.errors })}</Badge>
                  {res.warnings > 0 && <Badge tone="warn">{t('{n} 个警告', { n: res.warnings })}</Badge>}
                  {!!res.skipped && t('另有 {n} 个超出一次的上限没查', { n: res.skipped })}
                </p>
                <ul className="ue:flex ue:max-h-[60vh] ue:flex-col ue:overflow-auto">
                  {items.map((i) => (
                    <li key={i.path} className="ue:border-b ue:border-line/60 ue:py-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          onOpen(i.path)
                          setRes(undefined)
                        }}
                        className={cn(
                          'ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:text-left ue:hover:text-accent-text',
                        )}
                      >
                        <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono ue:text-footnote ue:text-fg">{i.path}</span>
                        {i.errors > 0 && <Badge tone="danger">{i.errors}</Badge>}
                        {i.warnings > 0 && <Badge tone="warn">{i.warnings}</Badge>}
                        {!i.errors && !i.warnings && <Badge tone="ok">{t('通过')}</Badge>}
                      </button>
                      {(i.error || i.issues?.length) && (
                        <ul className="ue:mt-1 ue:flex ue:flex-col ue:gap-0.5 ue:pl-3 ue:text-caption ue:text-subtle">
                          {i.error && <li>{i.error}</li>}
                          {i.issues?.map((x, k) => (
                            <li key={k} className={x.severity === 'error' ? 'ue:text-danger' : undefined}>
                              {x.text}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
                {res.report && (
                  <p className="ue:mt-2 ue:truncate ue:text-caption ue:text-subtle" title={res.report}>
                    {t('完整结果：{p}', { p: res.report })}
                  </p>
                )}
              </>
            )
          )}
        </ui.Modal>
      )}
    </>
  )
}
