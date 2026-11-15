import { useState } from 'react'
import { op, useLoad } from '../../api.ts'
import { ClassPicker, type ClassOpt } from '../../ClassPicker.tsx'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { keep, useGoneFromList, useKept } from '../../keep.ts'
import { takePending } from '../../pending.ts'
import { ErrorText, Note, SearchBox, kindLabel } from '../../ui.tsx'

interface AssetRow {
  path: string
  name: string
  class: string
  package: string
}

/** 类型下拉不打字时先列的常用类型；其余的从 UE 的资源注册表里取（项目里真有资源的所有类型），打字能搜到引擎里任何类 */
const COMMON = [
  'DataTable',
  'PrimaryDataAsset',
  'DataAsset',
  'Blueprint',
  'WidgetBlueprint',
  'CurveTable',
  'CurveFloat',
  'StringTable',
  'Material',
  'MaterialInstanceConstant',
  'Texture2D',
  'StaticMesh',
  'SkeletalMesh',
  'AnimSequence',
  'AnimBlueprint',
  'SoundWave',
  'World',
]
const TABLE: ClassOpt = { name: 'DataTable' }

/**
 * 资源页浏览栏的「搜索」（原来资源页的左栏原样搬过来）：按类型和名字前缀找资源（点搜索才搜），
 * 编辑器没开时起后台编辑器读，结果下面写来源（编辑器 / 后台编辑器读的磁盘版本）
 */
export function AssetSearch({ selected, onOpen }: { selected: string; onOpen: (path: string) => void }) {
  const { project, go, state } = useUe()
  const { cn } = h()
  const all: ClassOpt = { name: '', label: t('所有类型') }
  const kk = `${project.id}/assets`
  // Ctrl+K 带过来的路径或名字：按所有类型搜一次，盖掉留着的条件（lazy 初始值只取一次，切回来不会再搜）
  useState(() => {
    const p = takePending('assets')
    if (p) {
      keep(`${kk}/cls`, all)
      keep(`${kk}/prefix`, p)
      keep(`${kk}/q`, { cls: '', prefix: p })
    }
    return p
  })
  const [cls, setCls] = useKept<ClassOpt>(`${kk}/cls`, TABLE)
  // 搜索框里的字收在这里：换类型时按现在的字重搜
  const [prefix, setPrefix] = useKept(`${kk}/prefix`, '')
  const [q, setQ] = useKept<{ cls: string; prefix: string } | undefined>(`${kk}/q`, undefined)
  // 有编辑器（或后台编辑器已经起来）才去取类型列表：只是点开下拉，不为它启动后台编辑器
  const canList = (state?.instances ?? []).some((i) => i.kind === 'editor' || i.kind === 'background')
  const found = useLoad(
    () =>
      q
        ? op<{
            items: AssetRow[]
            total: number
            instance: { kind: string }
            searched?: { path: string; prefix: string }
          }>(project.id, 'assets', { class: q.cls, prefix: q.prefix, path: '/Game', limit: 200 }, undefined, 15 * 60000)
        : Promise.resolve(undefined),
    [q],
    0,
    `${kk}/found`,
  )
  useGoneFromList(found.data?.items, q, selected, () => go('assets'))
  const source = found.data?.instance?.kind

  return (
    <>
      <div className="ue:flex ue:flex-col ue:gap-2 ue:border-b ue:border-line ue:p-3">
        <ClassPicker
          value={cls.name ? cls : all}
          common={[all, ...COMMON.map((name) => ({ name }))]}
          placeholder={t('搜资源类型，例如 Material、InputAction')}
          load={
            canList
              ? (s) =>
                  op<{ items: { name: string; path: string; count: number }[] }>(
                    project.id,
                    'asset.classes',
                    { q: s, limit: 200 },
                    undefined,
                    60000,
                  ).then((r) =>
                    r.items.map((c) => ({
                      name: c.name,
                      path: c.path,
                      note: c.count ? t('{n} 个', { n: c.count }) : undefined,
                    })),
                  )
              : undefined
          }
          onChange={(c) => {
            setCls(c)
            // 选了具体类型就按现在的字重搜（空的也行，列这个类型的全部）；选「所有类型」要有字才搜
            if (c.name || prefix) setQ({ cls: c.path || c.name, prefix })
          }}
        />
        <SearchBox
          initial={prefix}
          placeholder={t('资源名开头（DT_Item），或目录（/Game/Data、磁盘上 Content 里的路径）')}
          hint={t('前缀')}
          allowEmpty={!!cls.name}
          onSearch={(p) => {
            setPrefix(p)
            setQ({ cls: cls.path || cls.name, prefix: p })
          }}
          busy={found.loading}
        />
        {found.loading &&
          state &&
          !state.instances.some((i) => i.kind !== 'background') &&
          !state.background.running && (
            <Note tone="info">{t('UE 没在运行，正在启动后台编辑器，第一次要 30–60 秒…')}</Note>
          )}
        <ErrorText>{found.error}</ErrorText>
        {found.data && found.data.total > found.data.items.length && (
          <span className="ue:text-footnote ue:text-subtle">
            {t('共 {n} 个，只列前 {m} 个', { n: found.data.total, m: found.data.items.length })}
          </span>
        )}
        {source && (
          <span className="ue:text-caption ue:text-subtle">
            {t('来源：{src}', {
              src: source === 'background' ? t('后台编辑器（磁盘上保存的版本）') : kindLabel(source),
            })}
          </span>
        )}
      </div>
      <ul className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:p-1.5">
        {(found.data?.items ?? []).map((a) => (
          <li key={a.path}>
            <button
              type="button"
              onClick={() => onOpen(a.path)}
              className={cn(
                'ue:flex ue:w-full ue:cursor-pointer ue:flex-col ue:rounded-lg ue:px-2.5 ue:py-1.5 ue:text-left ue:hover:bg-hover',
                selected === a.path && 'ue:bg-sel',
              )}
            >
              <span className="ue:flex ue:items-center ue:gap-2">
                <span className="ue:truncate ue:text-body ue:text-fg">{a.name}</span>
                <span className="ue:ml-auto ue:shrink-0 ue:text-caption ue:text-subtle">{a.class}</span>
              </span>
              <span className="ue:truncate ue:text-caption ue:text-subtle">{a.package}</span>
            </button>
          </li>
        ))}
        {!q && (
          <li className="ue:p-4 ue:text-center ue:text-footnote ue:text-subtle">
            {t('选类型，输入名字开头或目录，点「搜索」')}
          </li>
        )}
        {found.data && !found.data.items.length && (
          <li className="ue:p-4 ue:text-center ue:text-footnote ue:text-subtle">
            {t('没有找到')}
            {found.data.searched && (
              <span className="ue:mt-1 ue:block ue:font-mono ue:break-all">
                {found.data.searched.prefix
                  ? t('在 {path} 下找名字以 {prefix} 开头的', found.data.searched)
                  : t('在 {path} 下找', found.data.searched)}
              </span>
            )}
          </li>
        )}
      </ul>
    </>
  )
}
