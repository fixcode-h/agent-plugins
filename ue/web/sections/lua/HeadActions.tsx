import { FileCheck2, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { op, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Badge } from '../../ui.tsx'
import { useLuaOp, useModules } from './lua-data.ts'

interface CheckRes {
  passed: boolean
  checked: number
  errors: { file: string; line: number; message: string }[]
}

/**
 * Lua 页页头「检查语法」（设计稿「UE 插件优化与扩展」二 P0）：改过还没重载的模块文件交给 lua.check，
 * 在独立的 Lua 状态里只编译不执行，不碰游戏里的状态。旧 UELink 没有 lua.check 时不显示
 */
export function CheckSyntax() {
  const { project, target } = useUe()
  const { ui, toast } = h()
  const ok = useLuaOp('lua.check')
  const mods = useModules()
  const { busy, run } = useAction()
  const [res, setRes] = useState<CheckRes>()
  if (!ok) return null
  const files = (mods.data?.items ?? []).filter((m) => m.stale && m.file).map((m) => m.file!)
  const check = () =>
    run('check', async () => {
      if (!files.length) {
        toast.success(t('没有改过还没重载的文件'))
        return
      }
      const r = await op<CheckRes>(project.id, 'lua.check', { files }, target, 60000)
      if (r.passed) toast.success(t('{n} 个文件语法都没问题', { n: r.checked }))
      else setRes(r)
    })
  return (
    <>
      <ui.Button size="sm" variant="secondary" disabled={busy === 'check'} onClick={check}>
        <FileCheck2 className="ue:h-3.5 ue:w-3.5" /> {t('检查语法')}
      </ui.Button>
      {res && (
        <ui.Modal open onOpenChange={(o: boolean) => !o && setRes(undefined)} title={t('语法检查')}>
          <p className="ue:mb-2 ue:text-footnote ue:text-muted">
            {t('检查了 {n} 个文件，{e} 处错误', { n: res.checked, e: res.errors.length })}
          </p>
          <ul className="ue:flex ue:flex-col ue:gap-1.5">
            {res.errors.map((e, i) => (
              <li key={i} className="ue:flex ue:flex-col ue:font-mono ue:text-footnote">
                <span className="ue:text-fg">
                  {e.file}:{e.line}
                </span>
                <span className="ue:text-danger">{e.message}</span>
              </li>
            ))}
          </ul>
        </ui.Modal>
      )}
    </>
  )
}

/** 页头「重载改过的 N 个模块」：lua.reload changed=true；没有改过的模块时按钮置灰。旧 UELink 不显示 */
export function ReloadChanged() {
  const { project, target } = useUe()
  const { ui, toast } = h()
  const ok = useLuaOp('lua.reload')
  const mods = useModules()
  const { busy, run } = useAction()
  if (!ok) return null
  const n = mods.data?.stale ?? 0
  const reload = () =>
    run('reload', async () => {
      const r = await op<{ items: { module: string; ok: boolean; error?: string }[]; failed: number }>(
        project.id,
        'lua.reload',
        { changed: true },
        target,
        60000,
      )
      const bad = r.items.filter((i) => !i.ok)
      if (bad.length) toast.error(bad.map((i) => `${i.module}：${i.error}`).join('\n'))
      else toast.success(t('已重载 {n} 个模块', { n: r.items.length }))
      void mods.reload()
    })
  return (
    <ui.Button size="sm" disabled={!n || busy === 'reload'} onClick={reload}>
      <RotateCcw className="ue:h-3.5 ue:w-3.5" /> {t('重载改过的模块')}
      {!!n && <Badge tone="warn">{n}</Badge>}
    </ui.Button>
  )
}
