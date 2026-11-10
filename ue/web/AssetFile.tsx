import { ArrowLeft, ExternalLink } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { FileViewerProps } from '../../sdk/web.ts'
import type { ProjectState, Target, UeProject } from '../server/types.ts'
import { get, op, pget, useLoad } from './api.ts'
import { AssetInfo } from './AssetInfo.tsx'
import { BlueprintView } from './Blueprint.tsx'
import { Ctx, type UeCtx } from './ctx.tsx'
import { DataTableView } from './DataTable.tsx'
import { h, t } from './host.ts'
import { Props, shortName } from './Props.tsx'
import { ErrorText, LinkBtn, kindLabel } from './ui.tsx'

interface AssetRow {
  path: string
  name: string
  class: string
  package: string
}

const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const noop = () => undefined

/**
 * 对话里点 .uasset 弹出的查看窗口（面板 SDK 的 fileViewers）：按磁盘路径在资产注册表里找到这个资源，
 * DataTable 显示成表格，DataAsset 等显示属性，蓝图多一页大纲和图表伪代码，都有「摘要与引用」。和 UE 页的资源分区用同一套读取
 * （编辑器开着读编辑器里的，没开时起后台编辑器读磁盘上的版本）和同一套组件，这里只看不改：
 * 改动要暂存、保存、P4 签出，这些在资源分区里，底栏给了入口。
 */
export function AssetFile({ path, projectId, close }: FileViewerProps) {
  const { ui, hooks } = h()
  const nav = hooks.useNav()
  const projects = useLoad(() => get<{ projects: UeProject[] }>('/projects').then((r) => r.projects), [])
  // 先认对话所在的项目；对话在别的项目里引用了这个文件时，按文件在谁的目录下找
  const project = useMemo(() => {
    const list = projects.data ?? []
    const p = norm(path)
    return list.find((x) => x.id === projectId) ?? list.find((x) => p.startsWith(norm(x.root) + '/'))
  }, [projects.data, projectId, path])

  const openPage = (sub?: string) => {
    nav.go({ page: 'plugin', id: 'ue', sub: 'main', msg: sub })
    close()
  }

  if (projects.error)
    return (
      <div className="ue:p-6">
        <ErrorText>{projects.error}</ErrorText>
      </div>
    )
  if (!projects.data) return <Hint>{t('读取中…')}</Hint>
  if (!project)
    return (
      <Hint
        action={
          <ui.Button size="sm" onClick={() => openPage()}>
            <ExternalLink className="ue:h-3.5 ue:w-3.5" /> {t('打开 UE 页')}
          </ui.Button>
        }
      >
        {t('这个文件所在的项目还没有接入 UE 页。在 UE 页里添加项目、装上桥接插件后，就能在这里看资源的属性。')}
      </Hint>
    )
  return <Loaded key={project.id} project={project} file={path} openPage={openPage} />
}

