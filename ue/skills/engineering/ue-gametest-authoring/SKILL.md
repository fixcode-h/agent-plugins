---
name: ue-gametest-authoring
description: 给 UE 功能写、校验、跑和维护 GameTest 回放测试（v5 脚本：对象引用 + 部件、对象判断、块、表达式、守护、obj.* / api 调函数、项目 C++ / Lua 接口）。验证刚改的玩法或界面、复现用户说的操作、把录制整理成带循环和分支的流程、补回归测试时使用；不用等用户录制，从项目代码直接写。
user-invocable: true
---

# 写 GameTest 测试

GameTest 是项目 `Plugins/` 里的 UEKit 扩展，在 PIE 或游戏进程里按 JSON 脚本操作界面、调函数、检查状态。
脚本放在场景根（`ue_gametest action=look what=status` 的 `scenarioRoot`），格式是 **v5**（`schemaVersion: 5`）。
协议在 UEKit 的 `docs/game-test-ref.md`（v5 的对象引用、属性路径、部件、判断、对象动作，**以它为准**）和 `docs/game-test-script.md`（块、条件、表达式、守护、接口库）；这里是写测试的做法。

## 一句话记住 v5

脚本里**只存「类 + 唯一标识」**，不存选择器字符串、运行时名字（`WBP_Item_C_12`）、序号：

- **对象引用**：`{"class": "WBP_Shop", "ident": [{"prop": "@.ShopId", "op": "eq", "value": 1001}]}`；`in` 写在哪找（`screen` 屏上界面、`world` 关卡 Actor、`lua` 绑了 UnLua 的对象，可以写数组 `["screen", "lua"]`，都不限写 `all`，省略按类推）；`class` 也可以写 `lua:模块名`（绑的 Lua 模块是它或它的子类）；常用的写进顶层 `objects` 起名，别处写名字 `"shop"`；`obj.find` 存下的写 `"$变量"`。
- **部件**：落在对象里某个控件上时 `{"obj": "shop", "part": "BtnBuy"}`，嵌套 WBP 用 `.`（`Header.BtnClose`）。
- **判断**：`{"obj": "shop", "prop": "@/TxtTitle:text", "op": "contains", "value": "杂货铺"}`。属性路径从 `@`（对象自己）或 `@item`（列表条目的数据对象）出发，每段一个符号：`/名字` 子控件或 Actor 组件（只在属性前面）、`.名字` 反射属性、`.名字()` 取值函数（GameTest 2.1.6 起括号里能写常量参数 `.GetCount(1001)`）、`#名字` Lua 字段、`:名字` 算出的状态（只在最后：`:exists` `:onScreen` `:shown` `:enabled` `:text` `:count` `:selected` `:checked`…）、`[0]` / `["键"]` 下标。例：`@/Header/TxtTitle.Text`、`@.ShopId`、`@#shopName`、`@/ShopComp.Goods[0].Id`、`@:onScreen`、`@item#cfgId`。

## 流程：排流程和前置 → 补配置 → 查 → 写 → 打点 → 校验 → 跑 → 分析和改 → 进回归

0. **授权卡**：UE 项目的验证默认到编译为止，引擎的 Automation RunTests 不跑（面板会拦）。普通对话里第一次 `run` / `step`、执行或保存 GM、开 PIE 时，工具会弹授权卡请用户确认（拒绝 / 允许一次 / 本对话不再询问），**不用自己先问**；查（`look`）、写脚本、`validate` 不弹。用户拒绝了就到编译为止，不要换 `ue_lua` / `ue_console` / `ue_call` 绕过去做同样的事。在「UE 游戏内测试」工作流里跑时工作流自带这个授权，不弹卡。
1. **弄清要测什么**：一句话写下「玩家做了什么之后，应该看到什么」。读改动的代码（C++、蓝图名、Lua）和模块文档的接入时序，找到入口界面、点击处理、改的数据在哪。
2. **排正常流程和前置清单，缺的先补**：见下面「先补前置，再按正常流程测」。配置不齐时测出来的结果没有意义，先补齐、导表、重开 PIE 再往下写。
3. **查**（不开游戏也行）：
   - `ue_gametest action=look what=widgets asset=/Game/UI/WBP_Bag`：WBP 的控件树，部件名就是这里的控件名；列表、格子标 `container`。
   - `action=look what=props class=WBP_Shop`：对象的属性树，按「自己（C++ → 蓝图 → Lua）/ 各部件 / 条目数据 / 算出状态」分组，每项给能直接写进脚本的 `prop`、`kind`（决定能用哪些 `op`，见 `opsByKind`）和 `score`（当标识的推荐分）；游戏开着时给 `target={"obj": …}` 或 `object=…`，还带此刻的值、`distinct`（同类几个实例里有几种值）和 `suggest`（能区分同类实例的最少属性组合）。界面绑了 Lua 时加 `module=UI.Shop.ShopPanel`，`---@field` 声明的字段也会列出来。
   - `action=look what=vars scope=widget target={"obj": "shop"}`：字段和只读函数的签名；`scope=subsystem name=QuestSubsystem`、`scope=player which=ps`、`scope=lua module=Game.Quest.QuestMgr`、`scope=object object=<引用>` 同理。
   - `action=look what=api query=任务`：接口库。自带接口（`Object.*`、`Widget.*`、`Player.*`、`Log.*`…）加项目接口（`项目.…`）。只读的（`readOnly`）能写进条件和表达式。
