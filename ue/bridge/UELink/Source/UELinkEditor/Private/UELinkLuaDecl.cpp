// Lua 声明的后台调度：默认关闭，打开后（luadecl.enable、控制台 UELink.LuaDecl.Enable 1，存在本机的编辑器个人配置里）
// 编辑器启动时把原生类型和蓝图过一遍，之后只处理变化：蓝图编译、资源加载 / 保存 / 改名 / 删除、Live Coding 和模块加载。
// 增量靠清单（每个文件的内容哈希）：内容没变不写盘，emmylua_ls 的文件监听只会收到真正变了的文件。
// 全部在游戏线程上分帧做（前台每帧约 4 毫秒，编辑器在后台时多给一些），写盘交给后台管道，不卡编辑器。
#include "UELinkLuaDecl.h"

#include "AgentPanelBridge.h"
#include "AgentPanelBridgeUtil.h"
#include "AgentPanelEditorShared.h"
#include "UELinkCompat.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "AssetRegistry/IAssetRegistry.h"
#include "Dom/JsonObject.h"
#include "Editor.h"
#include "Engine/Blueprint.h"
#include "Engine/UserDefinedEnum.h"
#include "StructUtils/UserDefinedStruct.h"
#include "Framework/Application/SlateApplication.h"
#include "Hash/CityHash.h"
#include "HAL/FileManager.h"
#include "HAL/IConsoleManager.h"
#include "Interfaces/IPluginManager.h"
#include "Misc/ConfigCacheIni.h"
#include "Misc/CoreDelegates.h"
#include "Misc/FileHelper.h"
#include "Misc/PackageName.h"
#include "Misc/Paths.h"
#include "Modules/ModuleManager.h"
#include "Policies/CondensedJsonPrintPolicy.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Tasks/Pipe.h"
#include "UObject/ObjectSaveContext.h"
#include "UObject/Package.h"
#include "UObject/UObjectGlobals.h"
#include "UObject/UObjectIterator.h"

namespace UELinkLuaDecl
{
	namespace
	{
		const TCHAR* ConfigSection = TEXT("UELink.LuaDecl");
		const TCHAR* ConfigKey = TEXT("Enabled");
		// 蓝图（及用户定义结构体 / 枚举）默认不生成，只出 C++ 反射类型（用户 2026-11-17）；打开后才扫资源
		const TCHAR* BlueprintsKey = TEXT("Blueprints");
		bool GBlueprints = false;
		const TCHAR* ManifestName = TEXT(".uelink-luadecl.json");
		constexpr int32 ManifestFormat = 1;

		struct FAssetEntry
		{
			FString File;
			FString Stamp;
			bool bFull = false;
		};

		enum class EPhase : uint8
		{
			Idle,
			Native,
			Assets,
			Loading,
		};

		const TCHAR* PhaseName(EPhase P)
		{
			switch (P)
			{
			case EPhase::Native: return TEXT("native");
			case EPhase::Assets: return TEXT("assets");
			case EPhase::Loading: return TEXT("loading");
			default: return TEXT("idle");
			}
		}

		struct FState
		{
			bool bActive = false;
			FString OutDir;
			TMap<FString, FString> FileHashes;
			TMap<FString, FAssetEntry> Assets;
			bool bManifestDirty = false;
			double LastManifestSave = 0;

			EPhase Phase = EPhase::Idle;
			bool bForce = false;

			// 原生类型一遍
			bool bNativeDirty = false;
			double NativeDirtyAt = 0;
			TArray<TWeakObjectPtr<UField>> NativeQueue;
			int32 NativeIndex = 0;
			TSet<FString> NativeSeen;
			TSet<FString> NativeTypeNames;

			// 蓝图、用户定义结构体 / 枚举
			bool bFullAssetScan = false;
			bool bAssetPassIsFull = false;
			TArray<FAssetData> AssetQueue;
			int32 AssetIndex = 0;
			TSet<FString> AssetSeen;
			TSet<FName> DirtyPackages;
			TSet<FName> CompilingPackages;

			// 加载没加载过的蓝图（luadecl.run loadBlueprints）
			TArray<FSoftObjectPath> LoadQueue;
			int32 LoadIndex = 0;

			// 统计
			int32 Written = 0;
			int32 Deleted = 0;
			int32 Stubs = 0;
			double PassStart = 0;
			FString LastPassAt;
			double LastPassMs = 0;

			FTSTicker::FDelegateHandle Tick;
			FDelegateHandle AssetLoaded, PreCompile, Compiled, Saved, Removed, Renamed, Added, Reload, Modules;
		};

		FState& S()
		{
			static FState State;
			return State;
		}

		UE::Tasks::FPipe& Pipe()
		{
			static UE::Tasks::FPipe P(TEXT("UELinkLuaDecl"));
			return P;
		}

		bool ReadEnabled()
		{
			bool bEnabled = false;
			// 个人配置优先（luadecl.enable 写这里，不进版本库）；项目想统一打开可以写进 DefaultEditor.ini 的同一节
			if (GConfig && GConfig->GetBool(ConfigSection, ConfigKey, bEnabled, GEditorPerProjectIni))
			{
				return bEnabled;
			}
			if (GConfig && GConfig->GetBool(ConfigSection, ConfigKey, bEnabled, GEditorIni))
			{
				return bEnabled;
			}
			return false;
		}

