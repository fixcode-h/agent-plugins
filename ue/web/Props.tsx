import { ArrowLeft, ChevronRight, Copy, MessageSquare } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { op, show, useLoad } from './api.ts'
import { useUe } from './ctx.tsx'
import { h, t } from './host.ts'
import { LuaTable } from './Lua.tsx'
import { LuaSource } from './sections/lua/LuaSource.tsx'
import { Badge, KindBadge, Note, useTargetInfo, worldLabel } from './ui.tsx'
import { useToChat } from './chat.tsx'
import { CdoNote } from './CdoNote.tsx'
import { Functions } from './Functions.tsx'
import { Details } from './details/Details.tsx'
import { useDetailsApi } from './details/api.ts'
import { Transform } from './details/Transform.tsx'
import { isRuntimePath, looksLikePath, type Prop } from './details/model.ts'
import type { OpenHow } from './details/RefChip.tsx'
import type { World } from '../server/types.ts'

export type { Prop }

/**
 * 属性面板（图 4 右栏）：按 Category 分菜单，一次只看一个分类（用户 2026-11-10 定：不要全堆在一起；搜索时跨分类列出），改值、改过的高亮原值、同步属性在客户端改时提示切服务器、
 * 对象引用可点跳转、固定到监视、复制路径；旁边「函数」页签列出能调的函数。
 * 性能：属性列表一次取（大的值是摘要，展开时按路径单独取全量），按名字筛选点「搜索」才发请求
 */
