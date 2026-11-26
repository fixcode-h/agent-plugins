# UE 插件

按项目连接正在运行的 Unreal Engine（5.4 及以上）。网页上有「UE」管理页，对话里的 Agent 有 24 个 `ue_*` 工具。

## 组成

- **面板插件**（`server/`、`web/`）：
  - 图标栏里的 UE 管理页。概览一屏看清要处理什么（崩溃交给 Agent 诊断、没保存的资源、可撤回的修改、失败的测试、可升级的插件）和最近发生的事；双击 Shift 或 Ctrl+K 打开跳转，GM、控制台收藏打字就筛。分区有概览、控制台、GM、Lua（UnLua 项目）、对象（大纲、UObject 树、按类搜，点属性里的引用在同一页往下看）、资源 / DataTable（文件夹树和搜索）、监视、性能、日志、操作记录、UE 插件（UELink 和 UEKit 扩展的安装、升级、编译）、权限与设置。
  - GM 页把项目的 C++ GM 和 Lua GM 放在一起：引擎自带的调试命令默认不显示，同名分组合并，按名字、说明、参数搜；有收藏（连参数）、最近执行、宏（可以混 C++、Lua 和控制台命令）。Lua GM 由项目里的扫描脚本列出（第一次让 AI 读 GM 文件写成脚本，存在项目文档根的 `AgentPanel/UE/lua-gm-scan.mjs`，和资源页收藏同一个位置；文档根和面板「文档」角色同一个，P4 / SVN 项目是各分支共用的那份 ProjectDoc/docs，写一次各分支直接复用），GM 文件变了自动重扫；参数能关联表格的列，装了表格插件时下拉里按 Id 或名字搜。
  - 添加项目的弹窗。
  - 对话右栏的「UE」页签。
  - `.uasset` 的查看窗口（面板 SDK 的 `fileViewers`，`web/AssetFile.tsx`）：对话里的文件标记、文件浏览页点 `.uasset` 时弹出，DataTable 显示成表格，DataAsset 等显示属性，蓝图多一页大纲和图表伪代码，都有「摘要与引用」；只看不改，底栏可以跳到资源分区去改。旧面板没有这个扩展点，照旧交给系统打开。
  - Agent 工具。
