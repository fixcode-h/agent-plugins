---
name: ue-runtime-debug
description: 用面板 UE 插件的 ue_* 工具连接正在运行的 Unreal Engine（编辑器、PIE、游戏、专用服务器）排查 Bug 和调数值：定位 Actor 和运行时对象、读改属性、跑 GM 和控制台命令、读 DataTable 和资源、看日志和截图。需要看 UE 运行时的真实状态、而不是只读代码猜时使用。
user-invocable: true
---

# UE 运行时调试

面板「UE」页接入的项目里，对话会挂上 `ue_*` 工具，直接连到项目里正在运行的 UE 进程（UE 端插件 UELink，和 UEToVS 共用）。
编辑器没开时，资源类的读取走后台编辑器（不开窗口，首次 30–60 秒）；它默认不自动起，要读时先 `ue_editor action=background_start`，或请用户打开编辑器。

## 先看状态

1. `ue_status`：有哪些进程（editor / game / server / background）、每个进程的世界（`editor`、`pie0`、`pie1`、`game`）、Agent 权限。
2. 没有进程：说明情况，问用户要不要 `ue_editor action=start_editor` 或 `pie_start`；不要擅自启动 PIE 打断用户。
3. 多人 PIE：`pie0` 一般是服务器（监听服务器 / 单机），`pie1…` 是客户端。看 `ue_status` 里 `netMode` 判断。

## 定位对象

- Actor：`ue_find kind=actor prefix=BP_Hero`（按名字**前缀**，比对对象名和编辑器显示名；空前缀不返回）。
- 组件：`ue_find kind=component path=<Actor 路径>`。
- 子系统、GameInstance、GameState、PlayerController、单例：`ue_find kind=object class=MyInventorySubsystem`。
- 资源：`ue_find kind=asset class=DataTable prefix=DT_Item`。

## 读属性

- `ue_get path=<对象>` 列出全部属性（大的值是摘要，带 `_truncated`），`filter` 按属性名前缀筛。
- `ue_get path=<对象> prop=<属性路径>` 取完整值。属性路径：
  - 结构体字段 `Stats.MaxHP`
  - 数组元素 `Items[2].Count`
  - Map 的键 `Tags["Fire"]`
  - 跟进对象引用 `InventoryComp.Owner.Health`
- `ue_get path=<对象> props=["Health","Stats.MaxHP"]` 一次读几个变量（最多 30 个）。
- `ue_get path=<对象> file=true` 把整个对象的属性不截断写成 JSON 文件，只回路径和条数；Actor 默认带上每个组件的属性（`components=false` 不带）。再用读文件、搜索看需要的部分，别把整份贴进回复。加 `prop` 时只导那个属性的完整值（大数组、大 Map）。
- 蓝图资源路径（`/Game/Blueprints/BP_Hero`）读的是类默认值（CDO）。

## 改值、调函数、GM

- **先在运行时验证**：`ue_set` 改值、`ue_call` 调函数、`ue_gm action=run` 跑 GM、`ue_console action=run` 执行命令，确认现象改善后再动资源或代码。
- 多个对象或资源改同一个属性：`ue_set paths=[...]`（或 `select`，关卡里一类 Actor 用 `select={kind:"actor", class, tag}`）**一次调完**，不要逐个调或并行发多次；`ue_get paths=[...]` 同理。
- 同步属性（`replicated`）在客户端世界改会被服务器盖掉：结果里 `client=true` 时，用 `target.world` 切到服务器世界再改。
- 控制台变量：`ue_console action=cvars changed=true` 看改过的；`action=set` 改，结束前改回或告诉用户。
- `ue_gm action=list` 看 GM 的参数类型和说明再执行；项目里存的宏用 `action=macro`。
- GM 页对象列表里的对象（或按类 + 标识现找的对象）不用先找路径：`ue_gm action=call def={obj:"背包", function:"AddItem", args:{Id:2003}}` 调函数，`def={obj, props:["@.Gold"]}` 读值，`def={obj, prop:"@.Gold", value:999}` 改值；`obj` 也能直接写匹配规则 `{class, ident}`。常用的对象 `ue_gm action=save kind=object` 存进对象列表，常做的调用 / 改值存成自定义 GM（`kind=call` / `set`）。
- 危险命令（quit、open、servertravel…）会弹确认卡片给用户，被拒绝就停下说明。