4. **写**：先准备状态（`api` / `obj.call` 调项目接口、GM），`set` 记下初值，再按正常游戏流程走输入和界面操作，最后用对象判断或表达式检查。见下面「写法」。
5. **打快照点**：跑之前在被测链路的关键函数上加 Lua 快照点或 C++ 日志断点，见「用日志和快照点分析代码」。
6. **校验**：`action=validate scenario=…`（或 `script=` 整份 JSON）。错误按步骤 `id` 和错误码返回，全部改掉再跑。返回 `offline: true` 说明编辑器没开、只查了结构：部件名、函数、属性类型要开着编辑器再校验一次。
7. **跑**：`action=run scenario=…`（可带 `params`），`job` 等进度（工具里等到跑完、有步骤失败或约 45 秒才返回，不用自己反复调；还在跑就再调一次），`report` 取报告。只想从某一步跑：`from` / `to` 写步骤 id。拿不准引用命中几个：游戏开着时 `action=resolve refs=[{"ref": "shop"}]`。
8. **分析和改**：先对照快照点记录和日志，写出代码实际走了哪条路、和文档时序对不对（通过了也要写）。再读失败步骤的 `payload.evidence`（截图、控件快照、前后 50 行日志）、`payload.cond`（条件每一项的实际值）、`payload.ref`（引用挑中了谁、按什么挑的、候选的标识值）。先判断是**功能 bug**还是**脚本写错**（见「失败了怎么判断」），功能 bug 告诉用户、按要求改代码；脚本问题改脚本再跑。
9. **进回归**：通过后放进 `regression/<模块>/`，`tags` 写上模块名、`regression` 和 `agent`（标明是 Agent 写的，场景库里显示「Agent 编写」），以后 `run tag=regression` 批量回归。交付时说清：脚本路径、验证了什么、跑了几次、结果。

**从 OpenSpec 规范写**（工作流里 acceptance 标了 GameTest 的 Scenario）：一个 Scenario 一份脚本，放场景根 `openspec/<change>/<Rn>-<场景短名>.json`，`tags` 写 `openspec`、`<change>`、`agent`；GIVEN 写成准备状态（`api` / `obj.call` / GM / `set`），WHEN 写成操作，THEN 每条至少一个判断；第一步 `note` 写需求和 Scenario 名（`title` 照样写短句），报告能对回规范。规范没写清的值先 `look` 查，查不到写进 `params` 并注明是猜的。通过后按上面第 9 步进回归。

**不要**让用户去录制、去点界面；能从代码写就自己写。不知道用哪个属性区分同类对象时看 `props` 的 `score` / `suggest`；游戏开着可以 `inspect` 指着看，它直接给出引用。

## 写法（v5）

