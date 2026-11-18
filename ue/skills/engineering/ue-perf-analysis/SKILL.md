---
name: ue-perf-analysis
description: 用面板 UE 插件的 ue_perf 和 ue_capture 工具排查 Unreal Engine 的性能和内存问题：录 trace（一步 record）后先 diagnose 拿到排好序的问题和可并行深挖的方向，再按线程、卡顿、Lua、内存、加载下钻（UnLua 项目可以把 Lua 函数一起录进去）；也能抓 CSV Profiler 帧数据和 memreport 内存报告，对比两份抓取查回归和内存泄漏。用户说卡、掉帧、帧率低、内存高、内存泄漏，或者给了一份 .csv / .memreport 要分析时使用。
user-invocable: true
---

# UE 性能和内存分析

`ue_perf` 对着正在运行的 UE 发起抓取，`ue_capture` 分析抓到的文件（UE 关了也能分析）。两个工具都有 `action=help`，参数记不清就查。

原始文件不要自己去读：一份 CSV 几十 MB、一份 memreport 几 MB，读进来既放不下也看不准。trace 永远是 `diagnose` → `query` 逐层下钻，CSV / memreport 是 `summary` → `query`。

## 先分清是哪类问题

| 用户说的                   | 抓什么                                           |
| -------------------------- | ------------------------------------------------ |
| 某个操作卡一下、偶尔掉帧   | trace（record，操作前后打书签）                  |
| 一直帧率低                 | trace 录 10 到 20 秒就够；要跑一整局看走势用 CSV |
| 内存高、越玩越高、怀疑泄漏 | 两份 memreport 对比                              |
| 给了一个文件               | `ue_capture action=import path=…`，然后直接分析  |

用户没说清现象时先问一句：什么操作、什么时候、每次都有还是偶尔。不要上来就录很长一段。

## trace：先诊断，再深挖（首选）

要知道慢在哪条线程、哪个函数、哪类卡顿，录 trace。

1. `ue_status` 确认有进程在跑。抓取会影响用户正在玩的游戏，没在跑时问用户要不要启动，不要擅自开 PIE。
2. 录：
   - 能用命令复现的（GM、控制台命令）：`ue_perf action=record label=<名字> steps=[{"mark":"开始","shot":true},{"gm":"…"},{"wait":5},{"mark":"结束","shot":true}]`，一次调用录完、停止并等分析好。
   - 要人操作的：`action=start kind=trace label=<名字>` → 请用户操作，前后 `action=mark name=<名字> shot=true` → `action=stop` → `action=wait id=<id>` 等分析完。不要反复查 `analyzing`。
   - 预设按问题选（都在标准通道上加）：渲染 `gpu`、加载卡顿 `loading`、内存标签 `memtag`（UE 要 -llm）、网络 `net`、动画 `animation`、任务和线程切换 `task`、对象创建 `object`；蓝图函数名 `named`。谁分配的内存要 UE 用 `-trace=memory` 启动，中途开不了。
3. `ue_capture action=diagnose id=<id>`：一次拿到帧率、瓶颈线程（`bound`）、卡顿按元凶分组、热点、Lua、内存涨幅、日志警告。`findings` 按 `impactMs`（摊到每帧的毫秒）排好序，`drill` 是可以并行深挖的方向。
4. 只有一两个方向时自己下钻；三个以上、或者 trace 很长时按下面「并行深挖」分给子任务。
5. 下钻常用的 `query`（`help` 里有全表）：
   - `what=hitches`：卡顿帧、成簇、是否周期性，每帧 `grew` 是比普通帧涨得最多的计时器，`culprit` 是归的类；
   - `what=frame frame=<帧号>`：一帧的全貌（各线程、瓶颈、涨了什么、附近日志）；
   - `what=bound` / `what=threads`：瓶颈线程分布、各线程每帧平均和 P95；
   - `what=timers lane=<线程> perFrame=true`：某条线程上的热点，按每帧平均比；
   - `what=butterfly timer=<名字>`（谁调了它、它调了谁）、`what=instances timer=<名字>`（每次都慢还是偶尔一次，最慢几次在第几帧）、`what=stack lane=<线程> time=<秒>`（那一刻的调用堆栈）、`what=events frame=<帧号> lane=<线程>`（那一帧时间轴上的块）；
   - `what=counters sort=growth`（一直涨的计数器）、`what=log verbosity=Warning near=<秒>`、`what=memtags` / `allocs` / `loads` / `files` / `tasks` / `switches` / `net`（录了对应通道才有）。
6. 需要自己算（画图、和别的数据对）时 `action=export what=frames|timers|counters|log`，写成 CSV / JSON 文件只回路径，用脚本处理，不要整份读进对话。
7. 独占时间很长、又没有子调用的块，说明它里面的代码没加计时宏，告诉用户该在哪个函数里加 `TRACE_CPUPROFILER_EVENT_SCOPE` 再录一次。
8. 改完复测：同样的步骤再录一份，`ue_capture action=compare id=<改前> other=<改后>`（按每帧平均比，`from` / `to` 写书签名对齐同一段），看 `worse` / `better` 和卡顿元凶的次数。

桥接版本旧、或者编辑器和后台编辑器都没开（后台编辑器默认不自动起）时会报错，原样告诉用户。分析用的 UELink 低于 2.11 时 `diagnose` 照样能用（面板兜底，结果带 `approx`），`session` 以后的几类查询会提示升级。

## 并行深挖

`diagnose` 的 `drill` 每项是一个方向（`focus`：game 游戏线程 / render 渲染和 GPU / hitch 卡顿 / lua / memory 内存 / loading 加载），两个以上时用 `spawn_agents` 一次派出「UE 性能深挖」子任务，每个方向一个，不设上限：