		bool ReadBlueprints()
		{
			bool bOn = false;
			if (GConfig && GConfig->GetBool(ConfigSection, BlueprintsKey, bOn, GEditorPerProjectIni))
			{
				return bOn;
			}
			if (GConfig && GConfig->GetBool(ConfigSection, BlueprintsKey, bOn, GEditorIni))
			{
				return bOn;
			}
			return false;
		}

		void WriteBlueprints(bool bOn)
		{
			if (GConfig)
			{
				GConfig->SetBool(ConfigSection, BlueprintsKey, bOn, GEditorPerProjectIni);
				GConfig->Flush(false, GEditorPerProjectIni);
			}
		}

		void WriteEnabled(bool bEnabled)
		{
			if (GConfig)
			{
				GConfig->SetBool(ConfigSection, ConfigKey, bEnabled, GEditorPerProjectIni);
				GConfig->Flush(false, GEditorPerProjectIni);
			}
		}

		bool CanRunHere()
		{
			return GIsEditor && GEditor && !IsRunningCommandlet();
		}

		FString OutputDir()
		{
			return FPaths::ConvertRelativePathToFull(FPaths::ProjectIntermediateDir() / TEXT("UELink") / TEXT("LuaDecl"));
		}

		FString Now()
		{
			return FDateTime::UtcNow().ToIso8601();
		}

		// ---------- 清单 ----------

		void LoadManifest()
		{
			FState& St = S();
			St.FileHashes.Reset();
			St.Assets.Reset();
			FString Text;
			if (!FFileHelper::LoadFileToString(Text, *(St.OutDir / ManifestName)))
			{
				return;
			}
			TSharedPtr<FJsonObject> Root;
			const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Text);
			if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
			{
				return;
			}
			int32 Format = 0;
			if (!Root->TryGetNumberField(TEXT("format"), Format) || Format != ManifestFormat)
			{
				return;
			}
			const TSharedPtr<FJsonObject>* Files = nullptr;
			if (Root->TryGetObjectField(TEXT("files"), Files) && Files && Files->IsValid())
			{
				for (const auto& Pair : (*Files)->Values)
				{
					FString Hash;
					if (Pair.Value.IsValid() && Pair.Value->TryGetString(Hash))
					{
						St.FileHashes.Add(UELINK_JSON_KEY(Pair.Key), Hash);
					}
				}
			}
			const TSharedPtr<FJsonObject>* Assets = nullptr;
			if (Root->TryGetObjectField(TEXT("assets"), Assets) && Assets && Assets->IsValid())
			{
				for (const auto& Pair : (*Assets)->Values)
				{
					const TSharedPtr<FJsonObject>* Entry = nullptr;
					if (!Pair.Value.IsValid() || !Pair.Value->TryGetObject(Entry) || !Entry || !Entry->IsValid())
					{
						continue;
					}
					FAssetEntry E;
					(*Entry)->TryGetStringField(TEXT("file"), E.File);
					(*Entry)->TryGetStringField(TEXT("stamp"), E.Stamp);
					(*Entry)->TryGetBoolField(TEXT("full"), E.bFull);
					if (!E.File.IsEmpty())
					{
						St.Assets.Add(UELINK_JSON_KEY(Pair.Key), E);
					}
				}
			}
		}

		void SaveManifest()
		{
			FState& St = S();
			if (!St.bManifestDirty)
			{
				return;
			}
			St.bManifestDirty = false;
			St.LastManifestSave = FPlatformTime::Seconds();
			TSharedRef<FJsonObject> Root = MakeShared<FJsonObject>();
			Root->SetNumberField(TEXT("format"), ManifestFormat);
			Root->SetStringField(TEXT("generator"), TEXT("UELink"));
			TSharedRef<FJsonObject> Files = MakeShared<FJsonObject>();
			for (const auto& Pair : St.FileHashes)
			{
				Files->SetStringField(Pair.Key, Pair.Value);
			}
			Root->SetObjectField(TEXT("files"), Files);
			TSharedRef<FJsonObject> Assets = MakeShared<FJsonObject>();
			for (const auto& Pair : St.Assets)
			{
				TSharedRef<FJsonObject> E = MakeShared<FJsonObject>();
				E->SetStringField(TEXT("file"), Pair.Value.File);
				E->SetStringField(TEXT("stamp"), Pair.Value.Stamp);
				if (Pair.Value.bFull)
				{
					E->SetBoolField(TEXT("full"), true);
				}
				Assets->SetObjectField(Pair.Key, E);
			}
			Root->SetObjectField(TEXT("assets"), Assets);
			FString Text;
			const TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer = TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Text);
			FJsonSerializer::Serialize(Root, Writer);
			const FString Path = St.OutDir / ManifestName;
			Pipe().Launch(TEXT("UELinkLuaDecl.Manifest"), [Path, Text = MoveTemp(Text)]()
			{
				FFileHelper::SaveStringToFile(Text, *Path, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
			});
		}

		// ---------- 写盘 ----------

		FString HashOf(const FTCHARToUTF8& Utf8)
		{
			return FString::Printf(TEXT("%016llx"), CityHash64(reinterpret_cast<const char*>(Utf8.Get()), static_cast<uint32>(Utf8.Length())));
		}

