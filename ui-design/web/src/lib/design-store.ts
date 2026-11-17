import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type SetStateAction } from 'react'
import type { DesignMeta, DesignProject } from '@shared/design'
import { api } from '@/lib/api'

/**
 * 设计列表和 UI 项目（侧栏、项目主页、新建设计共用）。原来放在面板的数据上下文（useData 的 designs / designProjects），
 * UI 设计拆成插件后面板不再管它们，插件自己存一份：模块级的存储，侧栏和整页不在同一棵组件树里也能共用。
 */
interface State {
  designs: DesignMeta[]
  designProjects: DesignProject[]
  designProjectsLoaded: boolean
}
let state: State = { designs: [], designProjects: [], designProjectsLoaded: false }
const subs = new Set<() => void>()
const emit = (next: Partial<State>) => {
  state = { ...state, ...next }
  subs.forEach((f) => f())
  watchRunning()
}
const subscribe = (f: () => void) => {
  subs.add(f)
  if (!loading) void reloadDesigns()
  return () => subs.delete(f)
}

const apply = <T>(cur: T, v: SetStateAction<T>) => (typeof v === 'function' ? (v as (x: T) => T)(cur) : v)
export const setDesigns = (v: SetStateAction<DesignMeta[]>) => emit({ designs: apply(state.designs, v) })
export const setDesignProjects = (v: SetStateAction<DesignProject[]>) =>
  emit({ designProjects: apply(state.designProjects, v) })

let loading: Promise<void> | undefined
export function reloadDesigns() {
  loading = (async () => {
    try {
      const [ps, ds] = await Promise.all([api.designProjects(), api.designs()])
      emit({ designProjects: ps, designs: ds })
    } catch {
      // 连不上时保留现有列表
    } finally {
      // 取失败也算「问过了」：否则项目主页会一直停在加载中
      if (!state.designProjectsLoaded) emit({ designProjectsLoaded: true })
    }
  })()
  return loading
}

/** 有设计在跑 AI 对话或生成图片时定期刷新列表：切到别的设计后，侧栏里那个的转圈也能在完成时停下 */
let timer: ReturnType<typeof setInterval> | undefined
function watchRunning() {
  const running = state.designs.some((d) => d.running)
  if (running && !timer)
    timer = setInterval(
      () =>
        !document.hidden &&
        void api
          .designs()
          .then((ds) =>
            // 只更新状态，名字等以页面上的为准（正在改名时不被盖掉）。
            // 转圈状态没变时不换数组，侧栏不用每 2.5 秒重渲染一次
            setDesigns((cur) => {
              let changed = false
              const next = cur.map((x) => {
                const d = ds.find((d) => d.id === x.id)
                const running = !!d?.running
                const asking = !!d?.asking
                if (x.running === running && x.asking === asking) return x
                changed = true
                return { ...x, running, asking }
              })
              return changed ? next : cur
            }),
          )
          .catch(() => {}),
      2500,
    )
  if (!running && timer) {
    clearInterval(timer)
    timer = undefined
  }
}

/**
 * 当前的面板项目（UI 设计 1.4.0 起按项目启用：整页从项目工具打开，UiDesignPage 给出）和面板现有项目的 id。
 * owner 空是不分项目（旧面板不给项目、无头截图页），所有 UI 项目都列出来。
 * 面板项目由 UiDesignPage 从 useData 取了放进来：无头截图页没有面板的数据上下文，这里不能直接调 useData
 */
export const DesignOwner = createContext<{ owner: string; panel: string[] }>({ owner: '', panel: [] })
export const useDesignOwner = () => useContext(DesignOwner).owner

/**
 * 设计列表和 UI 项目，和原来 useData() 里的字段同名。designProjects 只有当前面板项目的；
 * others 是还没归属、或归属的面板项目已经删了的 UI 项目（页面里列成「其他 UI 项目」，点一下归到当前项目）。
 * designs 不按项目筛：设计页打开别的项目的设计（旧链接）时还找得到它
 */
export function useDesignData() {
  const s = useSyncExternalStore(subscribe, () => state)
  const { owner, panel } = useContext(DesignOwner)
  // 第一次用到时取一次（subscribe 里也会取，这里兜住 StrictMode 下先退订再订阅的情况）
  useEffect(() => {
    if (!loading) void reloadDesigns()
  }, [])
  const scoped = useMemo(() => {
    if (!owner) return { designProjects: s.designProjects, others: [] as DesignProject[] }
    const known = new Set(panel)
    return {
      designProjects: s.designProjects.filter((p) => p.owner === owner),
      others: s.designProjects.filter((p) => !p.owner || !known.has(p.owner)),
    }
  }, [s.designProjects, owner, panel])
  return { ...s, ...scoped, owner, setDesigns, setDesignProjects, reloadDesigns }
}
