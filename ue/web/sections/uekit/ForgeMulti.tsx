import { Braces, Copy, Download, ExternalLink, Info, Upload } from 'lucide-react'
import { op, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { copyText, openMenu } from '../../menu.tsx'
import type { ForgeEntry } from './Forge.tsx'
import { canExport, canImport, fileName } from './forge-actions.ts'
import { kindMeta, STATES } from './kinds.ts'
import { StatePill } from './StatePill.tsx'

/**
 * 左栏选中多份配置时的右栏（设计稿 §2.2 第 6 条、效果图 2）：几份、各状态多少、批量导入 / 导出，下面每份一行，点一行只看那一份。
 * 导入跳过读不出来、没写目标资产、不是 AssetForge 的配置，按钮上的数字按真正会导入的算，免得点了「导入 3 份」只导了 2 份还以为全导了。
 */
export function ForgeMulti({
  entries,
  busy,
  onOpen,
}: {
  entries: ForgeEntry[]
  busy: boolean
  onOpen: (key: string) => void
}) {
  const { project } = useUe()
  const { ui, cn } = h()
  const { busy: acting, run } = useAction()
  const toImport = entries.filter(canImport)
  const toExport = entries.filter(canExport)
  const off = busy || !!acting
  // 状态计数按 kinds.ts 里的顺序排，和左栏筛选的颜色一致
  const counts = Object.keys(STATES)
    .map((s) => ({ s, n: entries.filter((e) => e.state === s).length }))
    .filter((x) => x.n > 0)
  const dirs = new Set(entries.map((e) => (e.config ?? '').replace(/\\/g, '/').split('/').slice(0, -1).join('/')))
  const kinds = new Set(entries.map((e) => e.kind))
  const sub = [
    dirs.size === 1 ? `${[...dirs][0] || t('配置根')}/` : t('{n} 个目录', { n: dirs.size }),
    kinds.size === 1 ? kindMeta([...kinds][0]).label() : t('{n} 种类型', { n: kinds.size }),
  ].join(' · ')

  const importAll = () =>
    run('import', async () => {
      await op(project.id, 'forge.import', { configs: toImport.map((e) => e.config) })
      h().toast.success(t('已开始导入 {n} 份配置', { n: toImport.length }))
    })
  const exportAll = () =>
    run('export', async () => {
      await op(project.id, 'forge.export', { assets: toExport.map((e) => e.asset) })
      h().toast.success(t('已开始导出 {n} 份', { n: toExport.length }))
    })
  const rowMenu = (e: ForgeEntry) => (ev: React.MouseEvent) =>
    openMenu(ev, [
      { label: t('只看这一份'), icon: ExternalLink, onClick: () => onOpen(e.key) },
      'sep',
      { label: t('复制配置路径'), icon: Copy, onClick: () => copyText(e.configPath ?? e.config ?? '') },
      e.asset && { label: t('复制资产路径'), icon: Copy, onClick: () => copyText(e.asset ?? '') },
      { label: t('复制选中的路径（每行一个）'), icon: Copy, onClick: () => copyText(paths(entries)) },
    ])

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <header className="ue:flex ue:min-h-14 ue:items-center ue:gap-3 ue:border-b ue:border-line ue:px-5 ue:py-2.5">
        <span className="ue:flex ue:h-8 ue:w-8 ue:shrink-0 ue:items-center ue:justify-center ue:rounded-lg ue:bg-hover">
          <Braces className="ue:h-4 ue:w-4 ue:text-accent-text" strokeWidth={1.75} />
        </span>
        <span className="ue:flex ue:min-w-0 ue:flex-col">
          <span className="ue:text-body ue:font-medium ue:text-fg">
            {t('选中了 {n} 份配置', { n: entries.length })}
          </span>
          <span className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">{sub}</span>
        </span>
        <div className="ue:ml-auto ue:flex ue:shrink-0 ue:items-center ue:gap-1.5">
          <ui.Button size="sm" variant="secondary" disabled={off || !toExport.length} onClick={exportAll}>
            <Upload className="ue:h-3.5 ue:w-3.5" /> {t('导出 {n} 份', { n: toExport.length })}
          </ui.Button>
          <ui.Button size="sm" disabled={off || !toImport.length} onClick={importAll}>
            <Download className="ue:h-3.5 ue:w-3.5" /> {t('导入 {n} 份', { n: toImport.length })}
          </ui.Button>
        </div>
      </header>
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:px-5 ue:py-3">
        <div className="ue:mb-3 ue:flex ue:flex-wrap ue:gap-2">
          {counts.map((c) => (
            <StatePill key={c.s} state={c.s} count={c.n} soft />
          ))}
        </div>
        <ul className="ue:flex ue:flex-col ue:gap-1.5">
          {entries.map((e) => {
            const k = kindMeta(e.kind)
            const bad = !canImport(e)
            return (
              <li key={e.key}>
                <button
                  type="button"
                  onClick={() => onOpen(e.key)}
                  onContextMenu={rowMenu(e)}
                  className="ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-2.5 ue:rounded-lg ue:border ue:border-line ue:px-3 ue:py-2 ue:text-left ue:hover:bg-hover"
                >
                  <Braces className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0', k.tone)} />
                  <span className="ue:shrink-0 ue:font-mono ue:text-footnote ue:text-fg">{fileName(e)}</span>
                  <span
                    className={cn(
                      'ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono ue:text-caption',
                      bad ? 'ue:text-danger' : 'ue:text-subtle',
                    )}
                  >
                    {bad ? e.message || '' : e.asset ? `→ ${e.asset}` : ''}
                  </span>
                  <StatePill state={e.state} />
                </button>
              </li>
            )
          })}
        </ul>
        <p className="ue:mt-3 ue:flex ue:items-start ue:gap-1.5 ue:text-footnote ue:text-subtle">
          <Info className="ue:mt-0.5 ue:h-3.5 ue:w-3.5 ue:shrink-0" />
          <span>
            {entries.length > toImport.length &&
              `${t('有 {n} 份读不出来或没写目标资产，不会导入', { n: entries.length - toImport.length })}；`}
            {t('Ctrl 点选加减，Shift 点选连选，Esc 取消多选')}
          </span>
        </p>
      </div>
    </div>
  )
}

const paths = (list: ForgeEntry[]) => list.map((e) => e.configPath ?? e.config ?? '').join('\n')