		/** 内容和清单里记的一样就不写 */
		void Emit(const FString& Rel, const FString& Content)
		{
			FState& St = S();
			FTCHARToUTF8 Utf8(*Content);
			const FString Hash = HashOf(Utf8);
			const FString* Old = St.FileHashes.Find(Rel);
			if (!St.bForce && Old && *Old == Hash)
			{
				return;
			}
			St.FileHashes.Add(Rel, Hash);
			St.bManifestDirty = true;
			St.Written++;
			TArray<uint8> Bytes;
			Bytes.Append(reinterpret_cast<const uint8*>(Utf8.Get()), Utf8.Length());
			const FString Path = St.OutDir / Rel;
			Pipe().Launch(TEXT("UELinkLuaDecl.Write"), [Path, Bytes = MoveTemp(Bytes)]()
			{
				// 写进同目录的临时文件再换名：语言服务器不会读到写了一半的文件
				const FString Tmp = Path + TEXT(".tmp");
				if (FFileHelper::SaveArrayToFile(Bytes, *Tmp))
				{
					IFileManager::Get().Move(*Path, *Tmp, true, true);
				}
			});
		}

		/** 只删清单里记着的、输出目录下的文件 */
		void RemoveFile(const FString& Rel)
		{
			FState& St = S();
			if (St.FileHashes.Remove(Rel) == 0)
			{
				return;
			}
			St.bManifestDirty = true;
			St.Deleted++;
			const FString Path = St.OutDir / Rel;
			Pipe().Launch(TEXT("UELinkLuaDecl.Delete"), [Path]()
			{
				IFileManager::Get().Delete(*Path, false, true, true);
			});
		}

		// ---------- 原生类型 ----------

		bool IsNativeField(const UField* Field)
		{
			return Field && Field->GetOutermost()->GetName().StartsWith(TEXT("/Script/")) && !IsTransientType(Field);
		}

		FString NativeRel(const UField* Field, const FString& Name)
		{
			FString Module = Field->GetOutermost()->GetName();
			Module.RemoveFromStart(TEXT("/Script/"));
			return FString::Printf(TEXT("Native/%s/%s.lua"), *Module, *Name);
		}

		void StartNativePass()
		{
			FState& St = S();
			St.NativeQueue.Reset();
			for (TObjectIterator<UClass> It; It; ++It)
			{
				if (It->HasAnyClassFlags(CLASS_Native) && IsNativeField(*It))
				{
					St.NativeQueue.Add(*It);
				}
			}
			for (TObjectIterator<UScriptStruct> It; It; ++It)
			{
				if (IsNativeField(*It))
				{
					St.NativeQueue.Add(*It);
				}
			}
			for (TObjectIterator<UEnum> It; It; ++It)
			{
				if (IsNativeField(*It))
				{
					St.NativeQueue.Add(*It);
				}
			}
			St.NativeIndex = 0;
			St.NativeSeen.Reset();
			St.NativeTypeNames.Reset();
			St.bNativeDirty = false;
			St.Phase = EPhase::Native;
		}

		/** UnLua 自带的静态声明（UnLua.lua：UnLua 表、TArray / TMap 等泛型）一起放进输出目录，IDE 只加这一个库就够了 */
		void CopyUnLuaStatic()
		{
			FState& St = S();
			const TSharedPtr<IPlugin> UnLua = IPluginManager::Get().FindPlugin(TEXT("UnLua"));
			if (!UnLua.IsValid())
			{
				return;
			}
			const FString Src = UnLua->GetContentDir() / TEXT("IntelliSense");
			TArray<FString> Files;
			IFileManager::Get().FindFilesRecursive(Files, *Src, TEXT("*.lua"), true, false);
			for (const FString& File : Files)
			{
				FString Rel = File;
				if (!FPaths::MakePathRelativeTo(Rel, *(Src + TEXT("/"))))
				{
					continue;
				}
				FString Content;
				if (FFileHelper::LoadFileToString(Content, *File))
				{
					const FString Out = TEXT("UnLua/") + Rel;
					Emit(Out, FixUnLuaStatic(Content));
					St.NativeSeen.Add(Out);
				}
			}
		}

		void FinishNativePass()
		{
			FState& St = S();
			TArray<FString> Names = St.NativeTypeNames.Array();
			Names.Sort();
			Emit(TEXT("UE.lua"), GenerateUETable(Names));
			St.NativeSeen.Add(TEXT("UE.lua"));
			CopyUnLuaStatic();
			TArray<FString> Stale;
			for (const auto& Pair : St.FileHashes)
			{
				const bool bNativeOwned = Pair.Key.StartsWith(TEXT("Native/")) || Pair.Key.StartsWith(TEXT("UnLua/")) || Pair.Key == TEXT("UE.lua");
				if (bNativeOwned && !St.NativeSeen.Contains(Pair.Key))
				{
					Stale.Add(Pair.Key);
				}
			}
			for (const FString& Rel : Stale)
			{
				RemoveFile(Rel);
			}
			St.NativeQueue.Reset();
			St.Phase = EPhase::Idle;
		}