```json
{
  "kind": "gametest-scenario",
  "schemaVersion": 5,
  "name": "每日福利领取",
  "tags": ["welfare", "regression"],
  "params": { "day": { "default": 1, "type": "int", "note": "签到第几天" } },
  "vars": { "gold0": 0 },
  "objects": {
    "npc": { "class": "BP_WelfareNpc", "ident": [{ "prop": "@.NpcId", "op": "eq", "value": 2001 }] },
    "welfare": { "class": "WBP_Welfare" },
    "today": {
      "class": "WBP_WelfareDay",
      "in": { "obj": "welfare", "part": "List" },
      "ident": [{ "prop": "@item.Day", "op": "eq", "value": "$day" }]
    }
  },
  "guards": [
    {
      "id": "g1",
      "name": "新手引导",
      "when": { "obj": { "class": "WBP_Guide" }, "prop": "@:onScreen", "op": "is", "value": true },
      "do": [{ "action": "call", "script": "common/翻完引导" }]
    }
  ],
  "steps": [
    {
      "id": "s1",
      "action": "api",
      "api": "项目.WelfareTest.ResetDaily",
      "args": { "Day": "$day" },
      "title": "重置签到天数",
      "note": "用项目接口把签到进度重置到第 N 天（参数 day），今天的奖励变成可领取；只准备状态，不走界面"
    },
    { "id": "s2", "action": "set", "var": "gold0", "value": "=@ps.Gold", "title": "记下领取前的金币", "note": "存进 $gold0，最后对比到账金额" },
    { "id": "s3", "action": "obj.call", "obj": "npc", "function": "OpenWelfare", "title": "打开福利界面", "note": "调 NPC 的 OpenWelfare 打开福利界面（入口不是被测的部分）" },
    {
      "id": "s4",
      "action": "click",
      "target": { "obj": "today", "part": "BtnClaim" },
      "skipIf": { "obj": "today", "prop": "@/TxtState:text", "op": "contains", "value": "已领取" },
      "title": "点今天的领取",
      "note": "被测操作：按玩家流程点今天那一格的领取按钮；已经领过时跳过"
    },
    { "id": "s5", "action": "assert", "expr": "@ps.Gold >= $gold0 + 500", "title": "金币到账", "note": "数据侧：玩家金币比领取前至少多 500（第 N 天的奖励）" },
    {
      "id": "s6",
      "action": "assert",
      "cond": { "obj": "today", "prop": "@/BtnClaim:enabled", "op": "is", "value": false },
      "title": "领取按钮变灰",
      "note": "界面侧：领过后按钮不能再点，防止重复领取"
    },
    { "id": "s7", "action": "obj.close", "obj": "welfare", "title": "关掉福利界面", "note": "按 closeRules 关，回到主界面" },
    { "id": "s8", "action": "assert", "expr": "len(Log.Errors()) == 0", "title": "没有报错", "note": "整个过程日志里没有 Error、Ensure、Lua 报错" }
  ]
}
```

