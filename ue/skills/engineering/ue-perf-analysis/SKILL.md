---
name: ue-perf-analysis
description: 用面板 UE 插件的 ue_perf 和 ue_capture 工具排查 Unreal Engine 的性能和内存问题：抓 CSV Profiler 帧数据和 memreport 内存报告，看摘要、定位卡顿帧和涨得多的指标、对比两份抓取查内存泄漏。用户说卡、掉帧、帧率低、内存高、内存泄漏，或者给了一份 .csv / .memreport 要分析时使用。
user-invocable: true
---

# UE 性能和内存分析

`ue_perf` 对着正在运行的 UE 发起抓取，`ue_capture` 分析抓到的文件（UE 关了也能分析）。两个工具都有 `action=help`，参数记不清就查。

原始文件不要自己去读：一份 CSV 几十 MB、一份 memreport 几 MB，读进来既放不下也看不准。永远是 `summary` → `query` 逐层下钻。

## 先分清是哪类问题

| 用户说的 | 抓什么 |
| --- | --- |
| 某个操作卡一下、偶尔掉帧 | CSV，操作前后打书签 |
| 一直帧率低 | CSV，录 10 到 20 秒就够 |
| 内存高、越玩越高、怀疑泄漏 | 两份 memreport 对比 |
| 给了一个文件 | `ue_capture action=import path=…`，然后直接分析 |

用户没说清现象时先问一句：什么操作、什么时候、每次都有还是偶尔。不要上来就录很长一段。

## 卡顿和帧率

1. `ue_status` 确认有进程在跑。抓取会影响用户正在玩的游戏，没在跑时问用户要不要启动，不要擅自开 PIE。
2. `ue_perf action=start kind=csv seconds=30 label=<起个名字>`。
3. 让场景发生：能用 `ue_gm` / `ue_console` 触发就自己触发，不能就请用户操作。操作前后各 `ue_perf action=mark name=<名字>`。
4. `ue_perf action=stop`，拿到抓取 id。
5. `ue_capture action=summary id=<id>`，看三样：
   - `key` 里 `GameThreadTime`、`RenderThreadTime`、`GPUTime` 哪个最接近 `FrameTime`，那条线程就是瓶颈；
   - `hitches.count` 和 `worst`：偶发卡顿还是持续慢；
   - `fps` 的平均和最差 1%。
6. 下钻：
   - 卡顿：`action=query what=hitches`。每个卡顿帧的 `spikes` 是那一帧比平时涨得最多的列，`spread` 看卡顿集中在哪个时间段。
   - 某项指标的走势：`what=column name=<列名>`；不知道有哪些列先 `what=columns name=<关键字>`。
   - 操作前后对比：`what=segment`，或者 `from` / `to` 写书签名。
7. 对到代码：列名里的分类和名字（如 `Slate/Tick`、`Exclusive/GameThread/Animation`）在工程和引擎里搜 `CSV_SCOPED_TIMING_STAT`、`CSV_CUSTOM_STAT`。
8. 改完再抓一份，`action=compare id=<改前> other=<改后>` 验证。

CSV 只能说明「哪些帧慢、哪一类慢」。要知道具体哪个函数慢需要 Unreal Insights 的 trace，这个版本还不能在这里分析：把已经确定的范围（哪条线程、哪一类、怎么复现）告诉用户，请用户用 Insights 录一段。

## 内存

1. 到要查的场景之前：`ue_perf action=start kind=memreport label=before`（马上完成，游戏会卡几秒）。
2. 进场景、做操作、再退出来，回到和第 1 步一样的状态。能触发垃圾回收就先触发一次（`ue_console` 执行 `obj gc`，会请用户确认），否则没回收的对象会被当成泄漏。
3. `ue_perf action=start kind=memreport label=after`。
4. `ue_capture action=compare id=before other=after`：`byCount` 是数量涨得最多的类，`bySize` 是大小涨得最多的。回到同一状态后还多出来的 UI 控件、Actor、组件就是嫌疑。
5. 只看一份时：`action=summary` 看平台内存和占用最大的类；`action=query what=objects sort=Count`、`what=textures` 看明细。
6. 找到嫌疑类之后用 `ue_find kind=object class=<类名>` 找活着的实例，用 `ue_get` 看是谁、属于哪。UnLua 项目里常见的原因是 Lua 还引用着已经关掉的界面，用 `ue_get` 的 `lua` 参数看对应的管理器表。

读数：`NumKB` 是对象本身的大小，`ResExcKB` 是对象持有的资源（贴图像素、网格数据）的大小，内存的大头通常在后者。

## 给结论

- 说清瓶颈在哪条线程或哪一类对象，带上证据：哪份抓取、哪一帧或哪一段、哪个数字。
- 区分「数据说明的」和「你推测的」。CSV 里看不到的原因不要编。
- 工具报错原样告诉用户。Shipping 构建没有 CSV Profiler；PIE 里客户端和服务器在同一个进程，抓到的是整个进程的数据。
- 抓到的文件留在项目的 `Saved/Profiling` 下，结束时告诉用户抓了哪几份；要删用 `ue_capture action=delete`（会请用户确认）。