		void StepNative()
		{
			FState& St = S();
			if (St.NativeIndex >= St.NativeQueue.Num())
			{
				FinishNativePass();
				return;
			}
			const UField* Field = St.NativeQueue[St.NativeIndex++].Get();
			if (!Field || IsTransientType(Field))
			{
				return;
			}
			const FString Content = Generate(Field);
			if (Content.IsEmpty())
			{
				return;
			}
			const FString Name = TypeName(Field);
			const FString Rel = NativeRel(Field, Name);
			Emit(Rel, Content);
			St.NativeSeen.Add(Rel);
			St.NativeTypeNames.Add(Name);
		}

		// ---------- 资源（蓝图、用户定义结构体 / 枚举） ----------

		enum class EAssetKind : uint8
		{
			None,
			Blueprint,
			Struct,
			Enum,
		};

		EAssetKind KindOf(const FAssetData& D)
		{
			// 蓝图开关关着时所有资源都不算：整遍扫描时旧的蓝图声明会被当成「没了」删掉
			if (!GBlueprints)
			{
				return EAssetKind::None;
			}
			const UClass* Class = D.GetClass();
			if (!Class)
			{
				return EAssetKind::None;
			}
			if (Class->IsChildOf(UBlueprint::StaticClass()))
			{
				return EAssetKind::Blueprint;
			}
			if (Class->IsChildOf(UUserDefinedStruct::StaticClass()))
			{
				return EAssetKind::Struct;
			}
			if (Class->IsChildOf(UUserDefinedEnum::StaticClass()))
			{
				return EAssetKind::Enum;
			}
			return EAssetKind::None;
		}

		bool IsRelevantObject(const UObject* Obj)
		{
			return GBlueprints && Obj && (Obj->IsA<UBlueprint>() || Obj->IsA<UUserDefinedStruct>() || Obj->IsA<UUserDefinedEnum>());
		}

		FString AssetRel(const FString& PackageName)
		{
			return TEXT("Blueprint") + PackageName + TEXT(".lua");
		}

		FString PackageStamp(const FString& PackageName)
		{
			FString File;
			if (!FPackageName::DoesPackageExist(PackageName, &File))
			{
				return FString();
			}
			const FDateTime Stamp = IFileManager::Get().GetTimeStamp(*File);
			return Stamp == FDateTime::MinValue() ? FString() : FString::Printf(TEXT("%lld"), Stamp.GetTicks());
		}

		/** 资源注册表标签里的类路径（ParentClass、GeneratedClass）→ Lua 里的类型名 */
		FString ClassNameFromTag(const FAssetData& D, const TCHAR* Tag)
		{
			FString Value;
			if (!D.GetTagValue(FName(Tag), Value) || Value.IsEmpty())
			{
				return FString();
			}
			const FString Path = FPackageName::ExportTextPathToObjectPath(Value);
			if (const UClass* Class = Cast<UClass>(FSoftObjectPath(Path).ResolveObject()))
			{
				return TypeName(Class);
			}
			FString Left, Right;
			return Path.Split(TEXT("."), &Left, &Right, ESearchCase::CaseSensitive, ESearchDir::FromEnd) ? Right : FString();
		}

		const UField* LoadedType(const FAssetData& D, EAssetKind Kind)
		{
			UObject* Asset = D.FastGetAsset(false);
			if (Kind == EAssetKind::Blueprint)
			{
				const UBlueprint* BP = Cast<UBlueprint>(Asset);
				const UClass* Gen = BP ? BP->GeneratedClass.Get() : nullptr;
				if (!Gen)
				{
					FString GenPath;
					if (D.GetTagValue(FName(TEXT("GeneratedClass")), GenPath) && !GenPath.IsEmpty())
					{
						Gen = Cast<UClass>(FSoftObjectPath(FPackageName::ExportTextPathToObjectPath(GenPath)).ResolveObject());
					}
				}
				return (Gen && !IsTransientType(Gen)) ? Gen : nullptr;
			}
			const UField* Field = Cast<UField>(Asset);
			return (Field && !IsTransientType(Field)) ? Field : nullptr;
		}

		void ProcessAsset(const FAssetData& D)
		{
			FState& St = S();
			const EAssetKind Kind = KindOf(D);
			if (Kind == EAssetKind::None)
			{
				return;
			}
			const FString Package = D.PackageName.ToString();
			if (Package.StartsWith(TEXT("/Temp/")) || Package.StartsWith(TEXT("/Engine/Transient")))
			{
				return;
			}
			const FString Rel = AssetRel(Package);
			St.AssetSeen.Add(Package);
			FAssetEntry Entry;
			Entry.File = Rel;
			Entry.Stamp = PackageStamp(Package);

			if (const UField* Type = LoadedType(D, Kind))
			{
				const FString Content = Generate(Type);
				if (!Content.IsEmpty())
				{
					Emit(Rel, Content);
					Entry.bFull = true;
					St.Assets.Add(Package, Entry);
					St.bManifestDirty = true;
					return;
				}
			}

			// 没加载：上次已经有完整声明的就留着（资源改过也比只有继承关系强，下次加载时会更新）
			if (const FAssetEntry* Old = St.Assets.Find(Package))
			{
				if (Old->bFull && St.FileHashes.Contains(Old->File))
				{
					return;
				}
			}
			FString Name;
			FString Parent;
			const FString AssetName = D.AssetName.ToString();
			switch (Kind)
			{
			case EAssetKind::Blueprint:
				Name = ClassNameFromTag(D, TEXT("GeneratedClass"));
				if (Name.IsEmpty())
				{
					Name = AssetName + TEXT("_C");
				}
				Parent = ClassNameFromTag(D, TEXT("ParentClass"));
				break;
			case EAssetKind::Struct:
				Name = TEXT("F") + AssetName;
				break;
			default:
				Name = AssetName;
				break;
			}
			Emit(Rel, GenerateStub(Name, Parent, Package));
			St.Stubs++;
			Entry.bFull = false;
			St.Assets.Add(Package, Entry);
			St.bManifestDirty = true;
		}