- **id**：每步写 `id`（字母数字下划线，场景内唯一）；报告、断点、`from` / `to` 都按它。
- **名称和说明**：每一步（含块）都写 `title` 和 `note`。`title` 是很短的一句中文，说这一步做什么（「选第一个剧情选项」「等对白结束」「确认进入手势匹配」），画布节点、运行记录、报告、对话里的运行卡片每行先显示它，不写成接口名或动作名；`note` 写详细说明：为什么这样做、准备的是什么状态、判断的依据。`validate` 对没写的步骤报 `no_title` / `no_note` 警告，补齐再跑。`title` 要 GameTest 2.6.0 起，编辑器里的 GameTest 更旧时 `validate` 会报不认识 `title`：请用户在「UE 插件」里升级，不要删掉名称。
- **对象引用**：`class` 按继承认，`WBP_Shop`、`WBP_Shop_C`、`/Game/UI/WBP_Shop` 都行。`in` 省略时界面在屏上找、Actor 在关卡里找、子系统直接取单例（`ident` 留空）；**组件**要写 `in: {"obj": 所属 Actor 的引用}`，列表 / 面板里的**条目**写 `in: {"obj": 界面, "part": "容器部件"}`。`ident` 顶层每项都满足才算；一项也可以是条件组 `{"any": [判断项…]}`（任一满足）/ `{"all": [...]}`（都满足），组里能再套子组，判断项和组都能写 `"not": true` 取反（GameTest 2.1.6 起；平铺够用就平铺）；同类有多个又没写够标识时默认报 `ref_ambiguous`（`many: "first"` / `"last"` / `"nearest"` 只在确实无所谓是哪个时用）。
- **挑标识**：从 `props` 里挑 `score` 高、`distinct` 等于实例数、不会变的（Id、配置表行名、本地化键 `@:textKey`）；不用 `@:index`、位置、选中、计数、会变的文字。项目给某个类定了默认标识的，写在 `_settings.json` 的 `identRules`，照它来。
- **比较**：`op` 按属性的 `kind` 选（`bool` 用 `is`；数字 `eq` `gt` `between`…；文字 `eq` `contains` `startsWith` `matches`，`text` 还能 `key` 比本地化键；枚举 `is` `isNot` `in`；`visibility` 还有 `visible` / `hidden`；对象 `isNull` `notNull` `classIs`；数组 `count`（配 `cmp`）`has` `empty`）。`op` 省略：bool 按真值，其余 `eq`。浮点、向量的 `eq` / `near` 带 `tol`。
- **块**：`group`（`do`）、`if`（`cond` / `then` / `elif` / `else`）、`loop`（`until` / `while` / `times` / `each` / `in`，`max` 不写或 0 = 不限轮数，Agent 写的循环**仍要给 `max` 兜底**，免得条件写错一直跑）、`call`（`script` + `with`）、`set`、`api`、`break` / `continue` / `return` / `fail`。
- **对象动作**：`obj.call`（`obj`、`part?`、`function`、`args`、`saveAs`、`expect`；`obj` 也可以是 `@sub.X` / `@luaMod.X`；静态函数省略 `obj`，`function` 写 `类名.函数`）、`obj.set`（`obj` + `prop` + `value`，控件状态走控件自己的 setter）、`obj.find`（`obj` + `saveAs`，之后写 `"$名字"`）、`obj.wait`（等一个对象判断成立）、`obj.close`（`how` 按顺序试 `call` / `lua` / `click` / `visibility` / `remove` / `pop` / `key` / `destroy`，`verify` 默认 `gone`；`how` 省略时按 `_settings.json` 的 `closeRules`，再按推荐）。
- **统一条件**：`{ "all": [...] }` / `{ "any": [...] }` / `{ "not": … }` 任意嵌套；一条判断可以是对象判断（`obj` + `prop` + `op` + `value`，`prop` 省略 = `@:exists`）、代码变量（`value: "@ps.Gold", gte: 100`）、脚本变量（`value: "$n"`）、只读接口（`api` + `args`）、表达式（`expr`）、常用名（`alias`）。`settleMs`（默认 300）防刚打开的界面误判。反面判断（`@:exists` / `@:onScreen` / `@:shown` 为 false）在类有实例但标识都不满足时也算成立。
- **表达式**：填值处写 `"=…"`，条件写 `{"expr": "…"}`。只算值：`$var`、`@来源.路径`、`prop(引用, "属性路径")`（例 `num(prop("shop", "@/TxtGold:text"))`）、`len` `min` `format`… 和**只读**接口。改状态的函数只能用 `obj.call` / `api` 步骤。
- **取值来源**：`@gi @gs @gm @ps @pc @pawn @hud`、`@sub.<子系统类>`、`@actor[tag=X]`、`@obj.<名字>`、`@luaMod.<require 路径>`、`@luaG.<全局>`、`@cvar.<名字>`。路径照 `vars` / `props` 返回的抄，不要猜。
- **守护**：不定时弹出的东西（引导、公告、断线重连、升级弹窗）写成守护，`when` 用对象判断、`do` 里常用 `obj.close`。不要在主流程里到处插「如果有就关掉」。全局的写在 `_settings.json` 的 `guards`，一个脚本自己的写在顶层 `guards`。
- **子脚本**：重复出现的一段（登录、翻完引导、回主界面）写成带 `params` 的脚本放 `common/`，用 `call`。先 `action=look what=scenarios` 看已有的，能复用就复用。参数传对象时传 `objects` 里的名字，不传选择器。

## 旧脚本（v1–v4）

只认 v5，读到旧脚本报 `schema_old`（「旧格式不再支持，请按新写法重写」），旧的路径写法（`@self.X`、`@部件.X`、`@lua.X`、开头 `:状态`）报 `path_old` 并给出新写法，`_settings.json` 里的 `itemKeys` / `objectKeys` / `blockers` 报 `settings_old`。**不做迁移**，也不要只改版本号：按上面的写法重写，`props` 给的 `prop` 就是新写法，重写完 `validate` + `run`。

## 先补前置，再按正常流程测

