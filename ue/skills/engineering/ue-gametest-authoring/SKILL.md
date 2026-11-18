---
name: ue-gametest-authoring
description: 给 UE 功能写、校验、跑和维护 GameTest 回放测试（v3 脚本：块、统一条件、表达式、守护、invoke / api 调函数、对象定位、项目 C++ / Lua 接口）。验证刚改的玩法或界面、复现用户说的操作、把录制整理成带循环和分支的流程、补回归测试时使用；不用等用户录制，从项目代码直接写。
user-invocable: true
---

# 写 GameTest 测试

GameTest 是项目 `Plugins/` 里的 UEKit 扩展，在 PIE 或游戏进程里按 JSON 脚本操作界面、调函数、检查状态。
脚本放在场景根（`ue_gametest action=status` 的 `scenarioRoot`），格式是 **v3**（`schemaVersion: 3`）。
协议全文在 UEKit 的 `docs/game-test-script.md`（v3）和 `docs/game-test.md`（1.x 的动作、选择器、录制）；这里是写测试的做法。

## 流程：查 → 写 → 校验 → 跑 → 改 → 进回归

1. **弄清要测什么**：一句话写下「做了什么之后，应该看到什么」。读改动的代码（C++、蓝图名、Lua），找到入口界面、点击处理、改的数据在哪。
2. **查**（不开游戏也行）：
   - `ue_gametest action=widgets asset=/Game/UI/WBP_Bag`：WBP 的控件树，每个控件直接给 `selector`；列表、格子标 `container`。
   - `action=vars scope=widget target=WBP_Bag:.`：界面上的字段和只读函数，按 C++ / 蓝图 / Lua 分组；`scope=subsystem name=QuestSubsystem`、`scope=player which=ps`、`scope=lua module=Game.Quest.QuestMgr` 同理。`values=true` 且游戏开着时带此刻的值。
   - `action=api query=任务`：接口库。自带接口（`Object.*`、`Widget.*`、`Player.*`、`Log.*`…）加项目接口（`项目.…`）。只读的（`readOnly`）能写进条件和表达式。
3. **写**：先准备状态（`api` / `invoke` 调项目接口、GM），`set` 记下初值，再走界面操作，最后用条件或表达式检查。见下面「写法」。
4. **校验**：`action=validate scenario=…`（或 `script=` 整份 JSON）。错误按步骤 `id` 和错误码返回，全部改掉再跑。返回 `offline: true` 说明编辑器没开、只查了结构：函数、选择器、代码变量路径要开着编辑器再校验一次。
5. **跑**：`action=run scenario=…`（可带 `params`），`job` 看进度，`report` 取报告。只想从某一步跑：`from` / `to` 写步骤 id。
6. **改**：读失败步骤的 `payload.evidence`（截图、控件快照、前后 50 行日志）、`payload.cond`（条件每一项的实际值）、`payload.invoke`（调用的返回值）。先判断是**功能 bug**还是**脚本写错**（见「失败了怎么判断」），功能 bug 告诉用户、按要求改代码；脚本问题改脚本再跑。
7. **进回归**：通过后放进 `regression/<模块>/`，`tags` 写上模块名和 `regression`，以后 `run tag=regression` 批量回归。交付时说清：脚本路径、验证了什么、跑了几次、结果。

**不要**让用户去录制、去点界面；能从代码写就自己写。不知道某个控件怎么写选择器时，`widgets` 读资产；游戏开着可以 `inspect` 指着看。

## 写法（v3）

```json
{
  "kind": "gametest-scenario", "schemaVersion": 3, "name": "每日福利领取",
  "tags": ["welfare", "regression"],
  "params": { "day": { "default": 1, "type": "int", "note": "签到第几天" } },
  "vars": { "gold0": 0 },
  "objects": { "npc": { "class": "BP_WelfareNpc_C", "key": { "NpcId": 2001 } } },
  "guards": [ { "id": "g1", "name": "新手引导", "when": { "target": "WBP_Guide:.", "onScreen": true },
                "do": [ { "action": "call", "script": "common/翻完引导" } ] } ],
  "steps": [
    { "id": "s1", "action": "api", "api": "项目.WelfareTest.ResetDaily", "args": { "Day": "$day" }, "note": "重置签到到第 N 天" },
    { "id": "s2", "action": "set", "var": "gold0", "value": "=@ps.Gold" },
    { "id": "s3", "action": "invoke", "object": { "$obj": "npc" }, "function": "OpenWelfare" },
    { "id": "s4", "action": "click", "target": "WBP_Welfare:Root/List[Data.Day=$day]>BtnClaim",
      "skipIf": { "textLike": "已领取" } },
    { "id": "s5", "action": "assert", "expr": "@ps.Gold >= $gold0 + 500", "note": "金币到账" },
    { "id": "s6", "action": "assert", "expr": "len(Log.Errors()) == 0", "note": "没有报错（Error、Ensure、Lua 报错）" }
  ]
}
```

