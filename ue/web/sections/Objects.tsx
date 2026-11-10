import { useState } from 'react'
import { op, useLoad } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Props } from '../Props.tsx'
import { Card, ErrorText, Note, PageHead, TargetPicker, useTargetInfo } from '../ui.tsx'

interface Row {
  path: string
  name: string
  class: string
}

/** 常用的运行时对象：点一下按类搜 */
const QUICK = [
  'GameInstance',
  'GameStateBase',
  'PlayerController',
  'GameModeBase',
  'PlayerState',
  'GameInstanceSubsystem',
  'WorldSubsystem',
]

/**
 * 运行时对象：按类名和名字前缀找活着的 UObject（子系统、GameInstance、GameState…），右边看和改属性。
 * 不写类名时桥接要扫全部对象，限时 50 毫秒，超时只给部分结果并提示加类名
 */
export function Objects() {
  const { project, target, sub, go } = useUe()
  const { inst } = useTargetInfo()
  const { cn, ui } = h()
  const [cls, setCls] = useState('')
  const [prefix, setPrefix] = useState('')
  const [q, setQ] = useState<{ cls: string; prefix: string }>()
  const found = useLoad(
    () =>
      q
        ? op<{ items: Row[]; more: boolean; partial: boolean }>(
            project.id,
            'objects',
            { class: q.cls, prefix: q.prefix, limit: 200 },
            target,
          )
        : Promise.resolve(undefined),
    [q, target.instance],
  )
  const search = (c = cls, p = prefix) => {
    if (c.trim() || p.trim()) setQ({ cls: c.trim(), prefix: p.trim() })
  }
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead
        title={t('运行时对象')}
        desc={t('按类和名字找活着的 UObject：子系统、GameInstance、GameState、单例管理器…')}
      >
        <TargetPicker />
      </PageHead>
      {!inst ? (
        <div className="ue:p-6">
          <ui.EmptyPanel>{t('UE 没在运行：运行时对象要在运行中的编辑器或游戏里找；资源在「资源」里看')}</ui.EmptyPanel>
        </div>
      ) : (
        <div className="ue:grid ue:min-h-0 ue:flex-1 ue:gap-4 ue:overflow-auto ue:p-6 ue:lg:grid-cols-[minmax(280px,1fr)_minmax(360px,1.8fr)] ue:lg:overflow-hidden">
          <Card bodyClass="ue:flex ue:min-h-0 ue:flex-col">
            <form
              className="ue:flex ue:flex-col ue:gap-2 ue:border-b ue:border-line ue:p-3"
              onSubmit={(e) => {
                e.preventDefault()
                search()
              }}
            >
              <ui.Input
                size="sm"
                value={cls}
                placeholder={t('类名，例如 MyInventorySubsystem')}
                onChange={(e: { target: { value: string } }) => setCls(e.target.value)}
              />
              <div className="ue:flex ue:gap-2">
                <ui.Input
                  size="sm"
                  className="ue:flex-1"
                  value={prefix}
                  placeholder={t('名字开头（可选）')}
                  onChange={(e: { target: { value: string } }) => setPrefix(e.target.value)}
                />
                <ui.Button
                  size="sm"
                  variant="secondary"
                  type="submit"
                  disabled={found.loading || (!cls.trim() && !prefix.trim())}
                >
                  {t('搜索')}
                </ui.Button>
              </div>
              <div className="ue:flex ue:flex-wrap ue:gap-1">
                {QUICK.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setCls(c)
                      search(c, prefix)
                    }}
                    className="ue:h-6 ue:cursor-pointer ue:rounded-md ue:bg-hover ue:px-1.5 ue:font-mono ue:text-caption ue:text-muted ue:hover:text-fg"
                  >
                    {c}
                  </button>
                ))}
              </div>
              <ErrorText>{found.error}</ErrorText>
              {found.data?.partial && (
                <Note>{t('只写了名字没写类名：对象太多，只搜了一部分。加上类名搜得更快也更全。')}</Note>
              )}
              {found.data?.more && (
                <span className="ue:text-footnote ue:text-subtle">
                  {t('超过 {n} 个，只列前 {n} 个', { n: found.data.items.length })}
                </span>
              )}
            </form>
            <ul className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:p-1.5">
              {(found.data?.items ?? []).map((o) => (
                <li key={o.path}>
                  <button
                    type="button"
                    onClick={() => go('objects', o.path)}
                    className={cn(
                      'ue:flex ue:w-full ue:cursor-pointer ue:flex-col ue:rounded-lg ue:px-2.5 ue:py-1.5 ue:text-left ue:hover:bg-hover',
                      sub === o.path && 'ue:bg-sel',
                    )}
                  >
                    <span className="ue:truncate ue:text-body ue:text-fg">{o.name}</span>
                    <span className="ue:truncate ue:text-caption ue:text-subtle" title={o.path}>
                      {o.class} · {o.path}
                    </span>
                  </button>
                </li>
              ))}
              {found.data && !found.data.items.length && (
                <li className="ue:p-4 ue:text-center ue:text-footnote ue:text-subtle">{t('没有找到')}</li>
              )}
            </ul>
          </Card>
          <Card bodyClass="ue:flex ue:min-h-0 ue:flex-col">
            {sub ? (
              <Props key={sub} path={sub} onOpen={(p) => go(p.startsWith('/Game') ? 'assets' : 'objects', p)} />
            ) : (
              <p className="ue:p-6 ue:text-center ue:text-footnote ue:text-subtle">{t('选中对象后在这里看和改属性')}</p>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