## UnLua 项目的 Lua 侧

`ue_status` 里进程有 `lua` 字段时项目用了 UnLua。UPROPERTY 看不到 Lua 里的状态，要看 Lua 侧：

- 找绑了 Lua 的对象：`ue_find kind=lua module=GameInstance`（模块名包含的文字，也可以加 class、prefix），结果带模块名。
- 读实例表：`ue_get path=<对象> lua=""` 列一层字段和模块函数；`lua="Bag.Items[3]"` 往下取。表一次一层，子表按路径再取。
- 纯 Lua 的单例、管理器：不写 path，`ue_get lua="GameSystemManager"` 或 `lua='package.loaded["Game.Core.X"]'`，从全局表开始。
- 改简单字段：`ue_set path=<对象> lua="Bag.Gold" value=999`（只能改数字、字符串、布尔、nil，能 `ue_undo` 撤回）。
- 纯 Lua 实例（Lua 框架自己 new、不绑 UObject 的表）：`ue_find kind=lua module=<完整模块名>` 给的 `luaref:编号` 可当 `ue_get` / `ue_set lua=` / `ue_lua action=call` 的 path，但换一局游戏就失效；要反复用的写成匹配规则 `{class:"lua:<模块名>", ident:[…]}` 交给 `ue_gm action=call` 或存进对象列表，每次按规则现找。
- 复杂的（调 Lua 函数、改表、看计算结果）用 `ue_lua code="..."`：单个表达式直接返回值，`path` 给了对象时 `self` 是它的实例表。会请用户确认（用户可选本对话不再询问），先想清楚一次要做的事，别拆成很多次小调用。

## 资源和 DataTable

- `ue_asset action=rows path=/Game/Data/DT_Items filter=Sword` 分页读行；`action=row` 读一行全部字段。
- 改：`action=set`（单元格）、`add / remove / duplicate / rename`（行）。改动只暂存在编辑器里（标脏）。
- 保存：`action=dirty` 看改了哪些包，`ue_save packages=[...]` 写回（P4 项目先签出，按权限请用户确认）。不需要了用 `revert` 放弃。
- 后台编辑器读到的是磁盘上保存的版本；编辑器开着时读写走编辑器。

## 看现象

- `ue_log action=tail verbosity=Warning` 取警告和错误；记下结果里的 `cursor`，下次 `since=<cursor>` 只取新行，省上下文。
- `ue_log action=crashes` 看崩溃记录。
- `ue_screenshot` 截视口，确认 UI、角色位置、特效对不对。
- 用户要你清空日志时用 `ue_log action=clear`（不能撤回）。

## 用 VS 断点调试（C++）

属性值、日志看不出 C++ 在哪一步走错、某个函数有没有被调到、当时的参数和成员是什么时，用 `ue_vs_*` 让 VS 自带的调试器停下来看。要求：Windows、VS 里装了 UEToVS 0.8.0 以上，UEToVS 设置「MCP > 允许 Agent 通过 VS 调试 UE」开着（默认开）。VS 没开时 `ue_vs_debug` 的 start / attach / build 会自己打开 VS 和解决方案（最多等 3 分钟）。断点、单步、求值只对 C++ 有效，蓝图和 Lua 不行（Lua 用 `ue_lua action=snap`）。

1. **挂上调试器**：`ue_vs_debug action=status` 看 `mode`。没在调试时：
   - 编辑器已经开着 → `action=attach`（默认附加 UnrealEditor，多个时按返回的 PID 再给 `pid`）。
   - 编辑器没开 → `action=start`（等于 F5，VS 先编译再启动）；要直接进某张图用 `map=/Game/Maps/Test`，独立游戏进程加 `game=true`，额外参数 `args="-log"`，只对这一次生效。
