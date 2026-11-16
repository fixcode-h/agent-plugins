import { ArrowRight, Wrench } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { RedirectorItem } from '../../../server/editor-tools/redirectors.ts'
import { ppost, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import type { MenuItem } from '../../menu.tsx'
import { Badge, ErrorText, Note } from '../../ui.tsx'

/**
 * 资源页文件夹右键「修复重定向器…」（设计稿「UE 插件优化与扩展」二 P1 资源整理）：先列出文件夹下的重定向器和
 * 还在引用它们的资源，确认后修（改写并保存引用方、删掉重定向器，和内容浏览器右键同一个入口）。
 * 修复会写盘，按结构性操作在弹窗里确认；P4 项目先签出。弹窗状态放模块里，文件夹树只加一个菜单项和一个挂点。
 */
let folder = ''
const subs = new Set<() => void>()
const setFolder = (f: string) => {
  folder = f
  subs.forEach((fn) => fn())
}

/** 文件夹右键菜单里的那一项 */
export function redirectorMenuItem(path: string): MenuItem {
  return { label: t('修复重定向器…'), icon: Wrench, onClick: () => setFolder(path) }
}

interface ListRes {
  items: RedirectorItem[]
  total: number
  more?: boolean
}
interface FixRes {
  fixed?: { package: string }[]
  left?: { package: string }[]
  note?: string
  p4?: string
}

/** 挂在文件夹树里：打开时先列，确认后修 */
export function RedirectorDialog({ onFixed }: { onFixed?: (path: string) => void }) {
  const path = useSyncExternalStore(
    (fn) => {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    () => folder,
  )
  const { project } = useUe()
  const { ui } = h()
  const { busy, run } = useAction()
  const [list, setList] = useState<ListRes>()
  const [err, setErr] = useState('')
  const [done, setDone] = useState<FixRes>()
  useEffect(() => {
    setList(undefined)
    setDone(undefined)
    setErr('')
    if (!path) return
    ppost<ListRes>(project.id, 'tools/redirectors', { path })
      .then(setList)
      .catch((e: Error) => setErr(e.message))
  }, [path, project.id])
  if (!path) return null
  const refCount = new Set((list?.items ?? []).flatMap((i) => i.referencers.map((r) => r.package))).size
  const fixable = (list?.items ?? []).filter((i) => !i.broken).length
  const fix = () =>
    run('fix', async () => {
      const r = await ppost<FixRes>(project.id, 'tools/redirectors/fix', { path })
      setDone(r)
      onFixed?.(path)
    })

  return (
    <ui.Modal
      open
      size="lg"
      onOpenChange={(o: boolean) => !o && setFolder('')}
      title={t('修复重定向器 · {path}', { path })}
      footer={
        <>
          <ui.Button variant="secondary" onClick={() => setFolder('')}>
            {done ? t('关闭') : t('取消')}
          </ui.Button>
          {!done && (
            <ui.Button disabled={!fixable || !!busy || !!list?.more} onClick={() => void fix()}>
              <Wrench className="ue:h-3.5 ue:w-3.5" />
              {busy === 'fix' ? t('修复中…') : t('修复 {n} 个', { n: fixable })}
            </ui.Button>
          )}
        </>
      }
    >
      <div className="ue:flex ue:flex-col ue:gap-3">
        <ErrorText>{err}</ErrorText>
        {!list && !err && <p className="ue:text-footnote ue:text-subtle">{t('正在列出…')}</p>}
        {list && !list.items.length && <p className="ue:text-footnote ue:text-subtle">{t('这个文件夹下没有重定向器')}</p>}
        {list && list.items.length > 0 && !done && (
          <Note>
            {t('会改写并保存 {refs} 个引用方资源，删掉修好的重定向器（和内容浏览器右键「修复重定向器」一样），不能自动撤回。', {
              refs: refCount,
            })}
            {project.vcs === 'p4' && ` ${t('P4 项目会先签出只读的文件，改动留在默认变更列表里，不提交。')}`}
            {list.more && ` ${t('一共 {n} 个，超过一次能修的数量：选更小的文件夹分批修。', { n: list.total })}`}
          </Note>
        )}
        {done && (
          <Note tone={done.left?.length ? 'warn' : 'info'}>
            {t('修好 {a} 个，剩 {b} 个。', { a: done.fixed?.length ?? 0, b: done.left?.length ?? 0 })}
            {done.note && ` ${done.note}`}
            {done.p4 && ` ${done.p4}`}
          </Note>
        )}
        <ul className="ue:max-h-96 ue:divide-y ue:divide-line ue:overflow-auto ue:rounded-lg ue:border ue:border-line">
          {(list?.items ?? []).map((i) => (
            <li key={i.package} className="ue:flex ue:flex-col ue:gap-0.5 ue:px-3 ue:py-2">
              <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-2 ue:font-mono ue:text-footnote">
                <span className="ue:min-w-0 ue:truncate ue:text-fg" title={i.file}>
                  {i.package}
                </span>
                <ArrowRight className="ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle" />
                {i.broken ? (
                  <Badge tone="danger">{t('目标不在了，修不了')}</Badge>
                ) : (
                  <span className="ue:min-w-0 ue:truncate ue:text-accent-text" title={i.target}>
                    {i.target}
                  </span>
                )}
              </div>
              <span className="ue:text-caption ue:text-subtle" title={i.referencers.map((r) => r.package).join('\n')}>
                {i.referencers.length ? t('{n} 个资源还在引用', { n: i.referencers.length }) : t('没有资源引用，直接删')}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </ui.Modal>
  )
}
