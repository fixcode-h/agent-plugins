---
name: ue-asset-authoring
description: 用面板 UE 插件的 ue_asset、ue_blueprint 读写 Unreal Engine 的资源和蓝图：看资源内容和引用关系，新建、复制、改名、删除资源，读蓝图的变量、组件和图表，按操作列表改蓝图并编译。要读懂或修改 UE 蓝图、DataTable、DataAsset 这类资源（而不是只读 C++ 代码）时使用。
user-invocable: true
---

# UE 资源与蓝图读写

面板「UE」页接入的项目里，对话有 `ue_*` 工具。资源和蓝图的读写不需要 PIE：编辑器开着就发给编辑器，没开时自动起后台编辑器（不开窗口，首次 30–60 秒）。

所有修改只改内存并标脏，`ue_asset action=save` 才写回磁盘（按权限请用户确认，P4 项目先签出）。

## 地址

- 资源路径写 `/Game/目录/名字`。
- 蓝图有两个面：在 `ue_get` / `ue_set` 里 `/Game/BP_Hero` 是**类默认值**；在 `ue_blueprint` / `ue_asset` 里是**蓝图资源本身**（变量定义、组件树、图表）。
- 图里的节点用 id（8 位十六进制，伪代码每行行尾 `#` 后面那段）；引脚写成 `节点id.引脚名`。

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
5. 给用户说明改了什么，再 `ue_asset action=save`。

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

## 边界

- 现在支持普通蓝图（Actor、组件、对象、函数库、接口）。控件蓝图的控件树、动画蓝图的状态机、材质和行为树的图表还不能用操作列表改；它们的属性仍可以用 `ue_get` / `ue_set`。
- 另一个对话正在改、还没保存的资源会报错。等它保存或放弃，不要换路径或换办法去改同一个资源。
- `ue_python` 是兜底：默认关，每次确认，没有事务和撤回。上面的工具能做的不要用它。
- 工具报错原样告诉用户，不绕过权限。