2. **下断点**：`ue_vs_breakpoints action=add file=Source/Game/Hero.cpp line=120` 或 `function=AHero::Jump`；只在某种情况停用 `condition="Health < 0"`，第 N 次才停用 `hitCount`；只想知道走没走到、值是多少又不想停下，用 `message="Health={Health}"`（日志断点，结果在 `ue_vs_inspect action=output`）。结果带 `hint` 说明没绑定（符号没加载、这行没代码）时，换一行或等模块加载后再看 `list`。
3. **触发**：`ue_gametest run` 跑测试场景、`ue_console` / `ue_gm` / `ue_call` 触发逻辑，或 `ue_editor action=pie_start` 开 PIE。
4. **等停下**：`ue_vs_debug action=wait timeoutMs=60000`，`event=break` 时结果里有 `location`（文件:行、函数）和前 8 帧栈；`timeout` 说明没走到，回去检查断点和触发步骤。
5. **看现场**：`ue_vs_inspect action=stack` → `action=locals`（`frame` 换帧，`depth` 展开成员）→ 需要时 `action=eval expr="this->Inventory.Num()"`（`exprs` 一次几个）。`eval` 能调用函数、有副作用：只读成员和无副作用的 getter，别调 `Destroy()`、`SetXxx()` 这类会改状态的。
6. **往下走**：`ue_vs_debug action=step kind=over`（`into` 进函数、`out` 跳出、`toLine` 跑到 `file`+`line`），默认等到停下返回新位置；`action=continue` 继续，`waitMs` 大于 0 时等下一次停下。
7. **结束**：`ue_vs_breakpoints action=clear` 清掉自己下的断点（默认只删 Agent 下的，用户的不动），再 `continue`；不再需要调试器时 `ue_vs_debug action=stop detach=true` 只断开、UE 继续跑。

**UE 停在断点时整个进程冻住**：所有走 UELink 的 `ue_*` 工具（ue_get、ue_log、ue_gametest…）都调不通，报错会说「UE 停在 VS 断点 …，先 ue_vs_debug continue 继续」。要用它们先 `continue`，别以为 UE 卡死了去重启编辑器。

**崩溃、check、ensure**：挂着调试器时这些会停在 VS 里，`wait` 返回 `break`，`lastReason` 是 `exception` / `unhandledException` / `breakpoint`（`__debugbreak`，ensure 和 check 走这里）。先 `stack` 看调用栈、`locals` 看出错那帧的变量，再 `ue_vs_inspect action=dump` 存小转储留证据（`full=true` 带堆，编辑器会有几 GB，用户要时才存）。ensure 停下后可以 `continue` 接着跑。

**谁改了这个值**：先停在能访问它的地方（比如它所在类的某个函数断点），`ue_vs_breakpoints action=add data=this->Health size=4`，然后 `continue` → `wait`，停下时就在改它的代码后面，`stack` 看是谁。数据断点只能在停下时设，x64 一次最多 4 个，调试结束就失效。

**改代码到复测**：

- 改了函数体、模块已经加载：不用停调试器，`ue_editor action=livecoding` 热重载，再触发复测。
- 改了头文件、加了 UPROPERTY / UFUNCTION、Live Coding 不行时：`ue_vs_debug action=stop`（会结束 UE，请用户确认，编辑器里没保存的先 ue_save）→ `action=build` → `action=wait` 看 `buildDone` / `buildFailed`，失败时按 `buildErrors` 的 文件:行 修了再 build → `action=start` → `ue_gametest run` 或原来的触发步骤复测。
- Development 构建里很多局部变量被优化掉（显示「已优化」）：`ue_vs_debug action=start configuration="DebugGame Editor"` 换成 DebugGame 再看（要先 stop，会重新编译）。

## 收尾

- `ue_undo` 不带 id 列出本对话做过的修改；运行时改过、用户没要求保留的，问用户要不要撤回。
- 用过 VS 断点的，结束前 `ue_vs_breakpoints action=clear` 清掉自己下的，别让用户的 UE 下次莫名其妙停住。
- 工具报错原样告诉用户，说明卡在哪；不要绕过权限、不要换别的办法偷偷重试。
- 结论要有证据：属性值、日志行、截图，而不是只凭代码推断。
