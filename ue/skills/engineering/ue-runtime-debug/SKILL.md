---
name: ue-runtime-debug
description: 用面板 UE 插件的 ue_* 工具连接正在运行的 Unreal Engine（编辑器、PIE、游戏、专用服务器）排查 Bug 和调数值：定位 Actor 和运行时对象、读改属性、跑 GM 和控制台命令、读 DataTable 和资源、看日志和截图。需要看 UE 运行时的真实状态、而不是只读代码猜时使用。
user-invocable: true
---

# UE 运行时调试

面板「UE」页接入的项目里，对话会挂上 `ue_*` 工具，直接连到项目里正在运行的 UE 进程（UE 端插件 UELink，和 UEToVS 共用）。
编辑器没开时，资源类的读取会自动起一个后台编辑器（不开窗口，首次 30–60 秒）。

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
- 蓝图资源路径（`/Game/Blueprints/BP_Hero`）读的是类默认值（CDO）。

## 改值、调函数、GM

- **先在运行时验证**：`ue_set` 改值、`ue_call` 调函数、`ue_gm action=run` 跑 GM、`ue_console action=run` 执行命令，确认现象改善后再动资源或代码。
- 同步属性（`replicated`）在客户端世界改会被服务器盖掉：结果里 `client=true` 时，用 `target.world` 切到服务器世界再改。
- 控制台变量：`ue_console action=cvars changed=true` 看改过的；`action=set` 改，结束前改回或告诉用户。
- `ue_gm action=list` 看 GM 的参数类型和说明再执行；项目里存的宏用 `action=macro`。
- 危险命令（quit、open、servertravel…）会弹确认卡片给用户，被拒绝就停下说明。

## UnLua 项目的 Lua 侧

`ue_status` 里进程有 `lua` 字段时项目用了 UnLua。UPROPERTY 看不到 Lua 里的状态，要看 Lua 侧：

- 找绑了 Lua 的对象：`ue_find kind=lua module=GameInstance`（模块名包含的文字，也可以加 class、prefix），结果带模块名。
- 读实例表：`ue_get path=<对象> lua=""` 列一层字段和模块函数；`lua="Bag.Items[3]"` 往下取。表一次一层，子表按路径再取。
- 纯 Lua 的单例、管理器：不写 path，`ue_get lua="GameSystemManager"` 或 `lua='package.loaded["Game.Core.X"]'`，从全局表开始。
- 改简单字段：`ue_set path=<对象> lua="Bag.Gold" value=999`（只能改数字、字符串、布尔、nil，能 `ue_undo` 撤回）。
- 复杂的（调 Lua 函数、改表、看计算结果）用 `ue_lua code="..."`：单个表达式直接返回值，`path` 给了对象时 `self` 是它的实例表。每次都会请用户确认，先想清楚一次要做的事，别拆成很多次小调用。

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

## 收尾

- `ue_undo` 不带 id 列出本对话做过的修改；运行时改过、用户没要求保留的，问用户要不要撤回。
- 工具报错原样告诉用户，说明卡在哪；不要绕过权限、不要换别的办法偷偷重试。
- 结论要有证据：属性值、日志行、截图，而不是只凭代码推断。