- **id**：每步写 `id`（字母数字下划线，场景内唯一）；报告、断点、`from` / `to` 都按它。
- **块**：`group`（`do`）、`if`（`cond` / `then` / `elif` / `else`）、`loop`（`until` / `while` / `times` / `each` / `in`，除 `times` 外**必须写 `max`**）、`call`（`script` + `with`）、`set`、`invoke`、`api`、`break` / `continue` / `return` / `fail`、`widget.close` / `widget.call`。
- **统一条件**：`{ "all": [...] }` / `{ "any": [...] }` / `{ "not": … }` 任意嵌套；一条判断可以是控件（`target` + `onScreen` / `visible` / `enabled` / `text` / `number` / `field`…）、代码变量（`value: "@ps.Gold", gte: 100`）、脚本变量（`value: "$n"`）、只读接口（`api` + `args`）、表达式（`expr`）、常用名（`alias`）。`settleMs`（默认 300）防刚打开的界面误判。
- **表达式**：填值处写 `"=…"`，条件写 `{"expr": "…"}`。只算值：`$var`、`@来源.路径`、`text(sel)`、`number(sel)`、`len` `min` `format`… 和**只读**接口。改状态的函数只能用 `invoke` / `api` 步骤。
- **取值来源**：`@gi @gs @gm @ps @pc @pawn @hud`、`@sub.<子系统类>`、`@actor[tag=X]`、`@obj.<名字>`、`@luaMod.<require 路径>`、`@luaG.<全局>`、`@cvar.<名字>`。路径照 `vars` 返回的 `path` 抄，不要猜。
- **对象**：`objects` 写「类 + 唯一标识」，运行时重新找。标识挑 `vars` 里像 Id 的整数或短字符串；不写 `key` 就按第一个，同类有多个时会找错。
- **守护**：不定时弹出的东西（引导、公告、断线重连、升级弹窗）写成守护，不要在主流程里到处插「如果有就关掉」。全局的写在 `_settings.json` 的 `guards`，一个脚本自己的写在顶层 `guards`。
- **子脚本**：重复出现的一段（登录、翻完引导、回主界面）写成带 `params` 的脚本放 `common/`，用 `call`。先 `action=scenarios` 看已有的，能复用就复用。

## 什么时候调函数、什么时候走界面

- **准备状态**（等级、道具、任务进度、存档、时间）：用项目接口或 GM，不要走一长串界面去凑。测试的是后面那段界面流程。
- **被测的操作本身**：走界面（`click`、`key`、`type`、`drag`），这样才测到按钮绑定、界面刷新、Lua 回调。
- **检查结果**：两头都看——数据（`@ps.Gold`、子系统里的值、项目接口的只读查询）和界面（文字、数量、红点是否消失）。只看界面会漏数据没存，只看数据会漏界面没刷新。
- 项目里还没有合适的接口：在项目接口文件夹里加一个（下面的示例），别用 `ue_lua` / 控制台临时拼一段代码塞进脚本。

## 项目接口

接口按文件夹认（GameTest 设置 →「接口库」可以改文件夹，存在场景根 `_settings.json` 的 `api`）：

- **Lua**：Lua 脚本根下 `GameTestApi` 文件夹（默认）里的模块，**模块函数**（`function M.Fn`，不是 `M:Fn`）就是接口，名字 `项目.<模块名>.<函数名>`。参数、返回照 EmmyLua 注释，`---@readonly` 的算只读（能当条件）。示例：[reference/lua-api-example.lua](reference/lua-api-example.lua)。
- **C++**：`Source/**/GameTestApi` 下蓝图函数库的 `static BlueprintCallable` 函数，`BlueprintPure` 算只读，`WorldContext` 自动填。示例：[reference/cpp-api-example.h](reference/cpp-api-example.h)。
- 接口只做「准备状态」和「查询」，**逻辑写在接口里，脚本只做编排**。参数只用能构造的类型（整数、浮点、布尔、字符串、枚举、简单结构体、数组）；对象参数用 `{"$obj": …}` 或这次运行里拿到的 `$var`。
- 写完 Lua 接口跑一次 `action=api query=<模块名>`，面板会重扫并写进场景根 `_api.json`；`validate` 认得 `_api.json` 里的名字。
- 用户的 UnLua 是二次开发版：Lua 里取游戏对象、调 C++ 的写法照项目里已有代码抄，不要套官方 UnLua 的 API。