1. **排正常流程**：从玩家能做的第一步写起——进地图、走近或传送到 NPC 旁、按交互键、看对话、点选项按钮、进玩法、操作、结算、退出。每一步写清走哪个输入或界面、会触发哪个函数或事件（读代码确认）。
2. **排前置清单**：顺着这些步骤列出要用到的配置和资源：NPC 配置（功能 NPC 表、玩法表的行）、NPC 状态蓝图 / 交互组件、对话或剧情（例如 E 类对话、剧情实例、选项按钮节点）、引导、地图点位、要用的 GM。每项去查有没有、字段对不对：表格用 `table.list` / `table.query` / `table.schema` 按主键查，资源用 `ue_asset` / `ue_find`，导出的 Lua 表读 TableData。
3. **补齐**：缺的照同类已有的一条仿写（写清仿的是哪条）。表格用 `table.edit` 加行改格子（新表复制同类表再改），改完 `table.check`；资源、蓝图用 `ue_asset` / `ue_blueprint`，编译通过再保存；要导表的跑项目的导表命令，然后重开 PIE，用 `ue_get` / `ue_lua` 读一下确认新配置已生效。要策划定的数值（奖励、概率、文案）问用户，不自己编。
4. **不绕过**：缺配置时不在运行时临时把配置指向别的行、不跳过入口直接调玩法函数、不把这一段登记延期了事——那样测到的不是玩家会走的那条路。真补不了（缺美术资源、要服务端）才登记延期，写清缺哪张表的哪一行、用户怎么补。

## 什么时候调函数、什么时候走界面

- **准备状态**（等级、道具、任务进度、存档、时间、生成 NPC、传送到附近）：用项目接口或 GM，不要走一长串界面去凑。测试的是后面那段玩家流程。
- **被测的操作本身**：按正常游戏流程走输入和界面（`key` 按交互键、`click` 对话选项和按钮、`type`、`drag`），这样才测到交互触发、对话选项、按钮绑定、界面刷新、Lua 回调。被测链路上的函数（开始玩法、选择、结算这类）**不直接调**，也不在项目接口的事件回调里替玩家操作。某一步确实还没有界面（界面没做）时才调门面函数，并在报告里写明「这一步跳过了界面层」和原因。
- **检查结果**：两头都看——数据（`@ps.Gold`、子系统里的值、项目接口的只读查询）和界面（文字、数量、红点是否消失）。只看界面会漏数据没存，只看数据会漏界面没刷新。
- 项目里还没有合适的接口：在项目接口文件夹里加一个（下面的示例），别用 `ue_lua` / 控制台临时拼一段代码塞进脚本。

## 项目接口

接口按文件夹认（GameTest 设置 →「接口库」可以改文件夹，存在场景根 `_settings.json` 的 `api`）：

- **Lua**：Lua 脚本根下 `GameTestApi` 文件夹（默认）里的模块，**模块函数**（`function M.Fn`，不是 `M:Fn`）就是接口，名字 `项目.<模块名>.<函数名>`。参数、返回照 EmmyLua 注释，`---@readonly` 的算只读（能当条件）。示例：[reference/lua-api-example.lua](reference/lua-api-example.lua)。
- **C++**：`Source/**/GameTestApi` 下蓝图函数库的 `static BlueprintCallable` 函数，`BlueprintPure` 算只读，`WorldContext` 自动填。示例：[reference/cpp-api-example.h](reference/cpp-api-example.h)。
- 接口只做「准备状态」和「只读查询」，**逻辑写在接口里，脚本只做编排**。不在接口里调被测链路上的函数、不订阅事件替玩家操作（例如收到「可以出招」就同帧选一个）、不在运行时改配置表的值；这些都会让测试绕过玩家真正走的那条路。参数只用能构造的类型（整数、浮点、布尔、字符串、枚举、简单结构体、数组）；对象参数传引用（`objects` 里的名字或 `$var`）。
- 写完 Lua 接口跑一次 `action=look what=api query=<模块名>`，面板会重扫并写进场景根 `_api.json`；`validate` 认得 `_api.json` 里的名字。
- 用户的 UnLua 是二次开发版：Lua 里取游戏对象、调 C++ 的写法照项目里已有代码抄，不要套官方 UnLua 的 API。

## 用项目的 GM（GameTest 2.3.0）

