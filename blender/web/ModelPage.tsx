import { useEffect, useState } from 'react'
import { AlertTriangle, Box, Loader2, Plus } from 'lucide-react'
import type { Task } from '../../sdk/web.ts'
import { h, t } from './host.ts'
import { MODE } from './mode.ts'
import { SimpleComposer } from './SimpleComposer.tsx'
import type { BlenderStatus } from './types.ts'

/** 模型设计页列表要用的对话字段（面板 useTasks 给的是对话摘要） */
interface Row extends Task {
  working?: boolean
  archived?: boolean
  deletedAt?: string | null
  parentTaskId?: string
  updatedAt?: string
  askedAt?: string
}

const isModel = (x: Row) => (x.plugin === MODE || x.modelDesign === true) && !x.parentTaskId && !x.deletedAt
const recent = (x: Row) => x.askedAt || x.updatedAt || ''

/**
 * 模型设计页（图标栏里的「模型设计」，地址 #/plugin/blender/model/<对话 id>）：左栏列模型对话，右边是对话本身；
 * 没选对话时是新建页，直接写要建的模型就开一个对话，不用选项目（对话不属于项目，场景存在插件数据目录里）。
 * 面板旧版本建在项目里的模型对话也列在这里
 */
export function ModelPage({ path }: { path: string }) {
  const { hooks, ui, cn } = h()
  const route = hooks.usePluginRoute()
  const { tasks } = hooks.useTasks() as { tasks: Row[] }
  const taskId = decodeURIComponent(path.split('/')[0] ?? '')
  const list = tasks.filter((x) => isModel(x) && !x.archived).sort((a, b) => recent(b).localeCompare(recent(a)))
  const open = (id?: string) => route.go('model', id ? encodeURIComponent(id) : undefined)

  return (
    <div className="bl:flex bl:h-full bl:min-h-0 bl:w-full bl:min-w-0 bl:flex-1 bl:flex-col bl:bg-bg bl:md:flex-row">
      <aside
        aria-label={t('模型设计')}
        className="bl:flex bl:max-h-[40%] bl:shrink-0 bl:flex-col bl:border-b bl:border-line bl:bg-panel bl:md:max-h-none bl:md:w-64 bl:md:border-r bl:md:border-b-0"
      >
        <div className="bl:flex bl:h-12 bl:shrink-0 bl:items-center bl:gap-2 bl:px-3">
          <span className="bl:flex bl:h-7 bl:w-7 bl:items-center bl:justify-center bl:rounded-lg bl:bg-peer bl:text-white">
            <Box className="bl:h-4 bl:w-4" />
          </span>
          <span className="bl:flex-1 bl:truncate bl:text-body bl:font-medium bl:text-fg">{t('模型设计')}</span>
        </div>
        <nav className="bl:flex bl:min-h-0 bl:flex-1 bl:flex-col bl:gap-0.5 bl:overflow-y-auto bl:px-2 bl:pb-2">
          <button
            type="button"
            onClick={() => open()}
            className={cn(
              'bl:flex bl:h-8 bl:shrink-0 bl:items-center bl:gap-2 bl:rounded-lg bl:px-2.5 bl:text-left bl:text-body bl:transition-colors',
              !taskId ? 'bl:bg-sel bl:text-fg' : 'bl:text-muted bl:hover:bg-hover bl:hover:text-fg',
            )}
          >
            <Plus className="bl:h-3.5 bl:w-3.5 bl:shrink-0" />
            {t('新建模型设计')}
          </button>
          {list.length > 0 && <p className="bl:mt-2 bl:mb-0.5 bl:px-2.5 bl:text-caption bl:text-subtle">{t('最近')}</p>}
          {list.map((x) => (
            <button
              key={x.id}
              type="button"
              title={x.title || t('未命名模型')}
              onClick={() => open(x.id)}
              className={cn(
                'bl:flex bl:h-8 bl:shrink-0 bl:items-center bl:gap-2 bl:rounded-lg bl:px-2.5 bl:text-left bl:text-body bl:transition-colors',
                taskId === x.id ? 'bl:bg-sel bl:text-fg' : 'bl:text-muted bl:hover:bg-hover bl:hover:text-fg',
              )}
            >
              <span className="bl:min-w-0 bl:flex-1 bl:truncate">{x.title || t('未命名模型')}</span>
              {x.working && <Loader2 className="bl:h-3.5 bl:w-3.5 bl:shrink-0 bl:animate-spin bl:text-subtle" />}
            </button>
          ))}
          {!list.length && (
            <p className="bl:mt-2 bl:px-2.5 bl:text-footnote bl:leading-relaxed bl:text-subtle">
              {t('还没有模型设计对话。写下要建的模型，就会开一个对话用 Blender 建模。')}
            </p>
          )}
        </nav>
      </aside>
      <div className="bl:flex bl:min-h-0 bl:min-w-0 bl:flex-1">
        {taskId ? <ui.TaskView key={taskId} taskId={taskId} /> : <NewModel onCreated={(x) => open(x.id)} />}
      </div>
    </div>
  )
}

