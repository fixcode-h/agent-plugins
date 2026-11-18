// GameTest 项目 C++ 接口示例（放在 Source/<模块>/GameTestApi/ 下，例如 Source/Demo/GameTestApi/QuestTestLibrary.h）。
// 编辑器里的 GameTest 在启动、编译、Live Coding 后扫这个文件夹里蓝图函数库的 static 函数，写进场景根 _api.json 的 cpp 段。
// 接口名是「项目.<类名去掉 U 前缀和 Library 后缀>.<函数名>」：UQuestTestLibrary::AcceptQuest → 项目.QuestTest.AcceptQuest。
//
// 认的规则：
// - UBlueprintFunctionLibrary 子类里的 static + BlueprintCallable / BlueprintPure 函数；BlueprintPure 算只读（能当条件）。
// - 函数上面的注释是说明，Category 是分类，DisplayName 只是显示名（不改接口名）。
// - WorldContextObject 参数（meta=(WorldContext=...)）GameTest 自动填当前世界，脚本里不用写。
// - 参数只用能构造的：bool、整数、浮点、FString / FName / FText、枚举、FVector 这类简单结构体、数组；
//   UObject 参数只能传脚本里找到的对象（{"$obj": …} 或 $var）。委托、接口指针这类会列进「没认出来的」。
// - 只在测试里用的接口，模块放进 Editor / DeveloperTool 类型或加 #if !UE_BUILD_SHIPPING，别进正式包。
//
// 下面的 UQuestSubsystem 等类型只是示意，换成项目里的真实类。

#pragma once

#include "Kismet/BlueprintFunctionLibrary.h"
#include "QuestTestLibrary.generated.h"

UCLASS()
class UQuestTestLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** 直接接取任务（测试准备状态用，跳过 NPC 对话）。返回是否接取成功 */
	UFUNCTION(BlueprintCallable, Category = "任务", meta = (WorldContext = "WorldContextObject", DisplayName = "接任务"))
	static bool AcceptQuest(const UObject* WorldContextObject, int32 QuestId, bool bForce = false);

	/** 把任务计数推进到指定值 */
	UFUNCTION(BlueprintCallable, Category = "任务", meta = (WorldContext = "WorldContextObject"))
	static void SetQuestProgress(const UObject* WorldContextObject, int32 QuestId, int32 Count);

	/** 任务完成了没有（只读：能写进条件和表达式） */
	UFUNCTION(BlueprintPure, Category = "任务", meta = (WorldContext = "WorldContextObject"))
	static bool IsQuestDone(const UObject* WorldContextObject, int32 QuestId);

	/** 给本地玩家发道具，返回实际到账的数量 */
	UFUNCTION(BlueprintCallable, Category = "背包", meta = (WorldContext = "WorldContextObject"))
	static int32 GiveItem(const UObject* WorldContextObject, int32 ItemId, int32 Count = 1);
};

// QuestTestLibrary.cpp 里实现时取子系统的常见写法（示意）：
//
// bool UQuestTestLibrary::AcceptQuest(const UObject* WorldContextObject, int32 QuestId, bool bForce)
// {
// 	const UWorld* World = GEngine ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
// 	UGameInstance* GI = World ? World->GetGameInstance() : nullptr;
// 	UQuestSubsystem* Quests = GI ? GI->GetSubsystem<UQuestSubsystem>() : nullptr;
// 	if (!Quests)
// 	{
// 		// 出错写日志并返回 false：GameTest 会把返回值和日志一起写进报告；不要 check，测试里崩编辑器最糟
// 		UE_LOG(LogTemp, Warning, TEXT("AcceptQuest: 拿不到 QuestSubsystem"));
// 		return false;
// 	}
// 	if (bForce)
// 	{
// 		Quests->Abandon(QuestId);
// 	}
// 	return Quests->Accept(QuestId);
// }