- **执行 GM**：`{"action": "gm.run", "gm": {"kind": "cpp|lua|custom|macro|console", "name": …, "args": …}, "saveAs"?: …}`，`gm` 照 GM 页的条目写（C++ 带 `owner`，自定义 GM 的 `name` 是它的 id，宏是宏 id）。面板存盘、运行前按 GM 库展开成 `run` 步骤，**`run` 不要手写**。C++ GM、自定义 GM 的参数能写 `$变量` / `=表达式`；Lua、控制台的参数会拼进代码，只能写常量。
- 用户刚在 GM 页点过、想写进测试：`look what=gmRecent` 直接给出 `gm.run` 步骤，照抄就行。
- **附带 GM**：一步要在前后顺手跑 GM（发道具、打日志、截图）时挂 `hooks`：`{"before": [...], "after": [...], "fail": [...]}`，每项是一个 `gm.run`，可加 `once: true`（循环里只第一次）和 `onError: "fail"`（默认 `note`：出错只记一笔、报告标 `warn`、不算失败）。`after` / `fail` 里能用 `$ret` 拿到这一步 `saveAs` 的值。准备状态的主线步骤别藏进 hooks，写成正常步骤。

## 结合真实工作的写法

- **刚改的界面功能**（例：背包加了「一键出售」）：`api` 发几件可售道具 → 记 `$gold0` 和背包列表的 `@:count` → 打开背包、点一键出售、确认 → `assert` 金币涨了、`@:count` 少了、`Log.Errors` 为空。
- **Lua 逻辑改动**（例：任务追踪改了排序）：`vars scope=lua module=…` 找存数据的表 → 用 Lua 接口造几条不同状态的任务 → 打开追踪栏 → `loop each: {"obj": "tracker", "part": "List"}` 逐条检查（条目在 `$item`，读 `prop($item, "@item#questId")`），`assert expr` 比较相邻两条。
- **引导、弹窗打断**：写全局守护，`when` 用 `@:onScreen` 的对象判断，`do` 调 `common/翻完引导` 或 `obj.close`；主流程照常写，不为它加分支。
- **翻页数不固定**：`loop until` + `max`，条件挑「最后一页才出现 / 才可点」的部件状态或 Lua 字段（`@#isLast`），别写死次数。
- **列表里找某一条**：写条目引用 `{"class": 条目类, "in": {"obj": 界面, "part": "List"}, "ident": [{"prop": "@item.ItemId", "op": "eq", "value": 1001}]}`，不按第几个找；字段从 `props`（条目类、条目数据那一组）里挑。
- **切地图、加载**：`api Wait.Loading` 或 `obj.wait` / `wait until=cond`，不写固定秒数。
- **随机结果**（抽卡、掉落）：开头 `api Random.Seed`，或用接口把结果固定；检查只看「数量对、类型在范围内」，不比具体值。
- **多端**（服务器 + 客户端）：同步属性在服务器读改（引用写 `client: "server"`），界面在客户端看。

## 用日志和快照点分析代码

只看事件数对不对，测不出代码走的路对不对。每次跑都要对照代码：

1. **跑之前打点**：按「排正常流程」里写的「每一步触发哪个函数」，在入口、状态切换、判定、结算这些关键函数和分支上加 Lua 快照点：`ue_lua action=snap file=<文件或模块名> line=<行> hits=<次数>`（不暂停游戏，命中时记局部变量和调用栈）。C++ 用 `ue_vs_breakpoints action=add` 带 `message` 的日志断点（不停下），要停下看现场再用普通断点（见 ue-runtime-debug 技能）。
2. **跑完看记录**：`ue_lua action=snap id=<快照点>` 看每次命中的局部变量和调用栈，`ue_log action=tail pie=true` 看这次 PIE 的日志（Lua 报错、Warning、项目自己打的日志）。
3. **写结论**：每个测试点写「实际调用顺序 + 关键值」和模块文档的时序比对：对的写「符合」，不对的写现象、快照点或日志原文，判断是功能 bug 还是配置问题。没命中的快照点说明那段代码没走到，要查前一步为什么没触发。
4. **收尾**：撤掉自己加的快照点（`ue_lua action=snap remove=true`）和 VS 断点，别留给用户。

## 失败了怎么判断