export function Props({
  path: root,
  title,
  onOpen,
  readOnlyHint,
  cdo,
  viewOnly,
  bar,
  aside,
  mainLabel,
  noFns,
  more,
  moreTab = '',
  onMoreTab,
}: {
  path: string
  title?: string
  /**
   * 点对象引用：via 是属性的显示名（导航条面包屑写「经 Static Mesh」），how.ctrl 是 Ctrl+点（资源在资源页打开）。
   * 页面里交给导航历史（inspect/history.ts）；只有对话里点 .uasset 弹出的查看窗不给，那里用这里自己的小面包屑
   */
  onOpen?: (path: string, via?: string, how?: OpenHow) => void
  readOnlyHint?: string
  /** 运行时对象页：选到资源默认值（Default__）时醒目提示，给「改运行中的实例」（界面优化第 2 条） */
  cdo?: boolean
  /** 只看不改（对话里点 .uasset 弹出的查看窗口，那里没有保存、放弃改动的地方）：不出改值、函数、固定到监视 */
  viewOnly?: boolean
  /** 放在检视区导航条下面（inspect/Inspector.tsx）：类型徽标、复制路径、发给对话都在导航条上，这里不重复；标题后面写完整路径 */
  bar?: boolean
  /** 标题行右边、页签前面的按钮（资源的「导出到 JSON」） */
  aside?: ReactNode
  /** 「属性」页签换个名字（蓝图资源叫「类默认值」） */
  mainLabel?: string
  /** 不出「函数」页签（蓝图资源的类默认值，设计稿第 3 节） */
  noFns?: boolean
  /** 标题行页签里多加的几页（资源的「蓝图」「摘要与引用」）：选中时下面换成它的内容，标题行不变 */
  more?: { id: string; label: string; view: ReactNode }[]
  moreTab?: string
  onMoreTab?: (id: string) => void
}) {
  const { project, target, setTarget } = useUe()
  // 小面包屑：只给对话里的 .uasset 查看窗（没有页面历史）用，在面板里点运行时对象的引用就在这里往下看，← 回到上一个。
  // 页面里统一交给导航历史（设计稿第 5 节），不再各管各的
  const [trail, setTrail] = useState<string[]>([])
  const path = trail.at(-1) ?? root
  const chat = useToChat()
  const { inst, world } = useTargetInfo()
  const { ui, cn, toast } = h()
  const [tab, setTab] = useState<'props' | 'fns' | 'lua'>('props')
  // 装了 UnLua 的项目（桥接编进了 Lua 支持）：运行时对象多一个「Lua」页签看它的 Lua 实例表
  const hasLua = !!inst?.lua && isRuntimePath(path)
  const [warn, setWarn] = useState('')
  const data = useLoad(
    () =>
      op<{
        object: { path: string; name: string; class: string }
        kind?: 'instance' | 'asset' | 'class'
        readOnlyWhy?: string
        /** 编辑器没开、服务端直接读文件给的（server/uasset）：note 说明只有改过的值、不能改 */
        offline?: boolean
        note?: string
        props: Prop[]
      }>(project.id, 'props', { path, filter: '', maxChars: 400 }, target),
    [path, target.instance, target.world],
  )
  // 类本身（WidgetBlueprintGeneratedClass 这种）整个只读
  const lockAll = data.data?.readOnlyWhy
  const banner = data.data?.offline ? data.data.note : lockAll
  const props = (data.data?.props ?? [])
    .map((p) => (lockAll ? { ...p, readOnly: true, readOnlyWhy: lockAll } : p))
    .map((p) =>
      viewOnly ? { ...p, readOnly: true, readOnlyWhy: p.readOnlyWhy ?? t('这里只看不改，要改去 UE 页的资源分区') } : p,
    )

  /** 点对象引用：交给外面的导航历史；没给 onOpen（只读查看窗）时运行时对象在这里往下看 */
  const openRef = (p: string, via?: string) =>
    onOpen && (looksLikePath(p) || isRuntimePath(p))
      ? (how: OpenHow) => onOpen(p, via, how)
      : !onOpen && isRuntimePath(p)
        ? () => {
            setTrail((x) => [...x, p])
            setTab('props')
          }
        : undefined
  const api = useDetailsApi(path, {
    q: '',
    reload: () => void data.reload(),
    onReplicatedClient: setWarn,
    openRef,
    viewOnly,
  })
  // Actor：细节面板最上面是根组件的变换（UE 一样）
  const rootComp = props.find((p) => p.name === 'RootComponent' && typeof p.value === 'string' && p.value)?.value as
    string | undefined

  const server = inst?.worlds.find((w) => w.netMode === 'ListenServer' || w.netMode === 'DedicatedServer')

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <header className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-2.5">
        {trail.length > 0 && (
          <ui.IconButton
            icon={ArrowLeft}
            label={t('返回上一个')}
            size="sm"
            onClick={() => setTrail((x) => x.slice(0, -1))}
          />
        )}
        <nav aria-label={t('对象路径')} className="ue:flex ue:min-w-0 ue:items-center ue:gap-1">
          {[root, ...trail].slice(0, -1).map((p, i) => (
            <span key={`${i}:${p}`} className="ue:flex ue:min-w-0 ue:items-center ue:gap-1">
              <button
                type="button"
                title={p}
                onClick={() => setTrail((x) => x.slice(0, i))}
                className="ue:max-w-40 ue:cursor-pointer ue:truncate ue:font-mono ue:text-footnote ue:text-accent-text ue:hover:underline"
              >
                {shortName(p)}
              </button>
              <ChevronRight className="ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle" />
            </span>
          ))}
          <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-body ue:font-medium ue:text-fg" title={path}>
            {(!trail.length && title) || data.data?.object.name || shortName(path)}
          </span>
        </nav>
        {!bar && <KindBadge kind={data.data?.kind} />}
        {data.data && <Badge>{data.data.object.class}</Badge>}
        {bar && !isRuntimePath(path) && (
          <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-caption ue:text-subtle" title={path}>
            {path.split('.')[0]}
          </span>
        )}
        <div className="ue:ml-auto ue:flex ue:items-center ue:gap-1">
          {aside}
          {(!viewOnly || !!more?.length) && (
            <ui.Segmented
              size="sm"
              label={t('属性 / 函数')}
              value={moreTab || tab}
              onChange={(id: string) => {
                if (more?.some((m) => m.id === id)) return onMoreTab?.(id)
                onMoreTab?.('')
                setTab(id as typeof tab)
              }}
              options={[
                { id: 'props', label: mainLabel ?? t('属性') },
                ...(viewOnly || noFns ? [] : [{ id: 'fns', label: t('函数') }]),
                ...(hasLua && !viewOnly ? [{ id: 'lua' as const, label: 'Lua' }] : []),
                ...(more ?? []).map((m) => ({ id: m.id, label: m.label })),
              ]}
            />
          )}
          {!bar && (
            <ui.IconButton
              icon={Copy}
              label={t('复制路径')}
              size="sm"
              onClick={() => void navigator.clipboard.writeText(path).then(() => toast.success(t('已复制')))}
            />
          )}
          {!bar && chat.available && (
            <ui.Button
              size="sm"
              variant="secondary"
              onClick={() => chat.send(describeObject(path, data.data, props, world))}
            >
              <MessageSquare className="ue:h-3.5 ue:w-3.5" /> {t('发给对话')}
            </ui.Button>
          )}
        </div>
      </header>
      {cdo && data.data?.kind === 'asset' && <CdoNote cls={data.data.object.class} />}
      {(readOnlyHint || banner) && (
        <div className="ue:border-b ue:border-line ue:px-4 ue:py-2">
          <Note tone="info">{readOnlyHint || banner}</Note>
        </div>
      )}
      {moreTab && more?.some((m) => m.id === moreTab) ? (
        more.find((m) => m.id === moreTab)!.view
      ) : tab === 'lua' && hasLua ? (
        <>
          <LuaSource path={path} />
          <LuaTable path={path} onOpen={onOpen && ((p) => onOpen(p, 'Lua'))} />
        </>
      ) : tab === 'fns' && !noFns ? (
        <Functions path={path} />
      ) : (
        <>
          {warn && (
            <div className="ue:border-b ue:border-line ue:px-4 ue:py-2">
              <Note
                action={
                  server && (
                    <ui.Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setTarget(inst!.pid, inst!.kind, server.id)
                        setWarn('')
                      }}
                    >
                      {t('切到服务器')}
                    </ui.Button>
                  )
                }
              >
                {t('{p} 是同步属性，客户端改了会被服务器的值盖掉。要改真实值，把目标切到服务器世界。', { p: warn })}
              </Note>
            </div>
          )}
          <Details
            props={props}
            api={api}
            loading={data.loading}
            top={(q) => rootComp && <Transform root={rootComp} q={q} openRef={openRef} />}
            footer={
              <>
                {data.error && (
                  <p className="ue:border-t ue:border-line ue:px-4 ue:py-1.5 ue:text-footnote ue:text-danger">
                    {data.error}
                  </p>
                )}
                {world && (
                  <div className="ue:border-t ue:border-line ue:px-4 ue:py-1.5 ue:text-caption ue:text-subtle">
                    {t('运行时改的值停止 PIE 后不保留')}
                  </div>
                )}
              </>
            }
          />
        </>
      )}
      {chat.dialog}
    </div>
  )
}

/** 路径的最后一段（面包屑、标题）：…:PersistentLevel.BP_Hero_C_1.HealthComponent → HealthComponent */
export function shortName(p: string) {
  return p.split(/[.:/]/).pop() || p
}

/** 「发给对话」的内容：对象路径、类、目标世界，和当前列出来的属性值（最多 40 个，长值截断） */
export function describeObject(
  path: string,
  d: { object: { class: string }; kind?: string } | undefined,
  props: Prop[],
  world: World | undefined,
) {
  const lines = props.slice(0, 40).map((p) => {
    const v = show(p.value)
    return `${p.name} = ${v.length > 200 ? `${v.slice(0, 200)} …` : v}`
  })
  // 发给 Agent 的话不翻译（作为用户消息交给 CLI）
  return [
    `UE 对象 \`${path}\`${d ? `（${d.object.class}）` : ''}${world ? `，目标世界：${worldLabel(world)}` : ''}`,
    lines.length
      ? ['```', ...lines, props.length > 40 ? `… 还有 ${props.length - 40} 个属性` : '', '```']
          .filter(Boolean)
          .join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}