		FARFilter RelevantFilter()
		{
			FARFilter Filter;
			Filter.ClassPaths.Add(UBlueprint::StaticClass()->GetClassPathName());
			Filter.ClassPaths.Add(UUserDefinedStruct::StaticClass()->GetClassPathName());
			Filter.ClassPaths.Add(UUserDefinedEnum::StaticClass()->GetClassPathName());
			Filter.bRecursiveClasses = true;
			return Filter;
		}

		void StartFullAssetPass()
		{
			FState& St = S();
			St.AssetQueue.Reset();
			if (GBlueprints)
			{
				IAssetRegistry::GetChecked().GetAssets(RelevantFilter(), St.AssetQueue);
			}
			St.AssetIndex = 0;
			St.AssetSeen.Reset();
			St.bAssetPassIsFull = true;
			St.bFullAssetScan = false;
			St.DirtyPackages.Reset();
			St.Phase = EPhase::Assets;
		}

		/** 变了的包：还在的重新生成，没了的（删除、改名前的旧名）删掉声明文件 */
		void StartDirtyAssetPass()
		{
			FState& St = S();
			St.AssetQueue.Reset();
			IAssetRegistry& Registry = IAssetRegistry::GetChecked();
			for (const FName Package : St.DirtyPackages)
			{
				TArray<FAssetData> Found;
				Registry.GetAssetsByPackageName(Package, Found);
				bool bAny = false;
				for (const FAssetData& D : Found)
				{
					if (KindOf(D) != EAssetKind::None)
					{
						St.AssetQueue.Add(D);
						bAny = true;
					}
				}
				const FString Key = Package.ToString();
				if (!bAny)
				{
					if (const FAssetEntry* Old = St.Assets.Find(Key))
					{
						RemoveFile(Old->File);
						St.Assets.Remove(Key);
						St.bManifestDirty = true;
					}
				}
			}
			St.DirtyPackages.Reset();
			St.AssetIndex = 0;
			St.AssetSeen.Reset();
			St.bAssetPassIsFull = false;
			St.Phase = St.AssetQueue.Num() ? EPhase::Assets : EPhase::Idle;
		}

		void FinishAssetPass()
		{
			FState& St = S();
			if (St.bAssetPassIsFull)
			{
				TArray<FString> Gone;
				for (const auto& Pair : St.Assets)
				{
					if (!St.AssetSeen.Contains(Pair.Key))
					{
						Gone.Add(Pair.Key);
					}
				}
				for (const FString& Key : Gone)
				{
					RemoveFile(St.Assets[Key].File);
					St.Assets.Remove(Key);
				}
				St.bManifestDirty = true;
				// 第一遍（或强制重写）到这里才算完
				St.bForce = false;
				St.LastPassMs = (FPlatformTime::Seconds() - St.PassStart) * 1000.0;
				St.LastPassAt = Now();
				TSharedRef<FJsonObject> Ev = MakeShared<FJsonObject>();
				Ev->SetStringField(TEXT("phase"), TEXT("done"));
				Ev->SetNumberField(TEXT("written"), St.Written);
				Ev->SetNumberField(TEXT("deleted"), St.Deleted);
				Ev->SetNumberField(TEXT("ms"), FMath::RoundToInt(St.LastPassMs));
				FAgentPanelBridge::Get().PublishEvent(TEXT("uelink.luadecl"), Ev);
				UE_LOG(LogTemp, Log, TEXT("UELink：Lua 声明已更新（写 %d 个、删 %d 个，用时 %.1f 秒）：%s"), St.Written, St.Deleted, St.LastPassMs / 1000.0, *St.OutDir);
			}
			St.AssetQueue.Reset();
			St.Phase = EPhase::Idle;
		}

		void StepAsset()
		{
			FState& St = S();
			if (St.AssetIndex >= St.AssetQueue.Num())
			{
				FinishAssetPass();
				return;
			}
			ProcessAsset(St.AssetQueue[St.AssetIndex++]);
		}

		// ---------- 加载没加载过的蓝图 ----------

		int32 QueueLoads()
		{
			FState& St = S();
			TArray<FAssetData> All;
			IAssetRegistry::GetChecked().GetAssets(RelevantFilter(), All);
			St.LoadQueue.Reset();
			St.LoadIndex = 0;
			for (const FAssetData& D : All)
			{
				if (D.IsAssetLoaded() || KindOf(D) == EAssetKind::None)
				{
					continue;
				}
				const FString Package = D.PackageName.ToString();
				const FAssetEntry* Old = St.Assets.Find(Package);
				if (!Old || !Old->bFull || Old->Stamp != PackageStamp(Package))
				{
					St.LoadQueue.Add(D.GetSoftObjectPath());
				}
			}
			return St.LoadQueue.Num();
		}