function Loaded({
  project,
  file,
  openPage,
}: {
  project: UeProject
  file: string
  openPage: (sub?: string) => void
}) {
  const state = useLoad(() => pget<ProjectState>(project.id, 'state'), [project.id], 5000)
  const s = state.data
  // 编辑器开着就读编辑器里的（可能有没保存的改动，和用户眼前的一致）；没开时不指定，服务端起后台编辑器
  const hasEditor = !!s?.instances.some((i) => i.kind === 'editor' && i.online)
  const target = useMemo<Target>(() => (hasEditor ? { instance: 'editor' } : {}), [hasEditor])
  const found = useLoad(
    () =>
      s
        ? op<{ items: AssetRow[]; instance?: { kind: string }; searched?: { path: string; prefix: string } }>(
            project.id,
            'assets',
            { class: '', prefix: file, path: '/Game', limit: 50 },
            target,
            15 * 60000,
          )
        : Promise.resolve(undefined),
    // 状态每 5 秒刷一次，只在「有没有状态、编辑器开没开」变了时重找
    [project.id, file, !!s, hasEditor],
  )
  // 同目录里名字以它开头的都会搜到（DT_Item、DT_ItemExtra）：要名字完全一样的那个
  const stem = (file.split(/[\\/]/).pop() ?? '').replace(/\.[^.]*$/, '').toLowerCase()
  const asset = found.data?.items.find((a) => a.name.toLowerCase() === stem)
  // 属性里点到别的资源就在窗口里接着看，← 回来
  const [trail, setTrail] = useState<string[]>([])
  const cur = trail.at(-1)
  const path = cur ?? asset?.path ?? ''
  const isTable = cur ? /\/DT_/.test(cur) : asset?.class === 'DataTable'
  // 和资源分区同一个判断：点引用跳过来的没有类名，按常见前缀猜；组件模板这类子对象路径带冒号，不算
  const isBlueprint =
    !path.includes(':') &&
    (cur ? /\/(BP|WBP|ABP|BPI|BPFL)_[^/]*$/.test(cur) : /Blueprint$/.test(asset?.class ?? ''))
  const [view, setView] = useState<'main' | 'graph' | 'info'>('main')
  const tab = view === 'graph' && !isBlueprint ? 'main' : view
  const { ui } = h()
  const open = (p: string) => {
    setView('main')
    setTrail((x) => [...x, p])
  }
  const source = found.data?.instance?.kind

  const ctx = useMemo<UeCtx>(
    () => ({
      project,
      state: s,
      reload: () => void state.reload(),
      target,
      setTarget: noop,
      section: 'assets',
      sub: path,
      go: (section, sub) =>
        openPage([project.id, section, sub ?? ''].map(encodeURIComponent).join('/').replace(/\/+$/, '')),
      reloadBadges: noop,
      openShot: noop,
      openJump: noop,
    }),
    // openPage、state.reload 每次渲染都是新的，按数据变化重建就够
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [project, s, target, path],
  )

  const starting = !s?.instances.some((i) => i.kind !== 'background') && !s?.background.running

  return (
    <Ctx.Provider value={ctx}>
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
        {state.error || found.error ? (
          <div className="ue:p-6">
            <ErrorText>{state.error || found.error}</ErrorText>
          </div>
        ) : !found.data ? (
          <Hint>
            {s && starting ? t('UE 没在运行，正在启动后台编辑器，第一次要 30–60 秒…') : t('读取中…')}
          </Hint>
        ) : !path ? (
          <Hint>
            {t('在 UE 的资源里没有找到这个文件。可能是刚新建还没被 UE 扫到，或者不在这个项目的 Content 目录里。')}
            {found.data.searched && (
              <span className="ue:mt-1 ue:block ue:font-mono ue:break-all">
                {t('在 {path} 下找名字以 {prefix} 开头的', found.data.searched)}
              </span>
            )}
          </Hint>
        ) : (
          <>
            <div className="ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-2">
              <ui.Segmented
                size="sm"
                label={t('内容 / 蓝图 / 摘要')}
                value={tab}
                onChange={setView}
                options={[
                  { id: 'main' as const, label: isTable ? t('表格') : isBlueprint ? t('类默认值') : t('属性') },
                  ...(isBlueprint ? [{ id: 'graph' as const, label: t('蓝图') }] : []),
                  { id: 'info' as const, label: t('摘要与引用') },
                ]}
              />
            </div>
            {tab === 'info' ? (
              <AssetInfo key={path} path={path} onOpen={open} />
            ) : tab === 'graph' ? (
              <BlueprintView key={path} path={path} onOpen={open} onChanged={noop} />
            ) : isTable ? (
              <DataTableView key={path} path={path} viewOnly />
            ) : (
              <Props key={path} path={path} viewOnly onOpen={open} />
            )}
          </>
        )}
        {path && (
          <footer className="ue:flex ue:flex-wrap ue:items-center ue:gap-x-3 ue:gap-y-1 ue:border-t ue:border-line ue:px-4 ue:py-2 ue:text-footnote ue:text-subtle">
            {cur && (
              <LinkBtn onClick={() => setTrail((x) => x.slice(0, -1))}>
                <ArrowLeft className="ue:h-3 ue:w-3" />{' '}
                {t('回到 {n}', { n: shortName(trail.at(-2) ?? asset?.path ?? '') })}
              </LinkBtn>
            )}
            {source && (
              <span>
                {t('来源：{src}', {
                  src: source === 'background' ? t('后台编辑器（磁盘上保存的版本）') : kindLabel(source),
                })}
              </span>
            )}
            <span className="ue:ml-auto">
              <LinkBtn onClick={() => ctx.go('assets', path)}>
                <ExternalLink className="ue:h-3 ue:w-3" /> {t('在 UE 页里打开（可以修改）')}
              </LinkBtn>
            </span>
          </footer>
        )}
      </div>
    </Ctx.Provider>
  )
}

/** 居中的一句说明（读取中、没接入、没找到） */
function Hint({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="ue:flex ue:flex-1 ue:flex-col ue:items-center ue:justify-center ue:gap-3 ue:p-8 ue:text-center">
      <p className="ue:max-w-md ue:text-body ue:leading-relaxed ue:text-subtle">{children}</p>
      {action}
    </div>
  )
}

