import path from 'node:path'
import { ueDocFile } from '../doc-root.ts'
import type { UeProject } from '../types.ts'
import { readJson } from '../util.ts'

/**
 * 卡顿「元凶」分类（「UE 性能分析 MCP 接口」设计稿 4.5）：按计时器名字的正则归类，先对上的为准。
 * diagnose 和 hitches 用它把一堆卡顿帧归成「垃圾回收 3 次、同步加载 2 次」，Agent 不用自己一个个认名字。
 * 项目可以在文档根的 AgentPanel/UE/perf-culprits.json（{ "rules": [{ name, match, hint }] }）加自己的规则，排在内置的前面。
 */
export interface Culprit {
  name: string
  /** 正则（不分大小写） */
  match: string
  /** 一句「下一步怎么查 / 怎么改」 */
  hint: string
}

export const BUILTIN_CULPRITS: Culprit[] = [
  {
    name: '垃圾回收',
    match: 'CollectGarbage|IncrementalPurgeGarbage|GC Mark|GarbageCollect|ConditionalBeginDestroy|lua_gc|LuaGC|GC step',
    hint: 'GC 停顿：看是哪类对象多（memtags、ue_capture 的 memreport objects），减少每帧新建 UObject，或调 gc.TimeBetweenPurgingPendingKillObjects / 增量清理',
  },
  {
    name: '同步加载',
    match: 'FlushAsyncLoading|LoadPackage|StaticLoadObject|LoadObject|SyncLoad|LoadSynchronous|StaticFindObject',
    hint: '游戏线程上同步加载：what=loads 看是哪些包，改成异步加载或提前预载',
  },
  {
    name: '着色器/PSO',
    match: 'FShaderCompilingManager|ShaderCompil|PSO|PipelineState|CreateGraphicsPipelineState|PrecachePSO',
    hint: '首次用到的材质在编译着色器或建 PSO：开 PSO 预缓存（r.PSOPrecaching）或打包 PSO 缓存',
  },
  {
    name: '关卡流送',
    match: 'LevelStreaming|AddToWorld|RemoveFromWorld|UpdateLevelStreaming|WorldPartition|ProcessLevelStreaming',
    hint: '关卡流送在游戏线程上花时间：看 AddToWorld 的子项（Actor 初始化、组件注册），调 s.LevelStreamingComponentsRegistrationGranularity 等分帧参数',
  },
  {
    name: 'Actor 生成',
    match: 'SpawnActor|PostActorConstruction|BeginPlay|RegisterComponent|ExecuteConstruction|UserConstructionScript',
    hint: '同一帧生成太多 Actor 或构造脚本太重：分帧生成、用对象池',
  },
  {
    name: '物理',
    match: 'Phys|Chaos|Collision|Overlap|Sweep|Raycast|LineTrace',
    hint: '物理或碰撞查询：看是哪个 Actor 的查询多，减少每帧的 Overlap / Trace',
  },
  {
    name: '动画',
    match: 'Anim|Skeletal|Skinning|BlendSpace|Montage|RefreshBoneTransforms',
    hint: '动画更新：看可见的骨骼网格数量，开 URO（更新频率优化）、减少不可见时的 Tick',
  },
  {
    name: 'UI',
    match: 'Slate|UMG|Widget|SlatePrepass|DrawWindow|WBP_|Invalidation',
    hint: '界面：看是哪个控件，减少每帧绑定（Binding）、开失效缓存（Invalidation Box）、少用 Tick',
  },
  {
    name: '导航',
    match: 'NavMesh|Navigation|Recast|FindPath|PathFollowing',
    hint: '寻路或导航网格重建：限制每帧寻路次数、动态导航网格改成按需重建',
  },
  {
    name: 'Lua',
    match: '\\.lua|^lua\\.|UnLua|LuaCall|Lua\\b',
    hint: 'Lua 脚本：what=timers lua=true 和 what=tree luaOnly=true 定位到 文件:行',
  },
  {
    name: '渲染提交',
    match: 'InitViews|BasePass|Lighting|ShadowDepths|Translucency|PostProcess|RenderThread|RHI|DrawIndexed|Submit',
    hint: '渲染：看 Draw Call（counters RHI/DrawCalls）、可见图元数量，或用 gpu 预设录 RHI 命令',
  },
  {
    name: '网络',
    match: 'NetDriver|NetBroadcastTick|ReplicateActors|ServerReplicateActors|ProcessRemoteFunction|ReceivedPacket',
    hint: '网络复制：what=net 看哪条连接流量大，减少复制属性、降复制频率',
  },
  {
    name: '任务等待',
    match: 'WaitForTasks|WaitUntilTasksComplete|ProcessThreadUntilIdle|Wait for|FEvent::Wait|Stall',
    hint: '线程在等别的线程或任务：what=tasks sort=wait 看等的是谁，what=switches 看是不是被抢占',
  },
]

interface Compiled extends Culprit {
  re: RegExp
}

const compile = (list: Culprit[]): Compiled[] =>
  list.flatMap((x) => {
    try {
      return [{ ...x, re: new RegExp(x.match, 'i') }]
    } catch {
      // 项目里写错的正则跳过，不让整个诊断失败
      return []
    }
  })

const builtin = compile(BUILTIN_CULPRITS)

export async function culpritRules(p: Pick<UeProject, 'id' | 'root'>): Promise<Compiled[]> {
  const file = ueDocFile(p, 'perf-culprits.json').read
  const own = await readJson<{ rules?: Culprit[] }>(file, {})
  const rules = Array.isArray(own.rules)
    ? own.rules.filter((x) => x && typeof x.name === 'string' && typeof x.match === 'string')
    : []
  return [...compile(rules.map((x) => ({ ...x, hint: x.hint ?? '' }))), ...builtin]
}

/** 一个计时器名字归哪类；都不像时返回 undefined（diagnose 里归「其他」，直接给计时器名） */
export function culpritOf(rules: Compiled[], name: string) {
  return rules.find((r) => r.re.test(name))
}