		void StepLoad()
		{
			FState& St = S();
			if (St.LoadIndex >= St.LoadQueue.Num())
			{
				St.LoadQueue.Reset();
				St.Phase = EPhase::Idle;
				return;
			}
			const FSoftObjectPath Path = St.LoadQueue[St.LoadIndex++];
			// 加载完会触发 OnAssetLoaded，包进脏列表，空闲时生成完整声明
			if (UObject* Obj = Path.TryLoad())
			{
				St.DirtyPackages.Add(Obj->GetOutermost()->GetFName());
			}
		}

		// ---------- 每帧 ----------

		bool IsPlaying()
		{
			return GEditor && GEditor->PlayWorld != nullptr;
		}

		bool Tick(float)
		{
			FState& St = S();
			if (!St.bActive)
			{
				return true;
			}
			const bool bForeground = FSlateApplication::IsInitialized() && FSlateApplication::Get().IsActive();
			// 编辑器在前台时少占一点，切到 IDE 写代码时（编辑器在后台）多做一些
			const double Budget = IsPlaying() ? 0.001 : (bForeground ? 0.004 : 0.02);
			const double End = FPlatformTime::Seconds() + Budget;
			IAssetRegistry& Registry = IAssetRegistry::GetChecked();
			while (FPlatformTime::Seconds() < End)
			{
				if (St.Phase == EPhase::Native)
				{
					StepNative();
					continue;
				}
				if (St.Phase == EPhase::Assets)
				{
					StepAsset();
					continue;
				}
				if (St.Phase == EPhase::Loading)
				{
					// 加载可能很慢，一帧最多一个；PIE 里不加载
					if (!IsPlaying())
					{
						StepLoad();
					}
					break;
				}
				// 空闲：按优先级找下一件事
				const double T = FPlatformTime::Seconds();
				if (St.bNativeDirty && T - St.NativeDirtyAt > 2.0)
				{
					if (St.PassStart == 0)
					{
						St.PassStart = T;
					}
					StartNativePass();
					continue;
				}
				if (Registry.IsLoadingAssets())
				{
					break;
				}
				if (St.bFullAssetScan && !St.bNativeDirty)
				{
					StartFullAssetPass();
					continue;
				}
				if (St.DirtyPackages.Num())
				{
					StartDirtyAssetPass();
					continue;
				}
				if (St.LoadIndex < St.LoadQueue.Num())
				{
					St.Phase = EPhase::Loading;
					break;
				}
				break;
			}
			if (St.Phase == EPhase::Idle && St.bManifestDirty && FPlatformTime::Seconds() - St.LastManifestSave > 5.0)
			{
				SaveManifest();
			}
			return true;
		}

		void MarkNativeDirty()
		{
			FState& St = S();
			St.bNativeDirty = true;
			St.NativeDirtyAt = FPlatformTime::Seconds();
		}

