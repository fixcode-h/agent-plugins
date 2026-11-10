import { op, useLoad } from './api.ts'
import { useUe } from './ctx.tsx'
import { h, t } from './host.ts'
import { Badge, ErrorText, fmtSize } from './ui.tsx'

interface Describe {
  path: string
  name: string
  class: string
  classChain: string[]
  package: string
  file: string
  onDisk: boolean
  size?: number
  readOnly?: boolean
  dirty: boolean
  tags: Record<string, string>
  subobjects: { path: string; name: string; class: string }[]
  subobjectCount: number
  dependencies: number
  referencers: number
}
interface Ref {
  package: string
  level: number
  via?: string
}
interface Refs {
  dependencies?: Ref[]
  dependencyTotal?: number
  referencers?: Ref[]
  referencerTotal?: number
}

/**
 * 资源的摘要和引用关系（任何资源都有这一页）：类、文件、注册表标签、内嵌子对象，以及「它用了谁」「谁用了它」。
 * 引用方点一下跳到那个资源；删除、改名前先在这里看会影响到谁
 */
export function AssetInfo({ path, onOpen }: { path: string; onOpen: (path: string) => void }) {
  const { project } = useUe()
  const info = useLoad(() => op<Describe>(project.id, 'asset.describe', { path }, undefined, 120000), [path])
  const refs = useLoad(() => op<Refs>(project.id, 'asset.refs', { path, limit: 200 }, undefined, 120000), [path])
  const d = info.data
  const tags = Object.entries(d?.tags ?? {})

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-4 ue:overflow-auto ue:px-4 ue:py-3">
      <ErrorText>{info.error || refs.error}</ErrorText>
      {d && (
        <dl className="ue:grid ue:grid-cols-[6rem_1fr] ue:gap-x-3 ue:gap-y-1.5 ue:text-footnote">
          <Row label={t('类')}>
            <span className="ue:text-fg">{d.class}</span>
            {d.classChain.length > 0 && (
              <span className="ue:text-subtle"> ← {d.classChain.slice(0, 4).join(' ← ')}</span>
            )}
          </Row>
          <Row label={t('文件')}>
            <span className="ue:font-mono ue:break-all ue:text-fg">{d.file}</span>
            <span className="ue:ml-2 ue:inline-flex ue:gap-1 ue:align-middle">
              {d.onDisk ? <Badge>{fmtSize(d.size ?? 0)}</Badge> : <Badge tone="warn">{t('还没存过盘')}</Badge>}
              {d.readOnly && <Badge>{t('只读')}</Badge>}
              {d.dirty && <Badge tone="warn">{t('未保存')}</Badge>}
            </span>
          </Row>
          {tags.length > 0 && (
            <Row label={t('标签')}>
              <ul className="ue:flex ue:flex-col ue:gap-0.5">
                {tags.map(([k, v]) => (
                  <li key={k} className="ue:break-all">
                    <span className="ue:text-subtle">{k}</span> <span className="ue:font-mono ue:text-fg">{v}</span>
                  </li>
                ))}
              </ul>
            </Row>
          )}
          {d.subobjectCount > 0 && (
            <Row label={t('子对象')}>
              <ul className="ue:flex ue:flex-col ue:gap-0.5">
                {d.subobjects.map((s) => (
                  <li key={s.path}>
                    <button
                      type="button"
                      className="ue:cursor-pointer ue:font-mono ue:text-accent-text ue:hover:underline"
                      onClick={() => onOpen(s.path)}
                    >
                      {s.name}
                    </button>
                    <span className="ue:ml-2 ue:text-subtle">{s.class}</span>
                  </li>
                ))}
                {d.subobjectCount > d.subobjects.length && (
                  <li className="ue:text-subtle">
                    {t('共 {n} 个，只列前 {m} 个', { n: d.subobjectCount, m: d.subobjects.length })}
                  </li>
                )}
              </ul>
            </Row>
          )}
        </dl>
      )}
      {refs.data && (
        <div className="ue:grid ue:gap-4 ue:lg:grid-cols-2">
          <RefList
            title={t('它用了谁')}
            items={refs.data.dependencies ?? []}
            total={refs.data.dependencyTotal ?? 0}
            onOpen={onOpen}
          />
          <RefList
            title={t('谁用了它')}
            items={refs.data.referencers ?? []}
            total={refs.data.referencerTotal ?? 0}
            onOpen={onOpen}
          />
        </div>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="ue:text-subtle">{label}</dt>
      <dd className="ue:min-w-0">{children}</dd>
    </>
  )
}

function RefList({
  title,
  items,
  total,
  onOpen,
}: {
  title: string
  items: Ref[]
  total: number
  onOpen: (path: string) => void
}) {
  const { cn } = h()
  // 引擎自带的脚本包（/Script/...）不是资源，点不开，淡显
  const isAsset = (p: string) => !p.startsWith('/Script/')
  return (
    <section className="ue:min-w-0 ue:rounded-lg ue:border ue:border-line">
      <header className="ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-3 ue:py-2 ue:text-footnote">
        <span className="ue:font-medium ue:text-fg">{title}</span>
        <span className="ue:text-subtle">{total}</span>
      </header>
      <ul className="ue:max-h-72 ue:overflow-auto ue:p-1.5 ue:font-mono ue:text-footnote">
        {items.map((r) => (
          <li key={r.package}>
            <button
              type="button"
              disabled={!isAsset(r.package)}
              onClick={() => onOpen(r.package)}
              className={cn(
                'ue:w-full ue:rounded-md ue:px-2 ue:py-1 ue:text-left ue:break-all',
                isAsset(r.package) ? 'ue:cursor-pointer ue:text-fg ue:hover:bg-hover' : 'ue:text-subtle',
              )}
            >
              {r.package}
            </button>
          </li>
        ))}
        {!items.length && <li className="ue:px-2 ue:py-3 ue:text-center ue:font-sans ue:text-subtle">{t('没有')}</li>}
        {total > items.length && (
          <li className="ue:px-2 ue:py-1 ue:font-sans ue:text-subtle">
            {t('共 {n} 个，只列前 {m} 个', { n: total, m: items.length })}
          </li>
        )}
      </ul>
    </section>
  )
}
