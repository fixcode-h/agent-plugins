# UE 插件

按项目连接正在运行的 Unreal Engine（5.4 及以上）。网页上有「UE」管理页，对话里的 Agent 有 17 个 `ue_*` 工具。

## 组成

- **面板插件**（`server/`、`web/`）：
  - 图标栏里的 UE 管理页。分区有概览、控制台、GM、Lua（UnLua 项目）、Actor、运行时对象、资源 / DataTable、监视、性能、日志、操作记录、桥接与权限。
  - 添加项目的弹窗。
  - 对话右栏的「UE」页签。
  - `.uasset` 的查看窗口（面板 SDK 的 `fileViewers`，`web/AssetFile.tsx`）：对话里的文件标记、文件浏览页点 `.uasset` 时弹出，DataTable 显示成表格，DataAsset 等显示属性，蓝图多一页大纲和图表伪代码，都有「摘要与引用」；只看不改，底栏可以跳到资源分区去改。旧面板没有这个扩展点，照旧交给系统打开。
  - Agent 工具。
- **UE 端桥接插件**（`bridge/AgentPanelBridge/`，C++）：添加项目时复制到 `<项目>/Plugins/AgentPanelBridge/`。
  - 进程里起一个只听 127.0.0.1 的 HTTP 服务，名片写在 `Saved/AgentPanel/instances/<PID>.json`。
  - 运行时模块负责控制台、GM、反射读写、日志和截图。
  - 编辑器模块负责资源读写和保存、蓝图图表读写和编译、PIE 和 Live Coding。
  - 后台编辑器用 `-run=AgentPanel`：编辑器没开时读资源，闲置后自己退出。
  - Shipping 包里没有桥接。

## UnLua 项目

UnLua 由项目自己带，面板不安装。桥接编译时检测 `<项目>/Plugins` 里的 UnLua（`.uproject` 里关掉了就当没有），有就编进 Lua 支持，没有时这部分代码不编译。

- 运行时对象页可以只看绑了 Lua 模块的对象、按模块名搜；属性面板多一个「Lua」页签看和改实例表的字段。
- 「Lua」页：执行 Lua 代码（`self` 可以是某个对象的实例表），按路径看全局表里纯 Lua 的单例和管理器。
- Agent：`ue_find kind=lua`、`ue_get` / `ue_set` 的 `lua` 参数、`ue_lua`（执行代码，不管权限设成什么每次都请用户确认）。
- 读写只用 Lua 的 C 接口：UnLua 注册表里「UObject 指针 → 实例表」的对象表名字对不上时，扫注册表认出来；会触发元方法的读写都在 `lua_pcall` 里。
- 只有「拿到 lua_State」和 UnLua 版本有关：`AgentPanelBridge.Build.cs` 扫 UnLua 头文件里有 `GetEnv(UObject*)`、`GetEnv()` 还是 `UnLua::GetState()`。改过的分支这几个都没有时，在项目模块里调 `FAgentPanelLua::SetStateProvider` 提供。

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
- **权限**（UE 页「桥接与权限」）：改内容跟随「资源」；新建、复制、改名是「结构性操作」，默认每次问；删除每次都问；`ue_python` 默认关，开了也每次问。保存照旧确认，P4 项目先签出、新文件 `add`、删除的 `delete`，都进默认变更列表不提交。
- **多个对话**：另一个对话改过、还没保存的资源，后来的对话改它时直接报错。
- **网页**：资源页选中蓝图后有「蓝图」页（大纲和伪代码，点节点 id 看引脚），所有资源都有「摘要与引用」页。网页上不改图，只提供编译。
- **`ue_python`**：代码写成临时文件，用控制台的 `py` 命令执行，项目要启用引擎的 Python Editor Script Plugin。桥接不依赖 Python 模块。

## 读改属性

- 运行时对象的搜索结果分「运行时实例 / 资源 / 类」三组。改资源只影响以后新建的对象，要看到正在显示的界面变化，改运行时实例。
- UMG 控件（UserWidget 实例或里面的控件）左边显示控件树，选中控件右边看它的参数，不画样式预览。
- 属性按 Category 分菜单，一次看一个分类；搜索时跨分类列出。
- 不能改的属性只显示不给改：EditConst、编辑器和蓝图都看不见的内部状态、只能在类默认值或只能在实例上改的、类本身。桥接也会拒绝这些修改。
- 改运行时对象时走属性的 setter（C++ Setter 或蓝图的 BlueprintSetter），再让 UMG 控件、组件刷新，改完界面马上变。

## 性能

- 所有搜索都要按回车或点「搜索」才发请求。
- Actor 按名字前缀搜，最多列 200 个。
- 只写名字前缀、不写类名搜运行时对象时，在游戏线程上限时 50 毫秒，超时返回部分结果。
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
