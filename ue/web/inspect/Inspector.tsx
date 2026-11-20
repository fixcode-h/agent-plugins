import { useEffect } from 'react'
import { useUe } from '../ctx.tsx'
import { isAssetPath } from '../details/model.ts'
import type { OpenHow } from '../details/RefChip.tsx'
import { h, t } from '../host.ts'
import { Note } from '../ui.tsx'
import { InspectorActions } from './actions.tsx'
import { AssetChanges } from '../asset-dirty/AssetChanges.tsx'
import { useChangesOn } from '../asset-dirty/store.ts'
import { AssetView } from './AssetView.tsx'
import { kindOfPath, lastSeg, toCrumb, toRecent } from './bar-items.ts'
import { scopeOf, useNavHistory, type NavPage } from './history.ts'
import { InspectorBar } from './InspectorBar.tsx'
import { joinSub, splitSub } from './nav-state.ts'
import { RuntimeView } from './RuntimeView.tsx'

/**
 * 检视区（设计稿第 3 节）：对象页、资源页右边同一个组件。导航条（前进后退、最近看过、引用链、类型、动作）+
 * 看资源时的提示条 + 按选中的东西出的中栏和右栏（运行时实例 → RuntimeView，资源 → AssetView）。
 * 选中的是什么全看地址（sub = 路径|组件），点引用、后退前进都走导航历史（history.ts），切组件只改地址不加记录
 */
export function Inspector({
  page,
  empty,
  onReveal,
  onChanged,
}: {
  page: NavPage
  /** 没选中时的说明 */
  empty: string
  /** 资源页：「在文件夹里定位」 */
  onReveal?: (path: string) => void
  /** 资源改了（资源页刷新未保存列表）；不给时只刷新左栏的数字 */
  onChanged?: () => void
}) {
  const { sub, go, target, reloadBadges, project } = useUe()
  const nav = useNavHistory()
  const { path, comp } = splitSub(sub)
  const asset = !!path && isAssetPath(path)
  // 「改动」页只在资源页有（保存只放在资源页，见 asset-dirty/ChangesButton.tsx）
  const changesOn = useChangesOn(asset ? path : '')
  const changes = page === 'assets' && changesOn

  /** 点引用：Ctrl+点资源去资源页，其余在这一页往下看 */
  const open = (p: string, via?: string, how?: OpenHow) =>
    nav.open(how?.ctrl && isAssetPath(p) ? 'assets' : page, p, { via })
  const onComp = (c: string) => go(page, joinSub(path, c))

  // Alt+← / Alt+→、鼠标侧键后退前进（和浏览器一样）；输入框里的 Alt+方向键留给输入框（Mac 上是按词移动）
  useEffect(() => {
    const typing = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || typing(e.target)) return
      if (e.key === 'ArrowLeft') nav.back()
      else if (e.key === 'ArrowRight') nav.forward()
      else return
      e.preventDefault()
    }
    // 侧键按下时就拦住浏览器自己的后退，抬起时做我们的
    const onDown = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) e.preventDefault()
    }
    const onUp = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return
      e.preventDefault()
      if (e.button === 3) nav.back()
      else nav.forward()
    }
    addEventListener('keydown', onKey)
    addEventListener('mousedown', onDown)
    addEventListener('mouseup', onUp)
    return () => {
      removeEventListener('keydown', onKey)
      removeEventListener('mousedown', onDown)
      removeEventListener('mouseup', onUp)
    }
  })

  // 面包屑：历史还没跟上地址的那一下（刚 go 完）只画当前这一个
  const synced = nav.current?.path === path
  const crumbs = synced
    ? nav.chain.map((c, i, all) =>
        toCrumb(c.entry, `${c.index}`, i < all.length - 1 ? () => nav.jump(c.index) : undefined),
      )
    : path
      ? [toCrumb({ page, path, comp }, 'cur')]
      : []
  const scope = scopeOf(target)
  const recent = nav.recent.map((r) =>
    toRecent(r.entry, `${r.index}`, r.current, !!r.entry.scope && r.entry.scope !== scope, () => {
      if (r.entry.scope && r.entry.scope !== scope) h().toast.error(t('换过目标世界，这个对象可能已经不在了'))
      nav.jump(r.index)
    }),
  )
  // 资源提示条右边的「从 X 的 Y 跳过来」：当前是点引用过来的，前一条就是来处
  const cur = synced ? nav.current : undefined
  const prev = cur?.via ? nav.state.items[nav.state.index - 1] : undefined

  return (
    <section className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-1 ue:flex-col ue:bg-card">
      <InspectorBar
        canBack={nav.canBack}
        canForward={nav.canForward}
        onBack={nav.back}
        onForward={nav.forward}
        recent={recent}
        onClear={nav.clear}
        crumbs={crumbs}
        kind={path ? kindOfPath(path) : undefined}
        actions={
          path ? (
            <InspectorActions
              page={page}
              path={path}
              comp={comp}
              asset={asset}
              onOpenAssets={() => nav.open('assets', path, { from: 'link' })}
              onReveal={onReveal}
            />
          ) : undefined
        }
      />
      {asset && (
        <div className="ue:border-b ue:border-line ue:px-3 ue:py-2">
          <Note
            action={
              prev && (
                <button
                  type="button"
                  onClick={nav.back}
                  className="ue:shrink-0 ue:cursor-pointer ue:text-footnote ue:text-accent-text ue:hover:underline"
                >
                  {t('从 {n} 的 {p} 跳过来', { n: lastSeg(prev.path), p: cur!.via! })}
                </button>
              )
            }
          >
            <b className="ue:font-medium">{t('资源，不是运行中的对象')}</b>{' '}
            <span className="ue:text-muted">{t('改动点「保存」才写回文件，用它的 Actor 都会跟着变')}</span>
          </Note>
        </div>
      )}
      {!path ? (
        <p className="ue:p-6 ue:text-center ue:text-footnote ue:text-subtle">{empty}</p>
      ) : asset && changes ? (
        // 资源页上点了「改动」（或左栏「当前修改」里的一项）：换成磁盘上 → 编辑器里的差异
        <AssetChanges key={path} path={path} />
      ) : asset ? (
        <AssetView
          key={path}
          path={path}
          comp={comp}
          onComp={onComp}
          onOpen={open}
          onChanged={onChanged ?? reloadBadges}
        />
      ) : (
        <RuntimeView
          key={`${project.id}/${path}`}
          path={path}
          comp={comp}
          onComp={onComp}
          onOpen={open}
          onGone={() => go(page)}
        />
      )}
    </section>
  )
}