- `params` 写 `{"focus": "<方向>"}`；
- 说明里写清：抓取 id、范围（`from` / `to` 或帧号）、`diagnose` 里这个方向的发现（原样贴 `why` 和相关 `findings`）；
- 子任务只分析、不录制、不改代码，按固定格式交回（结论、证据、源码位置、建议、还没确认的）。

都回来后汇总：去重（同一个函数被两个方向都点到的合成一条）、按 `impactMs` 排序、互相矛盾的再查一次。

## CSV：长时间走势、不需要函数时

1. `ue_perf action=start kind=csv seconds=30 label=<起个名字>`，操作前后 `mark`，`action=stop`。
2. `ue_capture action=summary id=<id>`：`key` 里 `GameThreadTime`、`RenderThreadTime`、`GPUTime` 哪个最接近 `FrameTime` 就是瓶颈；`hitches` 和 `fps`。
3. `query what=hitches`（每个卡顿帧的 `spikes`）、`what=column name=<列名>`、`what=segment` 或 `from` / `to` 写书签名。
4. 列名里的分类和名字在工程和引擎里搜 `CSV_SCOPED_TIMING_STAT`、`CSV_CUSTOM_STAT` 对到代码。

CSV 只能说明「哪些帧慢、哪一类慢」，要知道具体哪个函数用 trace。

## Lua（UnLua 项目）

Lua 函数和 UE 的作用域录在同一份 trace 里（UELink 2.9 起），能看出哪一帧慢、慢在哪个 Lua 函数、它是从哪个 UE 回调（Actor Tick、动画更新、UI 事件）进来的。

1. `ue_perf action=start kind=trace lua=true`，和任何 `preset` 叠加。不写 `lua` 时按项目设置（装了 UnLua 默认开）。`lua=true` 时 C 函数（`UE.GetVelocity` 这类 UE 接口、`string.format` 这类库函数）单独成块；调用特别密集、只想看 Lua 结构时用 `lua="noc"`，C 函数的时间算进调用它的 Lua 函数，trace 也更小。返回里有 `luaNote` 就是没录上 Lua（UELink 太旧、项目没装 UnLua），原样告诉用户。
2. 停止后 `summary` 带 `lua: true` 时：
   - `query what=timers lua=true`：只看 Lua 计时器，每行的 `src` 是 `文件:行`，直接去读那段源码；C 函数标 `c: true`。加 `mergeC=true` 把 C 函数的时间并进调用它的 Lua 函数，看「这个 Lua 函数连同它调的 UE 接口一共花多少」。
   - `query what=tree luaOnly=true`（可加 `frame` 或 `from` / `to`）：从最外层的 Lua 函数往下的调用树，每层只留最热的几支；要细看某一支，用它的 `id` 当 `root` 再查。`root=<UE 计时器名>`（如 `UWorld::Tick`）也能从 UE 作用域往下看。
   - `query what=butterfly timer=<Lua 函数名>` 的 `callers` 看它是从哪个 UE 回调进来的。
3. 读数时注意：录 Lua 时 Lua 会变慢一些（每次调用多一个事件），看占比、看谁最重，不看绝对毫秒数。IDE 的 Lua 调试器连着时录不到 Lua，先断开。
4. `ue_lua action=profile` 只有按函数平铺的总表，看不出哪一帧、谁调了谁，只在 UELink 低于 2.9、录不了 Lua trace 时临时用。

## 内存

1. 到要查的场景之前：`ue_perf action=start kind=memreport label=before`（马上完成，游戏会卡几秒）。
2. 进场景、做操作、再退出来，回到和第 1 步一样的状态。能触发垃圾回收就先触发一次（`ue_console` 执行 `obj gc`，会请用户确认），否则没回收的对象会被当成泄漏。
3. `ue_perf action=start kind=memreport label=after`。
4. `ue_capture action=compare id=before other=after`：`byCount` 是数量涨得最多的类，`bySize` 是大小涨得最多的。回到同一状态后还多出来的 UI 控件、Actor、组件就是嫌疑。
5. 只看一份时：`action=summary` 看平台内存和占用最大的类；`action=query what=objects sort=Count`、`what=textures` 看明细。
6. 找到嫌疑类之后用 `ue_find kind=object class=<类名>` 找活着的实例，用 `ue_get` 看是谁、属于哪。UnLua 项目里常见的原因是 Lua 还引用着已经关掉的界面，用 `ue_get` 的 `lua` 参数看对应的管理器表。

读数：`NumKB` 是对象本身的大小，`ResExcKB` 是对象持有的资源（贴图像素、网格数据）的大小，内存的大头通常在后者。

## 给结论（报告格式）

写成报告时按这个顺序（工作流里写到项目文档根的 `perf-reports/<日期>-<场景>.md`）：

1. 结论一句话：瓶颈在哪、最该先改什么。
2. 数据：抓取 id、场景和范围、帧率（平均 / P95 / 1% low）、瓶颈线程分布、卡顿次数。
3. 问题列表：按 `impactMs` 从大到小，每条写证据（哪一帧 / 哪一段、哪个计时器多少毫秒）、源码位置、建议的改法。
4. 还没确认的：推测、需要再录什么才能确认。

- 说清瓶颈在哪条线程或哪一类对象，带上证据：哪份抓取、哪一帧或哪一段、哪个数字。
- 区分「数据说明的」和「你推测的」。CSV 里看不到的原因不要编。
- 工具报错原样告诉用户。Shipping 构建没有 CSV Profiler；PIE 里客户端和服务器在同一个进程，抓到的是整个进程的数据。
- 抓到的文件留在项目的 `Saved/Profiling` 下，结束时告诉用户抓了哪几份；要删用 `ue_capture action=delete`（会请用户确认）。