		void Begin(bool bForce)
		{
			FState& St = S();
			if (!CanRunHere())
			{
				return;
			}
			GBlueprints = ReadBlueprints();
			if (!St.bActive)
			{
				St.bActive = true;
				St.OutDir = OutputDir();
				LoadManifest();

				St.AssetLoaded = FCoreUObjectDelegates::OnAssetLoaded.AddLambda([](UObject* Obj)
				{
					if (IsRelevantObject(Obj))
					{
						S().DirtyPackages.Add(Obj->GetOutermost()->GetFName());
					}
				});
				// 编译前记下是哪个蓝图，编译完（OnBlueprintCompiled 不带参数）再生成，拿到的是编译后的类
				St.PreCompile = GEditor->OnBlueprintPreCompile().AddLambda([](UBlueprint* BP)
				{
					if (BP)
					{
						S().CompilingPackages.Add(BP->GetOutermost()->GetFName());
					}
				});
				St.Compiled = GEditor->OnBlueprintCompiled().AddLambda([]()
				{
					FState& State = S();
					State.DirtyPackages.Append(State.CompilingPackages);
					State.CompilingPackages.Reset();
				});
				// 用户定义结构体 / 枚举改完没有编译事件，按保存算
				St.Saved = UPackage::PackageSavedWithContextEvent.AddLambda([](const FString&, UPackage* Package, FObjectPostSaveContext)
				{
					if (Package)
					{
						S().DirtyPackages.Add(Package->GetFName());
					}
				});
				IAssetRegistry& Registry = IAssetRegistry::GetChecked();
				St.Removed = Registry.OnAssetRemoved().AddLambda([](const FAssetData& D)
				{
					S().DirtyPackages.Add(D.PackageName);
				});
				St.Renamed = Registry.OnAssetRenamed().AddLambda([](const FAssetData& D, const FString& OldObjectPath)
				{
					FState& State = S();
					State.DirtyPackages.Add(D.PackageName);
					State.DirtyPackages.Add(FName(*FPackageName::ObjectPathToPackageName(OldObjectPath)));
				});
				St.Added = Registry.OnAssetAdded().AddLambda([](const FAssetData& D)
				{
					// 启动时扫盘也会一个个报 Added，那时候整遍扫描会处理
					if (!IAssetRegistry::GetChecked().IsLoadingAssets())
					{
						S().DirtyPackages.Add(D.PackageName);
					}
				});
				// Live Coding / 热重载、新模块加载：原生类型可能变了，整遍过一次（只写内容变了的）
				St.Reload = FCoreUObjectDelegates::ReloadCompleteDelegate.AddLambda([](EReloadCompleteReason)
				{
					MarkNativeDirty();
				});
				St.Modules = FModuleManager::Get().OnModulesChanged().AddLambda([](FName, EModuleChangeReason Reason)
				{
					if (Reason == EModuleChangeReason::ModuleLoaded)
					{
						MarkNativeDirty();
					}
				});
				St.Tick = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&Tick), 0.0f);
			}
			St.bForce = St.bForce || bForce;
			St.Written = 0;
			St.Deleted = 0;
			St.Stubs = 0;
			St.PassStart = 0;
			St.bNativeDirty = true;
			St.NativeDirtyAt = 0;
			St.bFullAssetScan = true;
		}

		void End()
		{
			FState& St = S();
			if (!St.bActive)
			{
				return;
			}
			St.bActive = false;
			FTSTicker::GetCoreTicker().RemoveTicker(St.Tick);
			St.Tick.Reset();
			FCoreUObjectDelegates::OnAssetLoaded.Remove(St.AssetLoaded);
			if (GEditor)
			{
				GEditor->OnBlueprintPreCompile().Remove(St.PreCompile);
				GEditor->OnBlueprintCompiled().Remove(St.Compiled);
			}
			UPackage::PackageSavedWithContextEvent.Remove(St.Saved);
			if (IAssetRegistry* Registry = IAssetRegistry::Get())
			{
				Registry->OnAssetRemoved().Remove(St.Removed);
				Registry->OnAssetRenamed().Remove(St.Renamed);
				Registry->OnAssetAdded().Remove(St.Added);
			}
			FCoreUObjectDelegates::ReloadCompleteDelegate.Remove(St.Reload);
			FModuleManager::Get().OnModulesChanged().Remove(St.Modules);
			// 做到一半的这一遍丢掉，清单只记已经写了的，下次打开时从头比对
			St.Phase = EPhase::Idle;
			St.NativeQueue.Reset();
			St.AssetQueue.Reset();
			St.LoadQueue.Reset();
			St.LoadIndex = 0;
			St.DirtyPackages.Reset();
			St.CompilingPackages.Reset();
			SaveManifest();
			Pipe().WaitUntilEmpty(FTimespan::FromSeconds(10));
		}

		TSharedRef<FJsonObject> Status()
		{
			FState& St = S();
			TSharedRef<FJsonObject> Out = MakeShared<FJsonObject>();
			Out->SetBoolField(TEXT("enabled"), ReadEnabled());
			Out->SetBoolField(TEXT("blueprints"), ReadBlueprints());
			Out->SetBoolField(TEXT("active"), St.bActive);
			Out->SetStringField(TEXT("dir"), St.OutDir.IsEmpty() ? OutputDir() : St.OutDir);
			Out->SetStringField(TEXT("phase"), PhaseName(St.Phase));
			if (St.Phase == EPhase::Native)
			{
				Out->SetNumberField(TEXT("done"), St.NativeIndex);
				Out->SetNumberField(TEXT("total"), St.NativeQueue.Num());
			}
			else if (St.Phase == EPhase::Assets)
			{
				Out->SetNumberField(TEXT("done"), St.AssetIndex);
				Out->SetNumberField(TEXT("total"), St.AssetQueue.Num());
			}
			if (St.LoadQueue.Num())
			{
				Out->SetNumberField(TEXT("loadDone"), St.LoadIndex);
				Out->SetNumberField(TEXT("loadTotal"), St.LoadQueue.Num());
			}
			Out->SetNumberField(TEXT("files"), St.FileHashes.Num());
			int32 Stubs = 0;
			for (const auto& Pair : St.Assets)
			{
				Stubs += Pair.Value.bFull ? 0 : 1;
			}
			Out->SetNumberField(TEXT("stubs"), Stubs);
			Out->SetNumberField(TEXT("written"), St.Written);
			Out->SetNumberField(TEXT("deleted"), St.Deleted);
			Out->SetNumberField(TEXT("pending"), St.DirtyPackages.Num() + (St.bNativeDirty ? 1 : 0));
			if (!St.LastPassAt.IsEmpty())
			{
				Out->SetStringField(TEXT("lastPassAt"), St.LastPassAt);
				Out->SetNumberField(TEXT("lastPassMs"), FMath::RoundToInt(St.LastPassMs));
			}
			return Out;
		}

		void CopyFields(const TSharedRef<FJsonObject>& From, TSharedPtr<FJsonObject>& Out)
		{
			for (const auto& Pair : From->Values)
			{
				Out->SetField(UELINK_JSON_KEY(Pair.Key), Pair.Value);
			}
		}

		bool SetEnabled(bool bEnabled, FString& Error)
		{
			if (!CanRunHere())
			{
				Error = TEXT("只有编辑器进程能生成 Lua 声明，这个进程是游戏、服务器或后台编辑器");
				return false;
			}
			WriteEnabled(bEnabled);
			if (bEnabled)
			{
				Begin(false);
			}
			else
			{
				End();
			}
			return true;
		}

		bool Run(bool bForce, bool bLoad, int32& Queued, FString& Error)
		{
			if (!CanRunHere())
			{
				Error = TEXT("只有编辑器进程能生成 Lua 声明，这个进程是游戏、服务器或后台编辑器");
				return false;
			}
			if (!S().bActive)
			{
				Error = TEXT("后台生成 Lua 声明还没打开：先调 luadecl.enable {\"enabled\": true}（或控制台 UELink.LuaDecl.Enable 1）");
				return false;
			}
			if (bLoad && !ReadBlueprints())
			{
				Error = TEXT("没打开蓝图声明，加载蓝图没有意义：先 luadecl.enable {\"enabled\": true, \"blueprints\": true}（或控制台 UELink.LuaDecl.Blueprints 1）");
				return false;
			}
			Begin(bForce);
			Queued = bLoad ? QueueLoads() : 0;
			return true;
		}

		FAutoConsoleCommand EnableCommand(
			TEXT("UELink.LuaDecl.Enable"),
			TEXT("后台增量生成 UE 反射的 Lua 声明（给 IDE 跳转、补全用）。1 打开、0 关闭，存在本机的编辑器个人配置里"),
			FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
			{
				const bool bEnabled = Args.Num() == 0 || Args[0] == TEXT("1") || Args[0].Equals(TEXT("true"), ESearchCase::IgnoreCase);
				FString Error;
				if (!SetEnabled(bEnabled, Error))
				{
					UE_LOG(LogTemp, Warning, TEXT("UELink：%s"), *Error);
					return;
				}
				UE_LOG(LogTemp, Log, TEXT("UELink：后台生成 Lua 声明已%s，输出目录 %s"), bEnabled ? TEXT("打开") : TEXT("关闭"), *OutputDir());
			}));

		FAutoConsoleCommand BlueprintsCommand(
			TEXT("UELink.LuaDecl.Blueprints"),
			TEXT("Lua 声明里也生成蓝图、用户定义结构体 / 枚举（默认只生成 C++ 反射类型）。1 打开、0 关闭，存在本机的编辑器个人配置里"),
			FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
			{
				const bool bOn = Args.Num() == 0 || Args[0] == TEXT("1") || Args[0].Equals(TEXT("true"), ESearchCase::IgnoreCase);
				WriteBlueprints(bOn);
				if (S().bActive)
				{
					Begin(false);
				}
				UE_LOG(LogTemp, Log, TEXT("UELink：Lua 声明里的蓝图类型已%s"), bOn ? TEXT("打开") : TEXT("关闭"));
			}));

		FAutoConsoleCommand RunCommand(
			TEXT("UELink.LuaDecl.Run"),
			TEXT("重新比对一遍 Lua 声明。参数：force 全部重写；load 把没加载过的蓝图在后台逐个加载，补全成员"),
			FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
			{
				const bool bForce = Args.Contains(TEXT("force"));
				const bool bLoad = Args.Contains(TEXT("load"));
				int32 Queued = 0;
				FString Error;
				if (!Run(bForce, bLoad, Queued, Error))
				{
					UE_LOG(LogTemp, Warning, TEXT("UELink：%s"), *Error);
					return;
				}
				UE_LOG(LogTemp, Log, TEXT("UELink：开始更新 Lua 声明%s"), bLoad ? *FString::Printf(TEXT("，要加载 %d 个资源"), Queued) : TEXT(""));
			}));
	}

	void Start()
	{
		if (CanRunHere() && ReadEnabled())
		{
			Begin(false);
		}
	}

	void Stop()
	{
		End();
	}

	void RegisterOps()
	{
		FAgentPanelBridge& B = FAgentPanelBridge::Get();

		B.AddOp(TEXT("luadecl.status"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
		{
			CopyFields(Status(), Out);
			return true;
		});

		B.AddOp(TEXT("luadecl.enable"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
		{
			bool bEnabled = false;
			if (!A.IsValid() || !A->TryGetBoolField(TEXT("enabled"), bEnabled))
			{
				Error = TEXT("要给 enabled（true 打开、false 关闭）");
				return false;
			}
			bool bBlueprints = false;
			if (A->TryGetBoolField(TEXT("blueprints"), bBlueprints))
			{
				WriteBlueprints(bBlueprints);
			}
			if (!SetEnabled(bEnabled, Error))
			{
				return false;
			}
			CopyFields(Status(), Out);
			return true;
		});

		B.AddOp(TEXT("luadecl.run"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
		{
			const bool bForce = AgentPanel::Bool(A, TEXT("force"), false);
			const bool bLoad = AgentPanel::Bool(A, TEXT("loadBlueprints"), false);
			int32 Queued = 0;
			if (!Run(bForce, bLoad, Queued, Error))
			{
				return false;
			}
			Out->SetBoolField(TEXT("started"), true);
			if (bLoad)
			{
				Out->SetNumberField(TEXT("toLoad"), Queued);
			}
			CopyFields(Status(), Out);
			return true;
		});
	}
}
