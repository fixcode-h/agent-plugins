# UE 插件

按项目连接正在运行的 Unreal Engine（5.4 及以上）。网页上有「UE」管理页，对话里的 Agent 有 15 个 `ue_*` 工具。

## 组成

- **面板插件**（`server/`、`web/`）：
  - 图标栏里的 UE 管理页。分区有概览、控制台、GM、Lua（UnLua 项目）、Actor、运行时对象、资源 / DataTable、监视、性能、日志、操作记录、桥接与权限。
  - 添加项目的弹窗。
  - 对话右栏的「UE」页签。
  - Agent 工具。
- **UE 端桥接插件**（`bridge/AgentPanelBridge/`，C++）：添加项目时复制到 `<项目>/Plugins/AgentPanelBridge/`。
  - 进程里起一个只听 127.0.0.1 的 HTTP 服务，名片写在 `Saved/AgentPanel/instances/<PID>.json`。
  - 运行时模块负责控制台、GM、反射读写、日志和截图。
  - 编辑器模块负责资源写入和保存、PIE 和 Live Coding。
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
- 帧数据抓取有时长上限（默认 30 秒，最多 10 分钟），到时间自动停；面板重启后下次看状态时补停。
- 分析结果先摘要再下钻，不把整份文件给 Agent：帧数据看关键指标、卡顿帧和当时涨得最多的列、按书签分段；内存报告看按类的对象表和各分段；两份同类的可以对比（查内存泄漏用两份内存报告）。
- Agent 的权限：看和分析不用确认；发起抓取按「运行时」权限，询问时一次抓取确认一次；删除抓取文件每次确认。
- 网页上每份抓取有「让 Agent 分析」，把抓取交给对话。
- Unreal Insights 的 `.utrace` 现在只登记、不能分析；实时数值、GPU 分阶段耗时也还没有，等桥接后续版本。
- 解析器按 UE 5.4 的文件格式写，测试数据是手写的样例（`scripts/perf-fixtures.mjs`），还没用真实项目的文件验证过。`node ue/scripts/perf-test.mjs` 跑解析器测试。

## 只认 Agent 模式里的项目

- 「添加 UE 项目」只列面板里已经添加的项目。
- 只有接入了的项目里的 Agent 对话会挂工具。聊天和设计模式的对话不挂。

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

需要在真实引擎上确认的重点：

- 清空日志的「关闭 → 清空 → 原名重开」是否可靠；
- 后台编辑器的 HTTP 服务能不能被 commandlet 的循环泵起来；
- PIE 多客户端时世界 id 是否正确；
- UnLua：Build.cs 能不能选对拿 lua_State 的接口，对象表能不能认出来，绑定对象的模块名对不对。