- **UE 端插件 UELink**（`bridge/UELink/`，C++，UEKit 插件库 [fixcode-h/UEKit](https://github.com/fixcode-h/UEKit) 里 UELink 发布版的副本，见 `bridge/VENDORED.md`）。安装时和插件库里 UELink 的最新正式版取高的，复制到 `<项目>/Plugins/UELink/`，并清掉旧的 `AgentPanelBridge`、`UEToVSLink`；更新源可在插件参数「UELink 更新源」里换成内网镜像或本机目录。
  - 进程里起一个只听 127.0.0.1 的 HTTP 服务，名片写在 `Saved/AgentPanel/instances/<PID>.json`。
  - 运行时模块负责控制台、GM、反射读写、日志和截图。
  - 编辑器模块负责资源读写和保存、蓝图图表读写和编译、PIE 和 Live Coding。
  - 后台编辑器用 `-run=AgentPanel`：闲置后自己退出。编辑器没开时读资源结构（属性、蓝图、数据表、版本差异、评审文本）不再起它，改用自写的读取器直接读文件（只读，`docs/uasset-offline-reader.md`）；改资源仍要开编辑器。
  - Shipping 包里没有桥接。

## UnLua 项目

UnLua 由项目自己带，面板不安装。桥接编译时检测 `<项目>/Plugins` 里的 UnLua（`.uproject` 里关掉了就当没有），有就编进 Lua 支持，没有时这部分代码不编译。

- Object 页可以只看绑了 Lua 模块的对象、按模块名搜；属性面板多一个「Lua」页签看和改实例表的字段。
- 「Lua」页：执行 Lua 代码（`self` 可以是某个对象的实例表），按路径看全局表里纯 Lua 的单例和管理器。
- 「Lua」页「编译」页签：页头的「增量编译」「全编译」各绑一个项目工具（面板 `/createtool` 做的，存在 `文档根/AgentPanel/Tools/`），在编译页左边的「编译工具」里选，不再单独配命令行；命令、工作目录、报错格式（工具的 `output.errorPattern`，命名分组 file、line、msg；没写按 `文件:行: 说明` 认）、会改的文件都在工具里。增量编译把改过的文件经工具参数交过去：`filelist` 是每行一个文件的列表文件，`files` 是空格隔开的文件（都相对脚本目录）。选了哪个工具和脚本目录存在项目文档根的 `AgentPanel/UE/lua-build.json`，团队共用；编完重载和打开报错的编辑器只存本机（「权限与设置 → Lua 编译」）。以前配过的两条命令行不再执行，编译页会带着它们提示用 `/createtool` 做成工具。编译在面板本机起进程、不经过 UE，输出实时推到页面，报错认成 文件:行，点了用设置的编辑器打开到那一行，能交给 Agent 修。改过的文件按「上次编译成功」以来的修改时间找，P4 项目再加上签出的。
- Agent：`ue_find kind=lua`、`ue_get` / `ue_set` 的 `lua` 参数、`ue_lua`（执行代码，不管权限设成什么都先请用户确认，卡上可选「本对话不再询问」；`action=compile mode=incremental|full` 只跑编译页给两个按钮选好的项目工具，不用确认，超过 20 秒先回 job）。
- 读写只用 Lua 的 C 接口：UnLua 注册表里「UObject 指针 → 实例表」的对象表名字对不上时，扫注册表认出来；会触发元方法的读写都在 `lua_pcall` 里。
- 只有「拿到 lua_State」和 UnLua 版本有关：UELink 的 `UELinkCore.Build.cs` 扫 UnLua 头文件里有 `GetEnv(UObject*)`、`GetEnv()` 还是 `UnLua::GetState()`。改过的分支这几个都没有时，在项目模块里调 `FAgentPanelLua::SetStateProvider` 提供。

设计见面板仓库的 UE 插件设计文档，面板侧的扩展点是插件接口 2（ADR 0059）。

## 性能和内存分析

抓取和分析分开：`ue_perf` 对着正在运行的 UE 抓，`ue_capture` 分析抓到的文件，UE 关了也能分析。网页「性能」分区是同一套功能。

- 现在能抓两种：CSV Profiler 的帧数据（`CsvProfile Start / Stop`）和内存报告（`memreport -full`）。都走已有的控制台通道，桥接不用更新。
- 文件由引擎写在 `<项目>/Saved/Profiling/` 下，面板不搬动；手动在 UE 里抓的、别人发来的（`ue_capture action=import`）也能分析。
- 网页上录制不限时长，点停止才停。Agent 发起时不给 `seconds` 默认 30 秒自动停（忘了停文件会一直涨），`seconds=0` 也是不限时长；有上限的抓取在面板重启后下次看状态时补停。
- 分析结果先摘要再下钻，不把整份文件给 Agent：帧数据看关键指标、卡顿帧和当时涨得最多的列、按书签分段；内存报告看按类的对象表和各分段；两份同类的可以对比（查内存泄漏用两份内存报告）。
- Agent 的权限：看和分析不用确认；发起抓取按「运行时」权限，询问时一次抓取确认一次；删除抓取文件每次确认。
- 网页上每份抓取有「让 Agent 分析」，把抓取交给对话。
- 实时读数（桥接 1.3.0 起）：桥接每帧记一条和 `stat unit` 同源的数（Frame / Game / Draw / RHI / GPU、Draw Calls、图元、已用内存、UObject 数），配色阈值取引擎的 `t.TargetFrameTimeThreshold`、`t.UnacceptableFrameTimeThreshold`。网页「性能」页一打开就有读数条、最近 300 帧的帧条和 60 秒线程曲线，「内存」看 10 分钟的内存曲线；Agent 用 `ue_perf action=live` 取最近几秒的摘要。只在有人看时采，最后一次取数 10 秒后自动停。
- trace（桥接 1.5.0 起，性能页设计二期、三期）：网页「录制」或 `ue_perf action=start kind=trace preset=…` 让 UE 执行 `Trace.File`，写到 `Saved/Profiling/AgentPanel/<名字>.utrace`；预设有标准（`cpu,gpu,frame,bookmark,counters,log`）、标准 + 命名事件（同时开 `stat namedevents`，看得到蓝图函数名）、加载、内存标签（要 `-llm` 启动），以及自定义（勾选 cpu、gpu、frame、task、region、loadtime、file、net、memory 等通道，可同时开命名事件；Agent 用 `preset=custom channels=… named=true`）。停止后由编辑器（没开时后台编辑器）里的 `trace.query` 用 UE 自己的 TraceServices 分析，和 Unreal Insights 同一套代码。
- trace 详情页照 Timing Insights 布局：帧条（fps 刻度，拖选分析范围）、时间轴（滚轮缩放、拖动平移、刻度条上拖选范围、双击块设为范围、点块看调用堆栈，悬浮提示有占父 / 占根、包含 / 独占时间、深度）、计时器表（按 GPU / CPU 分组，次数 / 包含 / 独占都按分析范围统计）、调用者 / 被调用者上下两棵树（次数、包含、占父、占根、独占）、计时器的每次调用（最短 / 平均 / 中位 / 最长、最慢的 50 次可跳过去）、计数器、日志；各处都有右键菜单。可以在 Unreal Insights 里打开原文件。Agent 用 `ue_capture action=summary` / `query what=timers|butterfly|instances|stack|frames|log|counters` 查同样的数据，结果限行数。
- 桥接 1.4.x 录停在半帧的 trace，最后一帧的结束时间是无穷大，写成 JSON 是 `inf`，面板解析不了，帧条一直显示加载；1.5.0 起换成 trace 结尾，网页也会把读不到帧的错误显示出来。
- trace 是录完再分析（停止后几秒到几十秒出结果），录制中看的是实时读数；边录边分析要等在真实引擎上验证过 TraceServices 的实时会话再做。分析服务的 C++ 还没在真实引擎上编译过。
- 解析器按 UE 5.4 的文件格式写，测试数据是手写的样例（`scripts/perf-fixtures.mjs`），还没用真实项目的文件验证过。`node ue/scripts/perf-test.mjs` 跑解析器测试。

## 通过 VS 调试 UE

UEToVS（VS 扩展）0.8.0 起在 VS 进程里开一条调试控制管道，用 VS 自带的调试器启停、下断点、单步、读变量（协议见 UEToVS 仓库 `docs/design/VS-调试控制.md`）。面板这一侧在 `server/vs-debug/`：

- **发现**：在项目目录、外层目录和引擎根目录（和读 UEToVS 索引同一组候选目录，`search-index/uetovs.ts` 的 `solutionDirs`）找 `.vs/UEToVS/Debug/endpoint.json`，写着这个 `.uproject` 的优先；管道 `\\.\pipe\<pipe>`，一行一个 JSON，带文件里的令牌。连接超时 2 秒，`wait` / `step` 这类会阻塞的按等待时间再加 5 秒。连不上、文件不在、协议版本不对都给中文原因和办法（开 VS、装 UEToVS 0.8.0、打开设置「允许 Agent 通过 VS 调试 UE」），不重试。只支持 Windows。
- **用 VS 打开这个项目**：VS 没开时用 vswhere 找 devenv，`devenv <sln>` 分离启动，按退避间隔检查发现文件和管道，最多等 3 分钟，连通后卡片随状态刷新自动连上。网页按钮和 Agent 的 start / attach / build 共用。
  - 写了 PID 而进程已经不在的发现文件（VS 关了或崩了没删）当作没有；外层目录里别的项目的 VS（项目和解决方案都对不上）不拿来调试这个项目。
  - UEToVS 0.9.5 起每个 VS 另写一份 `%LOCALAPPDATA%\UEToVS\Debug\instances\<PID>.json`（`server/vs-debug/instances.ts` 读）：有 VS 开着别的项目时，卡片弹窗让用户选在那个 VS 里打开（管道操作 `solution.open`，VS 先关当前解决方案、照常弹保存提示）还是新开一个 VS（`open-vs` 的 `into` 是那个 VS 的 PID）。
  - 旧版 UEToVS 或设置关了调试控制的 VS 没有这份文件，从 `tasklist /v` 的 devenv 窗口标题（「<解决方案名> - Microsoft Visual Studio」，缓存 5 秒）认出「VS 开着这个项目但没调试控制」（`reason: no-control`）：卡片只提示去开设置，不再开第二个 VS。
- **状态**：`GET state` 的 `vsDebug`（status 带 5 帧栈 + 前 50 个断点），整体 1.5 秒拿不到就是 `available=false`，不拖慢刷新；没有 `.sln` 时不带。
- **网页接口**：`POST vs-debug` `{op, args}` → `{result}` / `{error}`（原样转发，协议外的 op 拒绝）；`POST vs-debug/open-vs` `{into?}` → `{ok, opened}` / `{error}`。
- **Agent 工具**：`ue_vs_debug`（会话：status、start、stop、restart、attach、build、pause、continue、step、wait；stop / restart 会结束 UE，先请用户确认）、`ue_vs_breakpoints`（list、add、remove、enable、clear）、`ue_vs_inspect`（stack、threads、locals、eval、output、dump）。用法写在 `ue-runtime-debug` 技能的「用 VS 断点调试」。
- **停在断点**：UE 停在 VS 里时进程冻住，UELink 调不通。`ue_*` 工具超时 / 连不上、网页判断「忙」时，如果 VS 处于 break，说明换成「UE 停在 VS 断点 文件:行（函数），先 ue_vs_debug continue 继续」。
- 单测：`node --test ue/server/vs-debug/vs-debug.test.ts ue/server/vs-debug/open-vs.test.ts`（假服务端用 unix socket 代替命名管道）。还没在真实的 VS + UEToVS 0.8.0 上联调过。

## 写 UE C++：引擎 API 先查后写

凭记忆写引擎 API（函数名、参数、头文件、模块、5.4 和 5.8 的差异）是写 UE C++ 最常见的返工，每猜错一次就是一整轮编译。

- **引擎事实**（`server/engine-facts.ts`）：C++ 项目的新会话开头，用法说明后面接一节「UE C++ 引擎」：项目用的引擎版本和来源、`Engine/Source` 和 `Engine/Plugins` 的路径、本机装的其他引擎（兼容几个版本时每个都查）。登记时存的引擎目录没了会重新找；找不到或引擎里没装源码时说清楚请用户指定目录或贴声明。本机引擎列表 10 分钟内的新会话复用，设置 →「MCP」的自检不读。
- **技能 `ue-cpp-engine-api`**：什么时候必须先查、怎么查（UEToVS 的 `get_members`、`search_symbols scope=all`、`go_to_definition`、`suggest_include`、`get_module_info`，没有就 `rg` 引擎源码的限定目录）、兼容几个引擎版本时差异只写在 `<插件>Compat.h`、编译报错的对照表。
- **编译报错**：面板在编译失败的结果里认出 C2039 / C3861 / C2065 / C2660 / C2664 / LNK2019 / LNK2001（和 clang 的同类）时列出符号、提醒先查定义（面板 `shared/compile/hints.ts`），UE 编译只给日志路径时也带。
- 单测：`node --test ue/server/engine-facts.test.ts`。

## 只认 Agent 模式里的项目

- 「添加 UE 项目」只列面板里已经添加的项目。
- 只有接入了的项目里的 Agent 对话会挂工具。聊天和设计模式的对话不挂。

## 资源和蓝图

设计和实现进度见 [docs/asset-blueprint-design.md](docs/asset-blueprint-design.md)。

- **地址**：`/Game/BP_Hero` 在 `ue_get` / `ue_set` 里是类默认值，在 `ue_blueprint` / `ue_asset` 里是蓝图资源本身。
- **看**：`ue_asset` 的 `describe`（摘要）、`export`（整份属性和内嵌子对象）、`refs`（它用了谁、谁用了它）、`validate`。
- **蓝图由粗到细读**：`ue_blueprint outline`（变量、组件、各张图、编译状态）→ `graph`（一张图的伪代码，行尾带节点 id；`format=json` 给节点和连线）→ `graph node=<id>`（一个节点的全部引脚）。`ue_find kind=node` 跨蓝图搜节点。
- **改蓝图**：`ue_blueprint edit` 接受操作列表（变量、函数、接口、父类、组件、节点和连线），整批在一个编辑器事务里，任一步失败整批取消；`dryRun=true` 演练后取消。改完自动编译，返回错误和对应的节点 id、受影响的子类和调用方。要放的节点用 `node_search` 查，候选项和编辑器右键菜单同一个来源。
- **结构性操作**：`ue_asset` 的 `create`、`duplicate`、`rename`（也用来移动）、`delete`。删除先查引用，有引用方时拒绝并列出。
- **撤回**：蓝图操作列表和 DataTable 改单元格进编辑器的撤销栈，编辑器里能 Ctrl+Z，Agent 用 `ue_undo`；要从最近一步按顺序撤。
- **权限**（UE 页「权限与设置」）：新接入的项目默认全都放开不问：改内容和保存跟随「资源」，默认「直接保存」；新建、复制、改名、移动和删除是「结构性操作」，默认「允许，不用问我」；`ue_python` 有「不允许 / 允许，每次问我 / 允许，不用问我」三档，默认不问。已有项目保留原来存的设置（老数据里开着的 Python 按「每次问我」）。执行 Lua 不管权限怎么设都每次确认。保存时 P4 项目先签出、新文件 `add`、删除的 `delete`，都进默认变更列表不提交。
- **多个对话**：另一个对话改过、还没保存的资源，后来的对话改它时直接报错。
- **文件夹树**（资源页「文件夹」页签，`assets.children`）：根是 Content（/Game）、Plugins（项目插件，一个插件一个挂载点）、Engine（默认收起），点开文件夹才读这一层（子文件夹 + 资源），读过的切页回来不重读；顶上的搜索框搜整个项目（2026-11-19 起原来单独的「搜索」页签合进来：打字时用跳转弹窗那份本地索引——有 UEToVS 的索引读它，没有面板自己扫磁盘，第一次搜时才取——搜资源名、文件夹名、/Game 路径或磁盘路径，命中的按目录摆成树，最多 300 个，清空回到文件夹树；选了索引认不出的类型时改问 UE 的资源注册表，按名字开头搜）、按类型只列某类资源，文件夹可以收藏（悬停点行尾星标或右键，树上面的「收藏」区点一下定位、拖动排序；存在项目文档根的 `AgentPanel/UE/favorites.json`，团队共用；以前存在面板数据目录、或设置里选过存项目 `.agent-panel/ue/` 的，读项目时搬过来），资源右键能在 UE 编辑器打开（经 `asset.open`，只有开着的编辑器能开，后台编辑器不行）。有 UE 进程且 UELink 支持（2.3.0 起，看 `/info` 的 `ops`）时问资源注册表，否则服务端直接扫磁盘上的 `Content/`、`Plugins/**/<插件>/Content/`（类型只认得出 `.umap` = World），**不为它启动后台编辑器**；游戏进程（-game）的资源注册表不会启动时扫全盘，只认得加载过的包，问它时并上磁盘列到的，免得文件夹展开是空的；展开文件夹时先显示读过的、同时重读一次，页头「刷新」重读展开着的层。一层最多列 500 个，再多用搜索框。界面用的，不做成 Agent 工具。磁盘兜底的单测：`node --test ue/server/asset-folders.test.ts`。
- **网页**：资源页选中蓝图后有「蓝图」页（大纲和伪代码，点节点 id 看引脚），所有资源都有「摘要与引用」页。网页上不改图，只提供编译。
- **保存和编译是单独的工具**（0.7.0 起，面板插件接口 3 的工具作用声明）：`ue_save` 标成「改文件」，执行前过面板的工具前守卫（只读角色、Bug 先诊断这些），写回的文件算进这一轮的改动；`ue_compile` 标成「验证」，编译通过的蓝图算进完成依据，没通过时对话不能结束。其余 `ue_*` 只读或只改内存 / 运行时，不标，免得只读角色连资源都读不了。`ue_asset` 删除磁盘上的资源还没报给面板。
- **蓝图编译的兜底**（0.34.0 起，面板插件接口 3 / 13，要面板支持插件接口 13）：
  - 先编译后保存（0.39.14 起，取代原来的钩子「保存蓝图后自动编译」）：`ue_save` 默认先把要保存的蓝图一起编译一遍（UELink 2.14 起批量 `bp.compile`，更旧的逐个编），全部通过才签出、写盘，有没编过的整批不保存，把错误交给 Agent 修。保存就会让 P4 签出进变更列表，编不过的版本不能先写盘再修。不是蓝图的包不算失败；`compile=false` 跳过编译，只在用户明确要求时用。`ue_python` 存了什么插件看不到，不在这里管。
  - 测试步骤「蓝图编译」：只在项目根有 `.uproject` 的项目里出现，改了 `.uasset` 时适用。命令是 `node "{dir}/bin/bp-compile.mjs" --data "{data}"`：按项目找引擎（UE 页登记的引擎目录优先，再按 EngineAssociation），用 `UnrealEditor-Cmd -run=CompileAllBlueprints` 编译全部蓝图，退出码非 0 算没通过，完整输出在项目的 `Saved/AgentPanel/bp-compile.log`。要几分钟，所以用 `ue_compile` 逐个确认过的蓝图不再要求它（完成依据按文件算）。项目设置里能按项目关掉。
- **评审看 `.uasset` 改了什么**（面板的插件文本化接口 `textify`，桥接 1.7.0 起）：面板把改动前后两版的字节交过来，插件写成项目 `Saved/AgentPanel/textify/` 下的临时文件，桥接的 `asset.textify` 给临时目录挂一个独立挂载点加载、导出文本后卸载：蓝图是父类、接口、变量、组件树、类默认值和组件模板、每张图的伪代码，其他资源是属性和内嵌子对象（数据表、曲线表另给行）。子对象按路径排序、临时包名换回原包名、跳过 Transient 属性，同一内容转出同样的文本。编辑器没开时用自写的读取器直接读这一版（`server/uasset/offline/textify-ops.ts`），读不了再交给 UE；桥接旧、加载失败都报错，评审里原样看到。只认 `.uasset`，`.umap` 不转。
- **`ue_python`**：代码写成临时文件，用控制台的 `py` 命令执行，项目要启用引擎的 Python Editor Script Plugin。桥接不依赖 Python 模块。

## 读改属性

- 对象页和资源页（用户 2026-11-15 定，设计稿 `designs/对象页合并与资源导航-设计稿.md`）左边浏览栏不同，右边是同一个检视区（`web/inspect/`）：导航条有后退 / 前进（Alt+← / Alt+→、鼠标侧键）、「最近看过」、引用链面包屑、类型徽标和动作（在资源页打开、在文件夹里定位、固定、复制路径、发给对话）。属性里的对象引用是可点的小卡片，点了在同一页打开（资源标「资源」，Ctrl+点在资源页打开）；两页共用一份导航历史，按项目存在内存里（整页刷新才清），地址里的 `路径|组件` 是唯一的真相，历史跟着地址对齐。旧地址 `actors/…` 自动转到对象页的「大纲」。对象页里改资源属性不放保存按钮，保存在资源页页头。
- 对象页「按类搜」的结果分「运行时实例 / 资源 / 类」三组。改资源只影响以后新建的对象，要看到正在显示的界面变化，改运行时实例。
- UMG 控件（UserWidget 实例或里面的控件）左边显示控件树，选中控件右边看它的参数，不画样式预览。
- 属性页照 UE 的「细节」面板（`web/details/`）：Category 是折叠条（`A|B` 分两层），AdvancedDisplay 的收在每类最后的「高级」里，顶上「所有 / 各分类 / 内部 / 改过的」筛选按钮；搜索框打字就筛（属性列表已经在网页里，不发请求），匹配显示名、变量名和分类名。名字列和值列中间的线能拖。
- 显示名、高级、内部、枚举显示名、容器个数是桥接 1.6.0 起给的（`displayName`、`advanced`、`edit`、`enumLabels`、`container` / `count` / `inner`）；旧桥接时网页自己把变量名拆成显示名，没有 Category 的当内部状态，数组不给加删按钮。
- 没有 EditAnywhere 这类标记的属性（UE 细节面板里看不到的内部状态）收在最后的「内部状态」里，默认收起。
- 数组的加一个 / 插入 / 复制 / 删除 / 清空走 `set` 的 `array` 参数，桥接直接改容器（`FScriptArrayHelper`），不整体替换：实例化子对象（Triggers、Modifiers）不会丢，复制时子对象也复制一份。这类修改不记原值，撤回用「放弃改动」或操作记录。
- Actor 的细节面板最上面是「变换」：读写根组件的 RelativeLocation / RelativeRotation / RelativeScale3D。组件列表按挂接关系画成树，右边标 C++ / 蓝图 / 构造脚本 / 实例（`components` 的 `scene`、`created`，桥接 1.6.0 起）。
- 不能改的属性照样画控件但是灰底灰字（能改的是深色输入框）：EditConst、编辑器和蓝图都看不见的内部状态、只能在类默认值或只能在实例上改的、类本身。桥接也会拒绝这些修改。
- 改运行时对象时走属性的 setter（C++ Setter 或蓝图的 BlueprintSetter），再让 UMG 控件、组件刷新，改完界面马上变。

## 性能

- 所有发请求的搜索都要按回车或点「搜索」；属性页的搜索只筛已经取到的列表，打字就筛。
- Object 页（原来的 Actor 页和运行时对象页合成一页，用户 2026-11-11 定）：上面是可搜索的类下拉，默认 UObject；下面按名字前缀在选的类和它的子类里搜，最多列 200 个。类下拉不打字时列常用的类，打字后用桥接的 `classes`（1.8.0 起）按名字搜已加载的类；旧桥接搜不到时，输入的字本身也能当类名用。选了具体的类时名字可以空着（列这个类的全部）。
- 类型是 UObject 时不把类名发给桥接（按类取会把几百万个对象全取出来），走只按名字前缀的全表扫描：在游戏线程上限时 50 毫秒，超时返回部分结果并提示选具体的类。
- 搜到的 Actor 带显示名、所在关卡、是不是玩家（`objects` 的 `actor`、`label`、`level`、`player`，桥接 1.8.0 起），名字前缀也按编辑器里的显示名比；选中的对象是 Actor（`components` 读得出）时中间多一栏组件树。
- 属性面板的「函数」页签（用户 2026-11-11 定）：列对象上所有的 UFUNCTION，按公有 / 受保护 / 私有分组（`functions` 带 `all: true`，返回 `access`、`blueprint`，桥接 1.9.0 起）。点一个弹窗填参数执行，结果（成功或失败、用时、返回值、输出参数）显示在弹窗下半部分，参数按函数记着，关了再开还在。没开放给蓝图的标「非蓝图函数」，只在网页上你自己点时能执行（`call` 带 `any: true`）；服务端拦住 Agent 带 `any`，Agent 的 `ue_call` 只能调蓝图开放的函数。
- 执行弹窗里的对象参数（`params` 的 `objectClass` / `objectClassPath`）可以「选择」：「搜索对象」上面是可搜索的类下拉，只列能赋给参数的类（`classes` 带 `base`），默认就是参数类型；下面按名字前缀在所选类里搜，运行时实例、资源和没加载的资源都列（`objects` 带 `assets: true`，没加载的标 `unloaded`，执行时才加载）。「从对象的属性里选」列来源对象（默认当前对象）的属性里现在放着、能赋给这个参数的对象，数组 / 集合元素、Map 的值、结构体里两层都算，Actor 再加上它的组件（`object.refs`）。桥接执行时按路径找对象并检查类型，类型不对直接报错。
- 「我的角色」「玩家控制器」等快捷按钮和类下拉无关：直接按固定的类在目标世界里找实例并打开，不改搜索条件。
- 资源页的类型也是可搜索的下拉：不打字时列常用类型和项目里真有资源的类型（带个数，`asset.classes`，桥接 1.8.0 起，读资源注册表，结果留 30 秒），打字能搜到引擎里任何类；只在编辑器或后台编辑器已经起来时去取，不为点开下拉启动后台编辑器。
- DataTable 只把当前页的行转成 JSON。
- 属性转 JSON 时，对象引用只给路径，不展开子对象。UMG 的 Slot、Lua 绑定的对象互相引用，展开会递归到栈溢出把编辑器弄崩。
- 日志：
  - 桥接里是环形缓冲：8000 行，单行最多 4000 字符。
  - 按游标增量取，筛选在桥接里做。
  - 网页最多留 5000 行，只画看得见的行。
  - 离线日志文件流式搜最后 64 MB。
- 轮询的上一次请求还没回来时跳过这一拍。

## 状态

C++ 部分还没有在真实引擎（5.4 / 5.5 / 5.6）上编译和实测。面板这一侧用 `scripts/fake-bridge.mjs` 模拟桥接，跑 `scripts/smoke.mjs` 做冒烟测试：

```bash
npm run build -- ue && node ue/scripts/smoke.mjs
```

资源和蓝图读写（桥接 1.2.0）新增的待验证点列在 [docs/asset-blueprint-design.md](docs/asset-blueprint-design.md) 的「要在真实引擎上验证的」。

需要在真实引擎上确认的重点：

- 清空日志的「关闭 → 清空 → 原名重开」是否可靠；
- 后台编辑器的 HTTP 服务能不能被 commandlet 的循环泵起来；
- PIE 多客户端时世界 id 是否正确；
- UnLua：Build.cs 能不能选对拿 lua_State 的接口，对象表能不能认出来，绑定对象的模块名对不对。
