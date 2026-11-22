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
    summary: '执行控制台命令、查和改控制台变量，看项目配置的各层和 GameplayTag',
    useWhen:
      '要跑 stat、show 这类控制台命令，或者查 / 临时改 CVar 时；排查「这个配置值从哪来、哪层 ini 改的」用 action=config（先 query 搜键名）；要知道有哪些 GameplayTag、谁引用了某个 Tag 用 action=tags',
    avoidWhen: '改对象属性用 ue_set，调函数用 ue_call；quit、open 这类会请用户确认',
    confirms: true,
    group: RUN,
  },
  ue_gm: {
    title: 'GM 命令',
    summary: '列出和执行项目的 GM（C++、Lua、自定义）和宏；把常用的对象函数调用存成自定义 GM，管理对象列表',
    useWhen:
      '要用项目自带的 GM（加道具、跳关、改数值）复现或验证问题时，先 action=list 看有哪些；要反复调同一个对象上的函数，或用户说「存成 GM」时用 action=save kind=gm 存成自定义 GM（之后 run source=custom），常用对象存进对象列表用 kind=object；一串固定步骤（含等几秒）存成宏用 kind=macro；想知道用户刚在 GM 页点过什么用 list source=recent',
    avoidWhen: '只调一次对象函数用 ue_call；要写进测试场景、能回放的步骤用 ue_gametest',
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
      '查看运行时数值、资源默认值、控件层级，或 UnLua 项目里 Lua 侧的字段时；要一个对象的全部数据（含 Actor 的组件）或值太大被截断时写 file=true，再读返回的文件；多个资源读同一个属性用 paths / select 一次读',
    avoidWhen: 'DataTable 的行用 ue_asset，蓝图的图和节点用 ue_blueprint',
    group: RUN,
  },
  ue_set: {
    title: '改属性',
    summary: '改对象或资源的属性，数组 / 集合 / 映射加删元素、新建内嵌子对象，UnLua 的简单字段，可以 ue_undo 撤回',
    useWhen:
      '验证改一个数值能不能修好问题、调整资源默认值、给数组或映射加删一项、给实例化属性新建子对象（如输入触发器）时；资源的修改之后要 ue_save 才写盘；同一处修改作用到多个资源用 paths / select 一次改',
    avoidWhen:
      'Lua 里的表和函数用 ue_lua；改蓝图逻辑用 ue_blueprint；结果提醒资源由 AssetForge 配置管着时，要保留的改动改配置再 ue_forge import',
    group: RUN,
  },
  ue_lua: {
    title: 'Lua',
    summary:
      '执行 Lua、检查语法、重载模块、看 Lua 报错、调 Lua 函数，在本机跑项目配好的 Lua 增量 / 全编译；快照点、性能采样、查 Lua 持有的已销毁对象',
    useWhen:
      'UnLua 项目里改完 .lua 要验证时按 check（或 compile 跑项目配好的编译）→ reload → 触发 → errors 走一遍，按返回的 文件:行 修；要调一个 Lua 函数用 action=call；ue_get / ue_set 做不到的复杂读写才用 exec；' +
      '要看某行执行时的局部变量用 snap（不暂停游戏），Lua 卡顿粗看热点用 profile（要看哪一帧慢、从哪个 UE 回调进来，用 ue_perf kind=trace lua=true），界面关了对象释放不掉用 leaks；用户批准过的常用代码用 exec 带 snippet，不用确认',
    avoidWhen:
      '只读字段用 ue_get（functions=true 看函数），改简单字段用 ue_set（能撤回）；exec 每次都要用户确认，能用 call 就别用 exec',
    confirms: true,
    group: RUN,
  },
  ue_call: {
    title: '调函数',
    summary: '列出对象上能调的函数，按参数调用并拿到返回值；调编辑器函数库的静态函数',
    useWhen:
      '要触发游戏逻辑（BlueprintCallable、Exec 函数）来复现或验证时，先 action=list 看签名；要做属性改不了的编辑器操作（静态网格 LOD、碰撞、贴图设置这类编辑器函数）时给 class 调编辑器函数库，一批资源用 select，不用写 Python',
    group: RUN,
  },
  ue_asset: {
    title: '资源读写',
    summary: '资源的通用读写、改名移动、引用关系和 DataTable 的行',
    useWhen:
      '查资源信息和引用、改 DataTable、新建 / 改名 / 移动资源时；修改只在编辑器里，ue_save 才写盘；多个资源一起 describe / refs / 改名 / 删除用 paths、items 或 select 一次调',
    avoidWhen:
      '蓝图的图和变量用 ue_blueprint；单个属性用 ue_get / ue_set；结果提醒资源由 AssetForge 配置管着时，改 DataTable 等要保留的修改改配置再 ue_forge import，改名删除要同步改配置',
    group: ASSET,
  },
  ue_blueprint: {
    title: '蓝图',
    summary: '由粗到细读蓝图（大纲、伪代码、节点），按操作列表改图和变量',
    useWhen:
      '要看懂或修改蓝图逻辑时：先 outline，再 graph 读伪代码，改完 ue_compile；多个蓝图读大纲或做同一组修改时用 paths / select 一次调，不要逐个调',
    avoidWhen:
      '跨蓝图搜调用点用 ue_find kind=node；只改类默认值用 ue_set；结果提醒蓝图由 AssetForge 配置管着时，改完用 ue_forge export 写回配置，否则下次导入会被覆盖',
    group: ASSET,
  },
  ue_save: {
    title: '保存资源',
    summary: '先编译要保存的蓝图，全部通过才写回磁盘（P4 项目自动签出）',
    useWhen: '资源和蓝图改完、要让修改留下来时；蓝图不用先 ue_compile，ue_save 会先编译，编不过整批不存并返回错误',
    avoidWhen: '只是试验数值时别存，用 ue_undo 撤回即可',
    confirms: true,
    group: ASSET,
  },
  ue_compile: {
    title: '编译蓝图',
    summary: '编译蓝图，给出错误和警告所在的图和节点；通过的结果进完成依据',
    useWhen: '改完蓝图、还不想保存时确认编译通过；多个蓝图用 paths / select 一次编',
    avoidWhen: 'C++ 代码用面板的 request_build 编译，或 ue_editor 的 livecoding 热重载',
    group: ASSET,
  },
  ue_python: {
    title: '执行 Python',
    summary: '在编辑器里执行 Python 脚本（兜底）',
    useWhen:
      '只在这几种情况用，并先一句话说明为什么工具不行：工具没有的编辑器能力（材质图、控件树、动画状态机、Sequencer，以及编辑器函数库里也没有的操作；导入用 ue_asset import，LOD / 碰撞这类编辑器函数先 ue_call class=… list 找）；每项的值要复杂计算且没法批量读再 items 批量写；只读的全项目统计。写资源的脚本先 DRY_RUN 演练、不自己保存（面板自动包事务，ue_undo 能整次撤回），改完 ue_save（默认先编译）',
    avoidWhen:
      '改属性、DataTable、蓝图、新建复制改名删除、编译保存、运行中游戏的读改都用对应的 ue_* 工具，多少个都一样：批量一次调用，有演练、逐项结果和编译回读，Python 没有',
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
    summary: '启动编辑器并等它可用、开停 PIE、Live Coding、后台编辑器，在关卡里放和删 Actor',
    useWhen:
      '启动编辑器后（start_editor，或 ue_vs_debug / UEToVS 的 start）要等它能用时调 wait_ready，不要用 sleep 或调试器的 wait 干等；要运行游戏复现问题（pie_start）、改了 C++ 要热重载（livecoding）、编辑器没开但要读资源时；用户让你在关卡里摆测试场景、放或删某个 Actor 时用 spawn / destroy',
    avoidWhen:
      '完整编译 C++ 用面板的 request_build，结果会推回来；新建资源（蓝图、DataTable）用 ue_asset create，不是 spawn；运行中的游戏里生成对象用 ue_call / ue_gm；要写进测试场景、能回放的开停 PIE 用 ue_gametest 的 pie.start / pie.stop 步骤',
    confirms: true,
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
    useWhen:
      '用户说卡顿、掉帧、内存涨时：先 live 看一眼，再按需要录 trace / CSV / memreport；UnLua 项目的 Lua 慢也录 trace（lua=true，和 UE 作用域录在一起）',
    avoidWhen: '分析已经抓好的文件用 ue_capture',
    group: PERF,
  },
  ue_capture: {
    title: '分析抓取',
    summary: '对抓到的 trace、CSV、内存报告做摘要、下钻和两份对比',
    useWhen:
      '有了抓取文件要找热点、卡顿帧或内存泄漏时；UE 不在运行也能用。含 Lua 的 trace 用 query what=timers lua=true、what=tree luaOnly=true',
    avoidWhen: 'delete 会请用户确认，确实不要了才删',
    confirms: true,
    group: PERF,
  },
  ue_forge: {
    title: 'AssetForge 配置',
    summary: '用 JSON 配置管理 UE 资产：看同步状态、属性差异，导入写成资产、导出写回配置',
    useWhen:
      '项目装了 AssetForge、要改 UMG / 蓝图 / 数据表等资产时：写配置前先 schema kind=<kind> 看结构、schema class=<类> 看 props 能写哪些属性，改配置根（ue_forge status 看位置）下的 JSON 配置（大配置用 describe section=<段> 只读写一段；include 的片段文件顶层是 fragment，跟着主配置走），再 plan 或 diff 看会改什么，import 先 dryRun 再正式导入；用户在编辑器里改了资产要同步回配置时用 export',
    avoidWhen:
      '项目没用 AssetForge 管的资产直接用 ue_asset / ue_blueprint；只是看资产的属性用 ue_get / ue_asset export，不用 export 写配置；导入导出是后台作业，返回编号后用 action=job 查结果',
    confirms: true,
    group: ASSET,
  },
  ue_gametest: {
    title: '游戏测试',
    summary: '写、校验、跑 GameTest 测试脚本，看报告',
    useWhen:
      '验证刚改的功能或复现用户说的操作时：先 props / widgets / vars / api 查对象的属性和推荐标识、部件名、变量和接口，按技能 ue-gametest-authoring 写 v5 脚本（schemaVersion 5，对象引用 {class, in?, ident} + 部件 {obj, part}，属性路径 @/子控件.属性、@.属性、@#Lua字段、@:状态；obj.call / api 准备状态，界面操作，对象判断或表达式检查），validate 过了再 run，job / report 看结果，失败读 payload.evidence；通过的放进 regression/ 打标签，以后 run tag=… 回归。不知道用哪个属性区分同类对象时 props 看 score 和 suggest，游戏开着时 inspect 指着看；validate 报 schema_old / settings_old / path_old 时按新写法重写（旧格式不迁移）',
    avoidWhen:
      '不要让用户去录制，能从代码写就自己写；只读运行时数值用 ue_get，找 Actor 用 ue_find，只截图用 ue_screenshot，只开停 PIE 用 ue_editor，只敲一条命令用 ue_console——要写进报告、能回放时才用对应的脚本步骤；click 自带等待，不要在前面插 wait seconds；Lua 不用 ue_lua 求值绕过脚本，写成项目 Lua 接口；不要再写 v3 的选择器字符串（WBP_X:Root/Btn）和 invoke / widget.close，用引用和 obj.*；不要只改旧脚本的版本号冒充新格式，按新写法重写',
    group: RUN,
  },
  ue_vs_debug: {
    title: 'VS 调试会话',
    summary: '用 VS 自带的调试器启动、附加、停止、编译 UE，暂停、继续、单步，等它停下',
    useWhen:
      '要查 C++ 逻辑在哪一步出错、某个函数有没有被调到、参数和成员当时是什么值，或者 UE 崩溃 / check / ensure 要看现场时：没在调试就 start（要看全局部变量用 configuration=DebugGame Editor）或 attach 到已开的编辑器，下好断点后用 ue_gametest run、ue_console、PIE 触发，再 wait 等停下；改了 C++ 要复测时 stop → build（wait 看 buildErrors）→ start',
    avoidWhen:
      '只看运行时属性值用 ue_get、看报错用 ue_log，不必挂调试器；只改了已加载模块的函数体用 ue_editor livecoding，不用 stop / build；UE 停在断点时进程冻住、所有 ue_* 工具都不通，先 continue 再用它们；Lua 逻辑用 ue_lua 的 snap',
    confirms: true,
    group: DIAG,
  },
  ue_vs_breakpoints: {
    title: 'VS 断点',
    summary: '列、加、删、启停 VS 里的 C++ 断点：行、函数、条件、命中次数、日志断点、数据断点',
    useWhen:
      '要让 UE 在某行 C++ 或某个函数停下看现场时 add file+line 或 function；只想知道走没走到、值是多少又不想停下时用 message 做日志断点；要查谁改了某个值时，先停在能访问它的地方再 add data=this->成员；调试完 clear 清掉自己下的',
    avoidWhen:
      '蓝图和 Lua 的断点它管不了；clear 默认只删 Agent 下的，scope=all 会连用户自己的断点一起删，用户没要求别用',
    group: DIAG,
  },
  ue_vs_inspect: {
    title: 'VS 检视',
    summary: 'UE 停在 VS 里时看调用栈、线程、局部变量，按监视窗口求值，读调试输出，存小转储',
    useWhen:
      'ue_vs_debug wait 返回 break（断点、单步、崩溃、check / ensure）后：先 stack 看停在哪，再 locals 看参数和局部变量，需要时 eval 算表达式；崩溃或 ensure 要留证据时 dump；挂着调试器时 output 能看到 UE_LOG 和日志断点的输出',
    avoidWhen:
      '没停下时 stack / locals / eval 用不了，先 pause 或等断点；eval 能调用函数、有副作用，只读成员和无副作用的 getter，别调 Destroy、Set 这类会改状态的函数；看普通日志用 ue_log',
    group: DIAG,
  },
}

/** 能力目录和 MCP 握手里说的「这个服务做什么」 */
export const UE_SUMMARY =
  '操控用户本机的 Unreal 编辑器和运行中的游戏：读写运行时对象和属性、资源和蓝图、日志、截图、性能与内存分析；修改能撤回，写盘前会请用户确认。'
