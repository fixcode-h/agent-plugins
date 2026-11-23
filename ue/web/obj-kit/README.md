# obj-kit：对游戏里的对象「看成员、调函数、改值、看返回」的共用组件

GM 页的对象调用最先用到，测试页（GameTest 编辑器）等别的页面要同样的能力时直接用这里的，不另写一份（2026-11-22 GM 页梳理时从 `sections/gm/` 挪出来）。
组件只管画和交互，数据从 props 进、动作从回调出；读写 UE 都走 GameTest 的操作（`gt.vars`、`gt.props`、`gt.resolve`、`gt.step`），不经过 GM 页的状态。

| 文件                             | 是什么                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| `MemberPane.tsx`                 | 成员面板：UE（函数 \| 属性）· Lua（函数 \| 变量）· 运行状态；游戏没开时按类列，属性行尾可钉住 |
| `members.ts`                     | 成员数据整形（`gt.vars` / `gt.props` → 函数表、变量表）                            |
| `VarList.tsx`                    | 变量列表（照 UE 细节面板画），选中、读取勾选、钉住                                 |
| `CallForm.tsx`                   | 调用卡：函数签名 + 参数表单（对象参数出下拉、按类型置灰）                          |
| `CallOutput.tsx`                 | 调用输出：返回值树、找到的实例                                                     |
| `SetVarPane.tsx` + `set-prop.ts` | 改值和抓取值                                                                       |
| `InstancePick.tsx`               | 挑实例条：命中多个时只对勾的生效（规则收窄见 `shared/gm/pick.ts`）                 |
| `Pins.tsx`                       | 钉住的属性：值走 `gt.watch` 推送，变了闪一下                                       |

`CallForm` 里参数关联表格、Lua GM 绑定这类 GM 页的东西仍从 `sections/gm/` 取，别的页面不传对应 props 就不出现。
