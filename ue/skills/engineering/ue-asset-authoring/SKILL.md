---
name: ue-asset-authoring
description: 用面板 UE 插件的 ue_asset、ue_blueprint 读写 Unreal Engine 的资源和蓝图：看资源内容和引用关系，新建、复制、改名、删除资源，读蓝图的变量、组件和图表，按操作列表改蓝图并编译。要读懂或修改 UE 蓝图、DataTable、DataAsset 这类资源（而不是只读 C++ 代码）时使用。
user-invocable: true
---

# UE 资源与蓝图读写

面板「UE」页接入的项目里，对话有 `ue_*` 工具。资源和蓝图的读写不需要 PIE：编辑器开着就发给编辑器，没开时走后台编辑器（不开窗口，首次 30–60 秒）。后台编辑器默认不自动起：报「后台编辑器默认不自动启动」时，确实要读写资源就 `ue_editor action=background_start` 起一个，或请用户打开编辑器；编译和启动编辑器时面板会自动关掉它。

所有修改只改内存并标脏，`ue_save` 才写回磁盘（按权限请用户确认，P4 项目先签出）。

## 地址

- 资源路径写 `/Game/目录/名字`。
- 蓝图有两个面：在 `ue_get` / `ue_set` 里 `/Game/BP_Hero` 是**类默认值**；在 `ue_blueprint` / `ue_asset` 里是**蓝图资源本身**（变量定义、组件树、图表）。
- 图里的节点用 id（8 位十六进制，伪代码每行行尾 `#` 后面那段）；引脚写成 `节点id.引脚名`。

## 多个资源做同一件事：一次调用

对一批资源做同样的读或改（读几个蓝图的大纲、给一批蓝图的同一个组件改属性、编译一批蓝图），**只调一次工具**，不要一个资源调一次，也不要并行发十几次：

- `paths=[...]` 给全部路径；或 `select={path, class, parent, tags}` 按条件选，关卡里的 Actor 用 `select={kind:"actor", class, tag}`。
- 例：一批蓝图的根组件改成静态：`ue_set paths=["/Game/A.A_C:DefaultSceneRoot_GEN_VARIABLE", "/Game/B.B_C:DefaultSceneRoot_GEN_VARIABLE"] prop=Mobility value="Static"`；路径规律一样时用 `select` + `items` 里的 `{name}` 占位符。
- 一个蓝图里多个组件改同一个属性：`ue_blueprint action=edit` 的 `setProperty` 给 `name` 名字数组、通配符或 `componentClass`，多个属性用 `props`。
- 写操作先整批演练，全部通过才真改，失败自动撤回整批；`where` 只改当前值对得上的；`retry=<上一批作业号>` 只重做没成的；改完 `ue_save compile=true` 先编译再保存。
- 报「UELink 不支持批量」时才逐个调，并提醒用户在 UE 页升级 UELink 到 2.14 后本地编译。

## 读：由粗到细

1. `ue_find kind=asset` 找资源；`ue_asset action=describe` 看类、文件、标签、引用数量；`action=refs` 看它用了谁、谁用了它。
2. `ue_asset action=export` 取整份属性和内嵌子对象（大资源用 `file=true` 写成文件再读）。
3. 蓝图：`ue_blueprint action=outline` 看父类、变量、组件、各张图和编译状态。
4. `ue_blueprint action=graph graph=<图名>` 读伪代码，一个节点一行。`@id.引脚` 指某个带执行线的节点的输出。
5. 准备改图时再取 `format=json`（节点和引脚连线），`around=<节点id>` 只取周围几跳，`node=<节点id>` 看一个节点的全部引脚。
6. `ue_find kind=node query=<函数名 / 变量名>` 跨蓝图搜节点。它要逐个加载蓝图，`partial=true` 说明没扫完，缩小 `path` 目录再搜。

读懂之后再动手。没读过的图不要改。

## 改蓝图：操作列表

`ue_blueprint action=edit` 的 `ops` 是一组操作，整批在一个编辑器事务里执行，任一步失败整批取消。只发改动，不整图替换。

工作循环：

1. `outline` + `graph` 读要改的部分。
2. 要放的节点不是 `call / get / set / branch / sequence / cast / self / event / custom_event / macro` 这几种时，先 `action=node_search query=<关键字>` 拿 `spawner`。
3. `edit` 带 `dryRun=true` 演练：真实执行并编译，返回每步结果和编译错误，然后取消。
4. 演练没问题再正式 `edit`。返回里 `compile.nodes` 是挂在节点上的错误（带图名和节点 id），`compile.messages` 是编译器原话，`compile.affected` 是受影响的子类和调用方。有错按节点 id 接着修，不要重来一遍。
5. 保存前 `ue_compile path=<蓝图>` 确认编译通过（结果算进对话的完成依据，没通过时对话不能结束）。`ue_save` 之后面板还会自动编译刚保存、没确认过的蓝图，有错会补一条【UE】说明，照它按节点 id 修。
6. 给用户说明改了什么，再 `ue_save packages=[...]`。

一批操作的例子（BeginPlay 时把 HP 设成 MaxHP，再打印一句）：

