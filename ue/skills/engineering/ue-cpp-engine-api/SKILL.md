---
name: ue-cpp-engine-api
description: 写或改调用 Unreal Engine 引擎 API 的 C++（新调用一个引擎类的函数、加 include、改 Build.cs 依赖、override 引擎虚函数、要同时兼容几个引擎版本）之前，以及编译报「不是成员 / 找不到标识符 / 参数个数不对 / 链接找不到符号」（C2039、C3861、C2065、C2660、C2664、LNK2019、LNK2001）时使用：先按项目用的引擎版本查真实的签名、头文件和模块，再写，不凭记忆写接口名。格式规范看 cpp-code-style。
user-invocable: true
---

# UE C++：引擎 API 先查后写

写 UE C++ 最常见的返工是凭记忆写引擎 API：函数名、参数个数和类型、在哪个头文件、属于哪个模块、5.4 和 5.8 之间改没改。每猜错一次就是一整轮编译。这个技能只管「接口对不对」，格式和命名照 `cpp-code-style`。

面板在对话开头会写明**本项目用的引擎版本和引擎源码目录**（「UE C++ 引擎」那一节）。下面说的「引擎源码」都指那个目录，别的版本的记忆不算数。

## 什么时候必须先查

- 第一次在这次改动里调用某个引擎类（`AActor`、`UGameplayStatics`、`FSlateApplication`……）的函数，或者用一个没在本项目里用过的引擎类型。
- 写 `override`：引擎虚函数的签名（参数、`const`）各版本常改。
- 加 `#include`、往 `Build.cs` 加模块依赖。
- 编译报了下面「编译报错时」里的那几类错误。

项目里已经有同样写法、并且能编过的调用，照着它写就行，不用再查一遍。

## 怎么查（按顺序，查到就停）

1. **项目接了 UEToVS（VS 的代码索引，工具名不带前缀）时用它**，它读的就是这个项目用的引擎源码：
   - 看一个类有哪些成员和签名：`get_members type_name=AActor`（要基类的一起列：`include_inherited=true`；只看蓝图可调的：`ue=["UFUNCTION"]`）。
   - 找一个函数或类型在哪、按名字模糊搜：`search_symbols query=GetActorBounds scope=all`（`scope=all` 才包括引擎和引擎插件，默认只搜项目）。
   - 跳到定义或声明：`go_to_definition symbol=UGameplayStatics::GetPlayerController`（`kind=declaration` 先看头文件里的声明）。
   - 该 include 哪个头、Build.cs 加哪个模块：`suggest_include type=UUserWidget`（可带 `from=<要加 include 的文件>`）。
   - 一个模块的依赖、头文件能不能直接 include：`get_module_info module=UMG header=Blueprint/UserWidget.h`。
   - 反射信息（UFUNCTION 标记、蓝图可不可调）：`get_reflection_info`。
2. **没有 UEToVS、或者它说索引没好**：用 `rg` 在引擎源码里搜，限定目录，别从引擎根往下全搜：
   - 先定位头文件：`rg -l "class ENGINE_API AActor\b" "<引擎>/Engine/Source/Runtime/Engine/Classes"`。
   - 再在那个头文件里搜函数：`rg -n "GetActorBounds" <头文件>`，读声明那几行，看参数、`const`、默认值、`UE_DEPRECATED`。
   - 模块名看头文件所在目录的 `*.Build.cs`；引擎插件里的类在 `<引擎>/Engine/Plugins/...`，还要在 `.uplugin` 里依赖那个插件。
3. **引擎源码目录不存在或面板没给**（引擎没装源码、路径没找到）：说明查不到，请用户确认引擎目录（UE 页「权限与设置」里可以手动指定）或贴出头文件里那几行，不要凭记忆写。

查到以后，回复里写一行「查过：`<类::函数>` 在 `<头文件>`，签名 `<签名>`」，评审和后面的子对话不用再查。

## 要兼容几个引擎版本时

项目（或插件）要同时支持几个引擎版本时（例如 UEKit 的插件同时支持 5.4 和 5.8）：

- **每个版本的头文件都查**：面板开头的说明会列出本机装的其他引擎版本和目录，在每个版本的源码里各查一次；本机没装的版本，查不到就说明，并在提交说明里写清「只在 X 版本上查过」。
- 两边签名不一样时，差异**只写在 `<插件或模块>Compat.h`**：用 `ENGINE_MAJOR_VERSION` / `ENGINE_MINOR_VERSION` 或 `UE_VERSION_NEWER_THAN` / `UE_VERSION_OLDER_THAN` 包成自己的宏或内联函数，业务代码只调它。Build.cs 里按 `Target.Version` 判断。
- 默认写较老那个版本的写法；新版本才有的接口只在查过那个版本的头文件后用，中间版本不猜。
- 新版本标了 `UE_DEPRECATED` 的旧接口：先查新版本推荐的替代写法，两边都能编的用同一份，不能的放进 Compat.h。

## 编译报错时

| 报错                                                                                                                  | 意思                                                                                                                      | 先做什么                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| C2039 `'X': is not a member of 'Y'`（clang：`no member named 'X' in 'Y'`）                                            | Y 上没有叫 X 的成员：名字记错、在基类或别的类上、这个版本改名了                                                           | `get_members type_name=Y include_inherited=true`，或在 Y 的头文件里 `rg X`                                                      |
| C3861 / C2065 `identifier not found` / `undeclared identifier`（clang：`use of undeclared identifier`）               | 名字没声明：少了 include，或者根本没有这个函数                                                                            | `search_symbols query=X scope=all` 找到它在哪，再 `suggest_include`                                                             |
| C2660 `function does not take N arguments`、C2664 `cannot convert argument`（clang：`no matching function for call`） | 参数个数或类型对不上                                                                                                      | `go_to_definition symbol=X kind=declaration` 看真实参数表                                                                       |
| LNK2019 / LNK2001 `unresolved external symbol`（clang：`undefined reference`）                                        | 头文件找到了，但链接不到：Build.cs 少了模块依赖，或者那个函数没导出（类和函数上都没有 `XXX_API`，只能在它自己的模块里用） | `suggest_include type=<类>` 看模块，补 `PublicDependencyModuleNames` / `PrivateDependencyModuleNames`；没导出的换一个导出的接口 |

面板在编译失败的结果里认出这几类错误时，会把涉及的符号列出来提醒你先查定义。**不要换个名字、加个参数再编一次碰运气**：先查到真实签名，再一次改对。查不到就停下来告诉用户缺什么。

## 不要做的

- 不要从网上、别的引擎版本或记忆里抄签名：以项目用的那个引擎源码为准。
- 不要为了绕开编译错误改引擎源码、复制引擎的私有实现、或者用 `#pragma` / 强转把签名硬凑上。
- 不要把版本判断散在业务代码里（写进 Compat.h）。
