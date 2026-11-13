import type { McpTool, ToolGuide } from '../../sdk/server.ts'

/**
 * Blender 工具的作用和使用时机（面板插件接口 8）：设置 →「MCP」照它显示，面板也把「什么时候用 / 不要用」补在
 * description 后面交给 Agent。只是说明，不改工具的 effect（标 edit 会让只读角色被面板守卫挡住）。上游 dsh 的工具定义不改（blender/dsh 是副本），说明在这里按工具名配上。
 */
type Guide = ToolGuide & Pick<McpTool, 'confirms' | 'irreversible'>

const GUI = '驱动 Blender'
const MODEL = '模型设计'

export const BLENDER_GUIDES: Record<string, Guide> = {
  blender_session: {
    title: '会话与权限',
    summary: '看 GUI 会话状态、附着到用户开着的 Blender、授权子 Agent、打快照和回滚',
    useWhen: '开始干活前先 action=doctor（kind=ok 才算就绪）；写操作前用 txn 打快照，改坏了 restore',
    avoidWhen: 'pause / resume 只有用户能做，不要尝试',
    group: GUI,
  },
  blender_op: {
    title: '算子',
    summary: '按目录执行建模算子，做参数搜索、精简对象、套用配方',
    useWhen: '常见建模操作有现成算子时优先用它，先 op=catalog 看目录，拿不准用 dry_run',
    avoidWhen: '目录里没有的操作再用 blender_py',
    group: GUI,
  },
  blender_py: {
    title: '执行 Python',
    summary: '在用户的 Blender 里跑一段 Python，默认顺手抓一帧视口',
    useWhen: '改场景、算子做不到的操作，脚本要在 1 秒左右跑完',
    avoidWhen: '更久的重活、批量处理用 blender_run kind=headless；只读查询用 blender_inspect',
    group: GUI,
  },
  blender_see: {
    title: '看画面',
    summary: '抓 GUI 会话的视口、相机或自定义机位的画面，单帧或序列',
    useWhen: '改完要看效果、确认摆位和材质时',
    avoidWhen: '最终渲染用 blender_run kind=render',
    group: GUI,
  },
  blender_run: {
    title: '作业与渲染',
    summary: '提交无头脚本和最终渲染作业，查状态、等结果、取产物',
    useWhen: '重活、批量处理、最终出图时：submit 拿 jobId，再 wait / collect',
    avoidWhen: '快速的小改动用 blender_py，看一眼画面用 blender_see',
    group: GUI,
  },
  blender_inspect: {
    title: '只读检查',
    summary: '列出并执行扩展提供的只读查询命令',
    useWhen: '要查场景、对象、扩展状态又不想改东西时，先 action=help',
    avoidWhen: '写操作走 blender_py / blender_op / blender_run / blender_session',
    group: GUI,
  },
  blender_python: {
    title: '执行 bpy',
    summary: '在这个模型对话自己的后台 Blender 里执行 bpy，执行完自动存档并刷新网页预览',
    useWhen: '模型设计对话里搭模型、加细节和材质时，大模型分几步做',
    group: MODEL,
  },
  blender_scene: {
    title: '看场景',
    summary: '列出模型场景里的物体：类型、位置、尺寸、面数、材质和修改器',
    useWhen: '动手前了解现在的场景、改完核对结果时',
    group: MODEL,
  },
}

/** 给工具配上说明（找不到的照原样） */
export function withGuide<T extends { name: string }>(x: T): T {
  const g = BLENDER_GUIDES[x.name]
  if (!g) return x
  const { confirms, irreversible, ...guide } = g
  return {
    ...x,
    guide,
    ...(confirms && { confirms }),
    ...(irreversible && { irreversible }),
  }
}

export const DSH_SUMMARY =
  '驱动用户自己开着的 Blender（装了 DSH Blender Bridge 扩展）、虚拟 GUI 和无头作业：执行 Python 和算子、看画面、渲染，写操作前能打快照回滚。'
export const MODEL_SUMMARY = '模型设计对话专用：每个对话一个后台 Blender，执行 bpy 建模，网页右栏实时预览。'