/** 新建页：直接写要建的模型，发出去就是一个模型对话；Blender 找不到时先说清楚、给去设置的入口 */
function NewModel({ onCreated }: { onCreated: (task: Task) => void }) {
  const { api, ui, hooks } = h()
  const { upsertTask } = hooks.useData()
  const { openSettings } = hooks.useNav()
  const [blender, setBlender] = useState<{ ok: boolean; why: string }>()
  useEffect(() => {
    api
      .get<BlenderStatus>('/status')
      .then((s) => setBlender({ ok: !!s.path && !s.error, why: s.error }))
      .catch((e) => setBlender({ ok: false, why: (e as Error).message }))
    // api 是宿主给的同一个对象，只在打开新建页时查一次
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const created = (x: Task) => {
    upsertTask(x)
    onCreated(x)
  }
  return (
    <main className="bl:flex bl:min-w-0 bl:flex-1 bl:flex-col bl:overflow-y-auto">
      <div className="bl:mx-auto bl:flex bl:w-full bl:max-w-(--content-w) bl:flex-1 bl:flex-col bl:justify-center bl:gap-6 bl:px-4 bl:py-12 bl:md:px-6">
        <div className="bl:flex bl:flex-col bl:items-center bl:gap-3 bl:text-center">
          <span className="bl:flex bl:h-11 bl:w-11 bl:items-center bl:justify-center bl:rounded-xl bl:bg-peer bl:text-white">
            <Box className="bl:h-5 bl:w-5" />
          </span>
          <h1 className="bl:font-serif bl:text-display bl:font-semibold bl:tracking-tight bl:text-fg">
            {t('要建什么模型？')}
          </h1>
          <p className="bl:max-w-md bl:text-body bl:leading-relaxed bl:text-subtle">
            {t('写下要建的模型，Agent 会在后台开一个 Blender 建模，右边实时预览。')}
          </p>
        </div>
        {blender && !blender.ok && (
          <div className="bl:flex bl:items-start bl:gap-2.5 bl:rounded-xl bl:border bl:border-line bl:bg-card bl:px-3.5 bl:py-2.5 bl:text-footnote">
            <AlertTriangle className="bl:mt-0.5 bl:h-3.5 bl:w-3.5 bl:shrink-0 bl:text-warning" />
            <span className="bl:min-w-0 bl:flex-1 bl:text-muted">
              {t('没找到 Blender：{why}', { why: blender.why || t('还没设置路径') })}
            </span>
            <ui.Button variant="link" tone="warning" className="bl:shrink-0" onClick={() => openSettings('plugins')}>
              {t('去设置')}
            </ui.Button>
          </div>
        )}
        {ui.TaskComposer ? (
          <ui.TaskComposer standalone plugin={MODE} autoFocus onCreated={created} />
        ) : (
          <SimpleComposer onCreated={created} />
        )}
      </div>
    </main>
  )
}