| 现象                                               | 多半是                               | 怎么改                                                                                                     |
| -------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `ref_not_found` / 等对象超时，截图里界面根本没打开 | 前一步没触发（按钮绑定、条件不满足） | 看前一步的 `payload` 和日志；是功能问题就报给用户                                                          |
| 截图里界面开着，但 `ref_not_found`                 | 类名或标识写错、条目的 `in` 不对     | `props` 看实际的值，`payload.ref.candidates` 看候选；标识值不对就改值，类不对就照 `widgets` / `inspect` 改 |
| `part_missing`                                     | 部件名写错、部件在嵌套 WBP 里        | `widgets` 重读，嵌套用 `Header.BtnClose`                                                                   |
| `ref_ambiguous`                                    | 标识不唯一                           | 照报错里的建议多加一个属性，或加 `near`                                                                    |
| `op_type`                                          | `op` 和属性类型对不上                | 按 `props` 的 `kind` / `opsByKind` 换 `op`                                                                 |
| 条件时成时不成                                     | 界面刚打开数据还没刷                 | 加大 `settleMs`；反面判断只在所在界面已在屏上时才算                                                        |
| 被引导、公告挡住                                   | 缺守护                               | 加守护，不要加 `wait seconds`                                                                              |
| `close_failed`                                     | `how` 里的方式都没关掉               | 看 `payload.close` 每种方式的结果，换一种或在 `closeRules` 定好                                            |
| 断言实际值不对、日志里有 Error / Lua 报错          | 功能 bug                             | 给用户看证据（步骤、实际值、快照点记录、日志行、截图），说明判断                                           |
| 交互没反应、对话没出现、选项点了不进玩法           | 前置配置缺失或不对                   | 回头查前置清单那几项（表格行、剧情、状态蓝图），补齐、导表、重开 PIE 再跑                                  |

报告里每一条结论都要有证据：哪一步、实际值、日志行或截图路径。不确定是 bug 还是脚本问题时说清楚还要确认什么。

## 测编辑器里的操作（editor.\*，GameTest 1.11.0）

要验证的是编辑器工具（资产编辑器按钮、细节面板、编译保存流程），不是游戏玩法时，用 `editor.*` 动作，只在开着界面的 UE 编辑器里跑、不开 PIE：

- `editor.open`（`asset` 或 `map`）、`editor.select`（`actors` / `assets`）、`editor.prop`（`object` + `path` + `value`，可撤销）、`editor.spawn`（`class` + `label`）、`editor.save`、`editor.compile`；
- `editor.command`（`name` 写 `上下文.命令`，`asset` 指在哪个资产编辑器里执行；或 `console`）；`editor.click` 按停靠页 `tab`、`widget`、`text`、`nth` 点界面，能用命令就别用它；
- `editor.assert`：`check` = `compiled` / `saved` / `open` + `asset`，或按 `widget` 检查界面上有某个控件。
- 关卡里的 Actor 写 `actor:<大纲里的标签>`，组件写 `actor:<标签>/<组件名>`；资源写对象路径。

## 录制「整理成流程」

录制出来的是一个 `group`（平铺步骤），引用已经是 v5 写法。整理时规则先找出这些模式，你在此基础上补充命名、提子脚本、挑条件：

- 同一个对象在好几步里出现 → 提进顶层 `objects` 起个名字；
- 连续按同一个键 / 点同一个按钮 N 次 → `loop until …`（条件挑循环后那一步的部件变得能点、或界面关掉），`max` 给 N 的 3 倍以上；
- 中途弹出又被关掉的界面 → 守护（全局的写进 `_settings.json`），`do` 用 `obj.close`；
- `skipIf` 带 `also` 的几步、「看情况点不同按钮」→ `if` / 按状态分支；
- 和已有脚本一样的一段 → `call` 那个脚本；
- 输入的固定值（账号、数量、Id）→ `params`。

结果是改动列表（`gametest-tidy` 代码块，格式见提示词），用户逐条勾选后才写回；步骤 `id` 不变，原录制备份成 `.json.bak`。

## 不许做的事

- 不改别人录的段、别人写的脚本的行为（只在整理、修复时改，并说明改了什么）；不删别人的回归脚本。
- 不用 `disabled`、`onFail: continue`、放宽断言、删掉检查、改成 `many: "first"` 来让失败「通过」。跑不过就报告。
- 不用 `ue_lua` / 控制台把逻辑塞进脚本绕过接口库；不用表达式调会改状态的函数。
- 不在接口或脚本里直接调被测链路上的函数、替玩家操作、运行时改配置来绕开缺的前置配置；缺什么先补什么。
- 不写固定等待（`wait seconds`）代替条件；`click` 本身会等部件可点。
- 不写 v3 的选择器字符串（`WBP_X:Root/Btn`、`List[Data.Id=1]>Btn`）、`invoke`、`find`、`widget.close` / `widget.call`、`text(sel)` 这类按选择器的函数，都不认。
- 不编类名、部件名、属性路径、接口名：都从 `widgets` / `props` / `vars` / `api` 的返回里抄。
