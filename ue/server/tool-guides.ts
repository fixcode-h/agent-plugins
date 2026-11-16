import type { ToolGuide } from '../../sdk/server.ts'

/**
 * UE 工具的作用和使用时机（面板插件接口 8）：设置 →「MCP」照它显示，面板也把「什么时候用 / 不要用」补在
 * description 后面交给 Agent。单独一个文件，工具定义（tools.ts 等）不动；useWhen 写给模型看，要能直接照做。
 */
type Guide = ToolGuide & { confirms?: boolean; irreversible?: boolean }

const RUN = '运行时对象'
const ASSET = '资源与蓝图'
const EDITOR = '编辑器与进程'
const DIAG = '日志与诊断'
const PERF = '性能与内存'

export const UE_GUIDES: Record<string, Guide> = {
  ue_status: {
    title: '项目状态',
    summary: '看引擎、桥接插件、运行中的进程和世界、当前目标和 Agent 权限',
    useWhen: '每次开始操作 UE 前先调一次，确认有没有在运行的进程、目标是哪个世界、哪些操作被权限关掉了',
    group: EDITOR,
  },
  ue_console: {
    title: '控制台命令',
    summary: '执行控制台命令、查和改控制台变量',
    useWhen: '要跑 stat、show 这类控制台命令，或者查 / 临时改 CVar 时',
    avoidWhen: '改对象属性用 ue_set，调函数用 ue_call；quit、open 这类会请用户确认',
    confirms: true,
    group: RUN,
  },
  ue_gm: {
    title: 'GM 命令',
    summary: '列出和执行项目的 GM 函数、执行存好的宏',
    useWhen: '要用项目自带的 GM（加道具、跳关、改数值）复现或验证问题时，先 action=list 看有哪些',
    group: RUN,
  },
  ue_find: {
    title: '找对象',
    summary: '按名字找 Actor、组件、UObject、绑了 Lua 的对象、资源和蓝图节点',
    useWhen: '要读写一个对象或资源但还不知道它的路径时先用它；跨蓝图找谁调了某个函数用 kind=node',
    group: RUN,
  },
  ue_get: {
    title: '读属性',
    summary: '读对象或资源的属性（一个、几个或整个对象导出成文件）、UMG 控件树、UnLua 实例表和全局表',
    useWhen:
      '查看运行时数值、资源默认值、控件层级，或 UnLua 项目里 Lua 侧的字段时；要一个对象的全部数据（含 Actor 的组件）或值太大被截断时写 file=true，再读返回的文件',
    avoidWhen: 'DataTable 的行用 ue_asset，蓝图的图和节点用 ue_blueprint',
    group: RUN,
  },
  ue_set: {
    title: '改属性',
    summary: '改对象或资源的属性、数组元素、UnLua 的简单字段，可以 ue_undo 撤回',
    useWhen: '验证改一个数值能不能修好问题、调整资源默认值时；资源的修改之后要 ue_save 才写盘',
    avoidWhen: 'Lua 里的表和函数用 ue_lua；改蓝图逻辑用 ue_blueprint',
    group: RUN,
  },
  ue_lua: {
    title: 'Lua',
    summary: '执行 Lua、检查语法、重载模块、看 Lua 报错、调 Lua 函数',
    useWhen:
      'UnLua 项目里改完 .lua 要验证时按 check → reload → 触发 → errors 走一遍；要调一个 Lua 函数用 action=call；ue_get / ue_set 做不到的复杂读写才用 exec',
    avoidWhen: '只读字段用 ue_get（functions=true 看函数），改简单字段用 ue_set（能撤回）；exec 每次都要用户确认，能用 call 就别用 exec',
    confirms: true,
    group: RUN,
  },
  ue_call: {
    title: '调函数',
    summary: '列出对象上能调的函数，按参数调用并拿到返回值',
    useWhen: '要触发游戏逻辑（BlueprintCallable、Exec 函数）来复现或验证时，先 action=list 看签名',
    group: RUN,
  },
  ue_asset: {
    title: '资源读写',
    summary: '资源的通用读写、改名移动、引用关系和 DataTable 的行',
    useWhen: '查资源信息和引用、改 DataTable、新建 / 改名 / 移动资源时；修改只在编辑器里，ue_save 才写盘',
    avoidWhen: '蓝图的图和变量用 ue_blueprint；单个属性用 ue_get / ue_set',
    group: ASSET,
  },
  ue_blueprint: {
    title: '蓝图',
    summary: '由粗到细读蓝图（大纲、伪代码、节点），按操作列表改图和变量',
    useWhen: '要看懂或修改蓝图逻辑时：先 outline，再 graph 读伪代码，改完 ue_compile',
    avoidWhen: '跨蓝图搜调用点用 ue_find kind=node；只改类默认值用 ue_set',
    group: ASSET,
  },
  ue_save: {
    title: '保存资源',
    summary: '把编辑器里改了没保存的资源写回磁盘（P4 项目自动签出）',
    useWhen: '资源和蓝图改完、蓝图 ue_compile 通过、要让修改留下来时',
    avoidWhen: '只是试验数值时别存，用 ue_undo 撤回即可',
    confirms: true,
    group: ASSET,
  },
  ue_compile: {
    title: '编译蓝图',
    summary: '编译蓝图，给出错误和警告所在的图和节点；通过的结果进完成依据',
    useWhen: '改完蓝图、保存之前，确认编译通过时',
    avoidWhen: 'C++ 代码用面板的 request_build 编译，或 ue_editor 的 livecoding 热重载',
    group: ASSET,
  },
  ue_python: {
    title: '执行 Python',
    summary: '在编辑器里执行 Python 脚本（兜底）',
    useWhen: '只在别的 ue_* 工具都做不到的编辑器操作时用，要用户在 UE 页打开',
    avoidWhen: '能用 ue_asset、ue_blueprint、ue_get / ue_set 做的都别用它：那些有事务、撤回和编译回读',
    confirms: true,
    group: ASSET,
  },
  ue_log: {
    title: '日志',
    summary: '取 UE 日志的新行、列出崩溃记录、清空日志',
    useWhen: '复现问题前后看报错和警告、排查崩溃时；用上次的 cursor 只取新行',
    avoidWhen: 'clear 清空收不回，确实需要时才用并加 backup=true',
    irreversible: true,
    group: DIAG,
  },
  ue_screenshot: {
    title: '截图',
    summary: '截目标视口（PIE、游戏窗口或编辑器视口）',
    useWhen: '要确认画面、UI 表现，或者给用户看改动效果时',
    group: DIAG,
  },
  ue_editor: {
    title: '编辑器控制',
    summary: '启动编辑器、开停 PIE、Live Coding、后台编辑器',
    useWhen: '要运行游戏复现问题（pie_start）、改了 C++ 要热重载（livecoding）、编辑器没开但要读资源时',
    avoidWhen: '完整编译 C++ 用面板的 request_build，结果会推回来',
    group: EDITOR,
  },
  ue_undo: {
    title: '撤回修改',
    summary: '列出本对话做过的修改，按顺序撤回运行时修改和没保存的资源修改',
    useWhen: '试验性的修改要还原、改错了要回退时；不写 id 先看记录',
    group: EDITOR,
  },
  ue_perf: {
    title: '性能抓取',
    summary: '看实时帧耗时，录 Insights trace、CSV Profiler，抓内存报告',
    useWhen: '用户说卡顿、掉帧、内存涨时：先 live 看一眼，再按需要录 trace / CSV / memreport',
    avoidWhen: '分析已经抓好的文件用 ue_capture',
    group: PERF,
  },
  ue_capture: {
    title: '分析抓取',
    summary: '对抓到的 trace、CSV、内存报告做摘要、下钻和两份对比',
    useWhen: '有了抓取文件要找热点、卡顿帧或内存泄漏时；UE 不在运行也能用',
    avoidWhen: 'delete 会请用户确认，确实不要了才删',
    confirms: true,
    group: PERF,
  },
  ue_forge: {
    title: 'AssetForge 配置',
    summary: '用 JSON 配置管理 UE 资产：看同步状态、属性差异，导入写成资产、导出写回配置',
    useWhen:
      '项目装了 AssetForge、要改 UMG / 蓝图 / 数据表等资产时：改配置根（ue_forge status 看位置）下的 JSON 配置，再 plan 或 diff 看会改什么，import 先 dryRun 再正式导入；用户在编辑器里改了资产要同步回配置时用 export',
    avoidWhen:
      '项目没用 AssetForge 管的资产直接用 ue_asset / ue_blueprint；导入导出是后台作业，返回编号后用 action=job 查结果',
    confirms: true,
    group: ASSET,
  },
  ue_gametest: {
    title: '游戏测试',
    summary: '在 PIE 里跑 GameTest 场景、单步执行测试动作、看报告',
    useWhen:
      '要验证 UI 流程或玩法能不能走通、复现用户说的操作步骤时：先 actions 看有哪些动作，step 一步步探路，确认后写成场景文件（放在 status 返回的场景根下）用 run 跑，job / report 看结果；不知道某个控件的选择器怎么写时用 inspect 指着它看',
    avoidWhen:
      '只读运行时数值用 ue_get；只截一张图用 ue_screenshot；录制要用户在游戏窗口里操作，在 UE 页 GameTest 里点「录制」；click 已经自带等待，不要在前面插 wait seconds',
    group: RUN,
  },
}

/** 能力目录和 MCP 握手里说的「这个服务做什么」 */
export const UE_SUMMARY =
  '操控用户本机的 Unreal 编辑器和运行中的游戏：读写运行时对象和属性、资源和蓝图、日志、截图、性能与内存分析；修改能撤回，写盘前会请用户确认。'
