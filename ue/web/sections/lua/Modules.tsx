import { FileCode2, RefreshCw, RotateCcw, SquarePen } from 'lucide-react'
import { useState } from 'react'
import { op, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Badge, ErrorText, SearchBox } from '../../ui.tsx'
import { clock, useLuaErrors, useModules, useOpenLua, type LuaModule } from './lua-data.ts'

/**
 * Lua 页「模块」页签（设计稿「UE 插件优化与扩展」二 P0、效果图 4）：已加载的模块、对应文件、绑定对象数、状态。
 * 状态列一眼看出哪些文件改了还没重载（UELink 按文件修改时间和加载时间比），有报错的标红；每行能单独重载、用编辑器打开
 */
export function LuaModules() {
  const { project, target } = useUe()
  const { ui, cn, toast } = h()
  const mods = useModules()
  const errs = useLuaErrors()
  const open = useOpenLua()
  const { busy, run } = useAction()
  const [q, setQ] = useState('')
  const root = mods.data?.root ?? ''
  const rel = (f?: string) => {
    if (!f) return ''
    const n = f.replace(/\\/g, '/')
    const r = root.replace(/\\/g, '/').replace(/\/$/, '')
    return r && n.startsWith(`${r}/`) ? n.slice(r.length + 1) : n
  }
  // 报错位置是「相对脚本根目录的文件:行」或绝对路径：按文件名尾部对上模块
  const errorFiles = new Set((errs.data?.items ?? []).map((e) => (e.where ?? '').replace(/:\d+$/, '').replace(/\\/g, '/')))
  const hasError = (m: LuaModule) => {
    const f = rel(m.file)
    return !!f && [...errorFiles].some((e) => e && (f.endsWith(e) || e.endsWith(f)))
  }
  const items = (mods.data?.items ?? []).filter(
    (m) => !q || m.name.toLowerCase().includes(q.toLowerCase()) || rel(m.file).toLowerCase().includes(q.toLowerCase()),
  )
  const reload = (names: string[]) =>
    run(`reload${names.join(',')}`, async () => {
      const r = await op<{ items: { module: string; ok: boolean; error?: string }[] }>(
        project.id,
        'lua.reload',
        { modules: names },
        target,
        60000,
      )
      const bad = r.items.filter((i) => !i.ok)
      if (bad.length) toast.error(bad.map((i) => `${i.module}：${i.error}`).join('\n'))
      else toast.success(t('已重载 {n} 个模块', { n: r.items.length }))
      void mods.reload()
    })

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-2">
        <div className="ue:w-72">
          <SearchBox placeholder={t('按模块名或文件找')} onSearch={setQ} allowEmpty live />
        </div>
        <ui.IconButton icon={RefreshCw} size="sm" label={t('刷新')} onClick={() => void mods.reload()} />
      </div>
      <div className="ue:px-4">
        <ErrorText>{mods.error}</ErrorText>
      </div>
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
        <table className="ue:w-full ue:border-collapse ue:text-footnote">
          <thead className="ue:sticky ue:top-0 ue:bg-card">
            <tr className="ue:border-b ue:border-line ue:text-left ue:text-caption ue:text-subtle">
              <th className="ue:px-4 ue:py-1.5 ue:font-normal">{t('模块')}</th>
              <th className="ue:px-2 ue:py-1.5 ue:font-normal">{root ? t('文件（{root}）', { root: rel(root) || root }) : t('文件')}</th>
              <th className="ue:px-2 ue:py-1.5 ue:text-right ue:font-normal">{t('绑定对象')}</th>
              <th className="ue:px-2 ue:py-1.5 ue:font-normal">{t('状态')}</th>
              <th className="ue:w-20" />
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.name} className="ue:group ue:border-b ue:border-line/60 ue:hover:bg-hover">
                <td className="ue:px-4 ue:py-1.5">
                  <span className="ue:flex ue:items-center ue:gap-1.5 ue:font-mono ue:text-fg">
                    <FileCode2 className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
                    <span className="ue:truncate">{m.name}</span>
                  </span>
                </td>
                <td className="ue:max-w-80 ue:truncate ue:px-2 ue:py-1.5 ue:font-mono ue:text-muted" title={m.file}>
                  {rel(m.file) || '—'}
                </td>
                <td className="ue:px-2 ue:py-1.5 ue:text-right ue:tabular-nums ue:text-fg">{m.objects}</td>
                <td className="ue:px-2 ue:py-1.5" title={m.loadedAt ? t('加载于 {at}', { at: clock(m.loadedAt) }) : undefined}>
                  {hasError(m) ? (
                    <Badge tone="danger">{t('有报错')}</Badge>
                  ) : m.stale ? (
                    <Badge tone="warn">{t('文件改了，没重载')}</Badge>
                  ) : (
                    <Badge tone="ok">{t('已同步')}</Badge>
                  )}
                </td>
                <td className="ue:px-2 ue:py-1">
                  <span className={cn('ue:flex ue:justify-end ue:gap-0.5 ue:opacity-0 ue:group-hover:opacity-100')}>
                    {m.file && (
                      <ui.IconButton icon={SquarePen} size="xs" label={t('用编辑器打开')} onClick={() => open(m.file!)} />
                    )}
                    <ui.IconButton
                      icon={RotateCcw}
                      size="xs"
                      label={t('重载这个模块')}
                      disabled={!!busy}
                      onClick={() => reload([m.name])}
                    />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {mods.data && !items.length && (
          <p className="ue:px-4 ue:py-6 ue:text-center ue:text-footnote ue:text-subtle">{t('没有对得上的模块')}</p>
        )}
      </div>
      <div className="ue:flex ue:items-center ue:gap-3 ue:border-t ue:border-line ue:px-4 ue:py-1.5 ue:text-caption ue:text-subtle">
        <span>
          {t('已加载 {n} 个模块 · {s} 个文件改了还没重载', { n: mods.data?.total ?? 0, s: mods.data?.stale ?? 0 })}
        </span>
        <span className="ue:ml-auto">
          {mods.data?.reloader
            ? t('重载用项目接入的热重载')
            : t('重载用 require 兜底：新函数换进旧模块表，模块顶部 local 会重新初始化；失败时保留旧代码')}
        </span>
      </div>
    </div>
  )
}