## 结合真实工作的写法

- **刚改的界面功能**（例：背包加了「一键出售」）：`api` 发几件可售道具 → 记 `$gold0` 和 `Widget.ItemCount` → 打开背包、点一键出售、确认 → `assert` 金币涨了、列表少了、`Log.Errors` 为空。
- **Lua 逻辑改动**（例：任务追踪改了排序）：`vars scope=lua module=…` 找存数据的表 → 用 Lua 接口造几条不同状态的任务 → 打开追踪栏 → 用 `$item` + `loop each` 逐条检查顺序（`assert expr` 比较相邻两条的字段）。
- **引导、弹窗打断**：写全局守护，`when` 用 `onScreen`，`do` 调 `common/翻完引导`；主流程照常写，不为它加分支。
- **翻页数不固定**：`loop until` + `max`，条件挑「最后一页才出现 / 才可点」的控件或 Lua 字段（`@lua.isLast`），别写死次数。
- **列表里找某一条**：选择器按数据字段 `List[Data.ItemId=1001]>BtnUse`，不用序号 `List[3]`；字段名从 `vars scope=widget` 的条目类或录制的 `hint.key.cands` 里挑。
- **切地图、加载**：`api Wait.Loading` 或 `wait until=...`，不写固定秒数。
- **随机结果**（抽卡、掉落）：开头 `api Random.Seed`，或用接口把结果固定；检查只看「数量对、类型在范围内」，不比具体值。
- **多端**（服务器 + 客户端）：同步属性在服务器读改（`client: "server"`），界面在客户端看。

## 失败了怎么判断

| 现象 | 多半是 | 怎么改 |
| --- | --- | --- |
| `selector_missing` / 等控件超时，截图里界面根本没打开 | 前一步没触发（按钮绑定、条件不满足） | 看前一步的 `payload` 和日志；是功能问题就报给用户 |
| 截图里界面开着，但找不到控件 | 选择器写错、控件在嵌套 WBP 里 | `widgets` 重读，`A>B` 进嵌套；条目用 `[字段=值]` |
| 条件时成时不成 | 界面刚打开数据还没刷 | 加大 `settleMs`；反面判断只在所在界面已在屏上时才算 |
| 被引导、公告挡住 | 缺守护 | 加守护，不要加 `wait seconds` |
| `invoke` 报 `object_not_found` | 对象还没生成 / 标识不对 | 前面加 `wait`（`Object.Exists`），用 `vars scope=object` 看候选的标识值 |
| `object_ambiguous` | 标识不唯一 | 多勾一个字段，或加 `near` |
| 断言实际值不对、日志里有 Error / Lua 报错 | 功能 bug | 给用户看证据（步骤、实际值、日志行、截图），说明判断 |

报告里每一条结论都要有证据：哪一步、实际值、日志行或截图路径。不确定是 bug 还是脚本问题时说清楚还要确认什么。

## 录制「整理成流程」

录制出来的是一个 `group`（平铺步骤）。整理时规则先找出这些模式，你在此基础上补充命名、提子脚本、挑条件：

- 连续按同一个键 / 点同一个按钮 N 次 → `loop until …`（条件挑循环后那一步的控件变得能点、或界面关掉），`max` 给 N 的 3 倍以上；
- 中途弹出又被关掉的界面 → 守护（全局的写进 `_settings.json`）；
- `skipIf` 带 `also` 的几步、「看情况点不同按钮」→ `if` / 按状态分支；
- 和已有脚本一样的一段 → `call` 那个脚本；
- 输入的固定值（账号、数量、Id）→ `params`。

结果是改动列表（`gametest-tidy` 代码块，格式见提示词），用户逐条勾选后才写回；步骤 `id` 不变，原录制备份成 `.json.bak`。

## 不许做的事

- 不改别人录的段、别人写的脚本的行为（只在整理、修复时改，并说明改了什么）；不删别人的回归脚本。
- 不用 `disabled`、`onFail: continue`、放宽断言、删掉检查来让失败「通过」。跑不过就报告。
- 不用 `ue_lua` / 控制台把逻辑塞进脚本绕过接口库；不用表达式调会改状态的函数。
- 不写固定等待（`wait seconds`）代替条件；`click` 本身会等控件可点。
- 不编选择器、字段路径、接口名：都从 `widgets` / `vars` / `api` 的返回里抄。