```json
[
  { "op": "add_variable", "name": "HP", "type": "float", "category": "Stats" },
  { "op": "add_node", "kind": "event", "name": "BeginPlay", "as": "begin" },
  { "op": "add_node", "kind": "set", "variable": "HP", "as": "setHp" },
  { "op": "add_node", "kind": "get", "variable": "MaxHP", "as": "max" },
  {
    "op": "add_node",
    "kind": "call",
    "function": "KismetSystemLibrary.PrintString",
    "as": "print",
    "pins": { "InString": "ready" }
  },
  { "op": "connect", "from": "begin.then", "to": "setHp.exec" },
  { "op": "connect", "from": "max.MaxHP", "to": "setHp.HP" },
  { "op": "connect", "from": "setHp.then", "to": "print.exec" }
]
```

要点：

- `as` 是这一批里的临时名，同一批后面的操作用它引用新节点；下一批要用返回的节点 id。
- 引脚名以节点为准：`add_node` 的结果里列出了这个节点所有引脚，`exec` / `then` / `self` / `return` 是通用别名。
- 连线和手动拖线走同一个检查。连不上时返回的是编辑器给的原因，按原因改，不要换个写法硬试。类型不完全一样时编辑器会自动插转换节点，结果里的 `note` 会说明。
- 位置不用管，自动排；要整理时用 `move` 或 `comment`（给 `nodes` 时注释框套在这些节点外面）。
- 新加的变量在同一批里就能 `get` / `set`；类默认值用 `set_default`，组件模板用 `set_component`。

## 新建、复制、改名、删除

都在 `ue_asset`，先 `dryRun=true` 看会发生什么：

- `create`：`class` 默认 Blueprint（给 `parent`）；DataTable 给 `rowStruct`；DataAsset 子类、曲线直接给类名。
- `rename`（也用来移动）：返回引用它的资源列表，引擎会一起改；`redirector=true` 说明有引用方没改到，留了重定向器。
- `delete`：有引用方时拒绝并列出。先改掉引用；确实要强删才 `force=true`，并且要向用户说明哪些资源会断开。删除每次都会请用户确认。

## 撤回和保存

- 没保存前：`ue_undo` 列出本对话的修改，从最近的一步开始按顺序撤；中间用户在编辑器里做了别的修改时会拒绝，这时告诉用户，不要绕过去。
- 整个不要了：`ue_asset action=revert`。新建、复制、改名、删除不能自动撤回。
- `ue_asset action=dirty` 看有哪些没保存；保存前把改动讲清楚。

## MCP 还是 Python

**默认用 `ue_*` 工具，批量也一样**：一批（≤2000 个）就是一次调用，和一个 Python 脚本来回次数相同，还带演练、整批撤回、改前改后对比、编译通过才存、P4 签出和改动记录。Python 要写代码、5.4 / 5.8 的 API 有差异，常常试错几轮，实际更慢。

一律用工具：改属性和类默认值（`ue_set`）、DataTable 行（`ue_asset`）、蓝图变量 / 节点 / 组件（`ue_blueprint`）、新建复制改名删除（`ue_asset`）、编译保存、运行中游戏里的读改调、AssetForge 管着的资产（改配置）。

只有这些情况写 `ue_python`，并在回复里一句话说明为什么工具不行：

1. 工具没有的编辑器能力：导入 / 重新导入外部文件；资源上的编辑器函数（LOD、碰撞、Nanite、贴图压缩、合并重定向器）；材质图、控件树、动画状态机、行为树、Sequencer；关卡里 spawn / destroy 以外的批量编辑。
2. 超过 2000 个资源。
3. 每项的值要复杂计算，而且没法「一次批量读 → 算好 → `items` 一次批量写」（先试这条路）。
4. 只读的全项目统计（用 Asset Registry，不加载资源）。只读脚本不受下面 2–4 条限制。

写 Python 必须做到：

1. 顶部 `DRY_RUN = True` 先演练，只打印每项「资源、改前、改后」，没问题再改成 `False` 跑同一份。
2. 修改都放在 `with unreal.ScopedEditorTransaction("Agent: <做什么>"):` 里，改前 `obj.modify()`。
3. 不保存、不碰源码控制、不 `rename_asset` / `delete_asset`：改完 `ue_asset action=dirty` 看脏包，再 `ue_save compile=true`。
4. 开始前 `ue_asset action=dirty`，已经脏、不是本对话改的包传进脚本跳过。
5. 每项 `try/except` 记下原因继续，结尾只打印一行 JSON `{changed, failed:[{path,error}], skipped}`；明细超过 4000 字写到 `Saved/AgentPanel/py-out/<名字>.json`，只打印路径。
6. 超过 1 分钟用 `unreal.ScopedSlowTask`，按 500 个一批分几次调（单次上限 600 秒，期间编辑器卡住，先告诉用户）。
7. 不确定的 API 先用小脚本 `print(dir(unreal.X))` 查，不要猜。
8. 告诉用户改了哪些资源，以及这次不能 `ue_undo`（没保存前用编辑器撤销或 `ue_asset action=revert`）。

## 边界

- 现在支持普通蓝图（Actor、组件、对象、函数库、接口）。控件蓝图的控件树、动画蓝图的状态机、材质和行为树的图表还不能用操作列表改；它们的属性仍可以用 `ue_get` / `ue_set`。
- 另一个对话正在改、还没保存的资源会报错。等它保存或放弃，不要换路径或换办法去改同一个资源。
- `ue_python` 是兜底，什么时候能用、用时必须做到什么见上一节。
- 工具报错原样告诉用户，不绕过权限。
