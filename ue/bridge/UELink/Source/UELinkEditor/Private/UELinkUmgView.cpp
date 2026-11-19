#include "UELinkUmgView.h"
#include "AgentPanelEditorShared.h"
#include "UELinkCompat.h"

#include "Animation/MovieSceneMarginSection.h"
#include "Animation/MovieSceneMarginTrack.h"
#include "Animation/WidgetAnimation.h"
#include "Animation/WidgetAnimationBinding.h"
#include "Blueprint/UserWidget.h"
#include "Blueprint/WidgetTree.h"
#include "Components/NamedSlotInterface.h"
#include "Components/PanelSlot.h"
#include "Components/PanelWidget.h"
#include "Components/Widget.h"
#include "Components/WidgetSwitcher.h"
#include "Engine/Blueprint.h"
#include "MovieScene.h"
#include "MovieSceneBinding.h"
#include "MovieSceneSection.h"
#include "MovieSceneTrack.h"
#include "Sections/MovieSceneFloatSection.h"
#include "Tracks/MovieSceneFloatTrack.h"
#include "Tracks/MovieScenePropertyTrack.h"
#include "WidgetBlueprint.h"
#if UELINK_UMG_2D_TRANSFORM
#include "Animation/MovieScene2DTransformSection.h"
#include "Animation/MovieScene2DTransformTrack.h"
#endif
#if UELINK_UMG_DOUBLE_TRACK
#include "Sections/MovieSceneDoubleSection.h"
#include "Tracks/MovieSceneDoubleTrack.h"
#endif

#include <type_traits>

// 单体构建会把几个 .cpp 拼进一个编译单元，这里的小工具放进自己的命名空间，不用匿名命名空间（会和别的文件撞名）
namespace UELinkUmgViewImpl
{
	using namespace UELinkUmgView;

	/** 和 umg.tree 一样的上限：深度 64、节点 5000，防止异常的环或超大界面把栈和回包撑爆 */
	constexpr int32 MaxDepth = 64;
	constexpr int32 MaxNodes = 5000;
	/** umg.anims 一次最多回这么多关键帧，超了截断并标 truncated（读结构的回包上限 12000 字左右） */
	constexpr int32 MaxKeys = 1500;

	/** 控件蓝图里的通道白名单：和 AssetForge UmgAnimationCodec 的 SupportedChannels 一致（配置里写的名字 = 控件上的属性路径） */
	const TCHAR* const WidgetChannels[] = {
		TEXT("RenderOpacity"),
		TEXT("RenderTransform.Translation.X"), TEXT("RenderTransform.Translation.Y"),
		TEXT("RenderTransform.Scale.X"), TEXT("RenderTransform.Scale.Y"),
		TEXT("RenderTransform.Shear.X"), TEXT("RenderTransform.Shear.Y"),
		TEXT("RenderTransform.Angle"),
	};

	bool IsWidgetChannel(const FString& Path)
	{
		for (const TCHAR* C : WidgetChannels)
		{
			if (Path == C)
			{
				return true;
			}
		}
		return false;
	}

	double Round6(double V)
	{
		return FMath::RoundToDouble(V * 1000000.0) / 1000000.0;
	}

	const TCHAR* InterpName(ERichCurveInterpMode Mode)
	{
		if (Mode == RCIM_Linear)
		{
			return TEXT("linear");
		}
		if (Mode == RCIM_Constant)
		{
			return TEXT("constant");
		}
		return TEXT("cubic");
	}

	/**
	 * 一个控件的直接子控件：面板的子控件 + 命名插槽里的内容（嵌套 UserWidget 的 Named Slot）。
	 * 不用 UWidgetTree::GetChildWidgets：它收的是全部后代，没法还原父子层级
	 */
	void DirectChildren(UWidget* W, TArray<UWidget*>& Out)
	{
		if (!W)
		{
			return;
		}
		if (INamedSlotInterface* Named = Cast<INamedSlotInterface>(W))
		{
			TArray<FName> SlotNames;
			Named->GetSlotNames(SlotNames);
			for (const FName& SlotName : SlotNames)
			{
				if (UWidget* Content = Named->GetContentForSlot(SlotName))
				{
					Out.AddUnique(Content);
				}
			}
		}
		if (UPanelWidget* Panel = Cast<UPanelWidget>(W))
		{
			for (int32 I = 0; I < Panel->GetChildrenCount(); ++I)
			{
				if (UWidget* Child = Panel->GetChildAt(I))
				{
					Out.AddUnique(Child);
				}
			}
		}
	}

	/** umg.design 的一个节点；默认值字段（false、Visible、空）不写 */
	TSharedPtr<FJsonObject> DesignNode(UWidget* W, TSet<UWidget*>& Visited, int32 Depth, int32& Budget)
	{
		TSharedPtr<FJsonObject> N = MakeShared<FJsonObject>();
		N->SetStringField(TEXT("name"), W->GetName());
		N->SetStringField(TEXT("class"), W->GetClass()->GetName());
		// 控件模板的完整路径（/Game/A/WBP_X.WBP_X:WidgetTree.Btn）：网页拿它调 props / get 读细节，蓝图已加载，按路径直接找得到
		N->SetStringField(TEXT("path"), W->GetPathName());
		if (W->bIsVariable)
		{
			N->SetBoolField(TEXT("var"), true);
		}
		const ESlateVisibility Vis = W->GetVisibility();
		if (Vis != ESlateVisibility::Visible)
		{
			const UEnum* VisEnum = StaticEnum<ESlateVisibility>();
			N->SetStringField(TEXT("visibility"), VisEnum ? VisEnum->GetNameStringByValue((int64)Vis) : FString::FromInt((int32)Vis));
		}
		if (W->Slot)
		{
			N->SetStringField(TEXT("slot"), W->Slot->GetClass()->GetName());
		}
		// WidgetSwitcher 的当前页：第 0 页也写（网页要据此标哪一页在显示）
		if (UWidgetSwitcher* Switcher = Cast<UWidgetSwitcher>(W))
		{
			N->SetNumberField(TEXT("active"), Switcher->GetActiveWidgetIndex());
		}
		if (W->IsA<UUserWidget>())
		{
			// 嵌套的控件蓝图：给它自己的资源路径，网页点进去再读它的设计树（这里不展开它的内部）
			N->SetBoolField(TEXT("user"), true);
			if (const UBlueprint* Ref = UBlueprint::GetBlueprintFromClass(W->GetClass()))
			{
				N->SetStringField(TEXT("asset"), Ref->GetPathName());
			}
		}
		TArray<UWidget*> Kids;
		DirectChildren(W, Kids);
		TArray<TSharedPtr<FJsonValue>> Children;
		for (UWidget* Kid : Kids)
		{
			if (!IsValid(Kid) || Visited.Contains(Kid))
			{
				continue;
			}
			if (Depth >= MaxDepth || Budget <= 0)
			{
				N->SetBoolField(TEXT("truncated"), true);
				break;
			}
			Visited.Add(Kid);
			--Budget;
			Children.Add(MakeShared<FJsonValueObject>(DesignNode(Kid, Visited, Depth + 1, Budget)));
		}
		N->SetArrayField(TEXT("children"), Children);
		return N;
	}

	/** 读一条轨道时不变的东西，免得每个函数一长串参数 */
	struct FTrackCtx
	{
		FString TargetPath;
		FName WidgetName;
		bool bOnSlot = false;
		FFrameRate Tick;
	};

	void Skip(FUmgAnimView& View, const FString& Target, const FString& Channel, const FString& Reason)
	{
		TSharedPtr<FJsonObject> S = MakeShared<FJsonObject>();
		S->SetStringField(TEXT("target"), Target);
		if (!Channel.IsEmpty())
		{
			S->SetStringField(TEXT("channel"), Channel);
		}
		S->SetStringField(TEXT("reason"), Reason);
		View.Skipped.Add(MakeShared<FJsonValueObject>(S));
	}

	/**
	 * 一条 float / double 曲线读成关键帧，并包一个按秒求值的函数（渲染定格用）。
	 * 曲线指针只在这次操作里用：操作在游戏线程上同步做完，期间不会 GC、资源也不会被改
	 */
	template <typename ChannelT>
	void AddCurve(FUmgAnimView& View, ChannelT& Curve, const FTrackCtx& Ctx, const FString& Channel, const FString& PropertyPath)
	{
		FUmgChannelView C;
		C.Target = Ctx.TargetPath;
		C.Channel = Channel;
		C.WidgetName = Ctx.WidgetName;
		C.bOnSlot = Ctx.bOnSlot;
		C.PropertyPath = PropertyPath;
		{
			// 通道数据是「时间 + 值」两张平行数组；Data 要活到读完（视图指向通道里的数组）
			auto Data = Curve.GetData();
			const auto Times = Data.GetTimes();
			const auto Values = Data.GetValues();
			const int32 Count = FMath::Min(Times.Num(), Values.Num());
			for (int32 I = 0; I < Count; ++I)
			{
				FUmgKeyView K;
				K.Time = Ctx.Tick.AsSeconds(FFrameTime(Times[I]));
				K.Value = static_cast<double>(Values[I].Value);
				K.Interp = InterpName(Values[I].InterpMode);
				C.Keys.Add(K);
			}
		}
		if (C.Keys.Num() == 0)
		{
			// 空通道（margin 段上没打关键帧的那几边）不列
			return;
		}
		// float 通道求出 float，double 通道求出 double：从通道的值类型推，不写死
		using FValueT = std::decay_t<decltype(Curve.GetData().GetValues()[0].Value)>;
		ChannelT* Ptr = &Curve;
		const FFrameRate Rate = Ctx.Tick;
		C.Eval = [Ptr, Rate](double Seconds, double& OutValue) -> bool
		{
			FValueT V{};
			if (!Ptr->Evaluate(Rate.AsFrameTime(Seconds), V))
			{
				return false;
			}
			OutValue = static_cast<double>(V);
			return true;
		};
		View.Channels.Add(MoveTemp(C));
	}

	/** 单值属性轨道（float / double）：属性路径在白名单里才读 */
	template <typename SectionT>
	void ReadSingle(FUmgAnimView& View, SectionT* Section, const FTrackCtx& Ctx, const FString& Prop)
	{
		if (Ctx.bOnSlot || !IsWidgetChannel(Prop))
		{
			FString Shown = Prop;
			if (Ctx.bOnSlot)
			{
				Shown = TEXT("slot.") + Prop;
			}
			Skip(View, Ctx.TargetPath, Shown, TEXT("这个通道还不支持（支持 RenderOpacity、RenderTransform 各分量、slot.Padding 四边）"));
			return;
		}
		if (!Section)
		{
			Skip(View, Ctx.TargetPath, Prop, TEXT("轨道上没有片段"));
			return;
		}
		if constexpr (UELinkCompat::THasGetChannel<SectionT>::value)
		{
			AddCurve(View, Section->GetChannel(), Ctx, Prop, Prop);
		}
		else
		{
			Skip(View, Ctx.TargetPath, Prop, TEXT("这个引擎版本的片段取不到曲线"));
		}
	}

#if UELINK_UMG_2D_TRANSFORM
	/** UE 编辑器给 RenderTransform 整体打关键帧时建的 2D 变换轨道：拆成和白名单一样的分量通道 */
	template <typename SectionT>
	void Read2D(FUmgAnimView& View, SectionT& S, const FTrackCtx& Ctx)
	{
		if constexpr (UELinkCompat::THas2DTranslation<SectionT>::value)
		{
			AddCurve(View, S.Translation[0], Ctx, TEXT("RenderTransform.Translation.X"), TEXT("RenderTransform.Translation.X"));
			AddCurve(View, S.Translation[1], Ctx, TEXT("RenderTransform.Translation.Y"), TEXT("RenderTransform.Translation.Y"));
		}
		else
		{
			Skip(View, Ctx.TargetPath, TEXT("RenderTransform.Translation"), TEXT("这个引擎版本的 2D 变换片段取不到平移曲线"));
		}
		if constexpr (UELinkCompat::THas2DScale<SectionT>::value)
		{
			AddCurve(View, S.Scale[0], Ctx, TEXT("RenderTransform.Scale.X"), TEXT("RenderTransform.Scale.X"));
			AddCurve(View, S.Scale[1], Ctx, TEXT("RenderTransform.Scale.Y"), TEXT("RenderTransform.Scale.Y"));
		}
		else
		{
			Skip(View, Ctx.TargetPath, TEXT("RenderTransform.Scale"), TEXT("这个引擎版本的 2D 变换片段取不到缩放曲线"));
		}
		if constexpr (UELinkCompat::THas2DShear<SectionT>::value)
		{
			AddCurve(View, S.Shear[0], Ctx, TEXT("RenderTransform.Shear.X"), TEXT("RenderTransform.Shear.X"));
			AddCurve(View, S.Shear[1], Ctx, TEXT("RenderTransform.Shear.Y"), TEXT("RenderTransform.Shear.Y"));
		}
		else
		{
			Skip(View, Ctx.TargetPath, TEXT("RenderTransform.Shear"), TEXT("这个引擎版本的 2D 变换片段取不到切变曲线"));
		}
		if constexpr (UELinkCompat::THas2DRotation<SectionT>::value)
		{
			AddCurve(View, S.Rotation, Ctx, TEXT("RenderTransform.Angle"), TEXT("RenderTransform.Angle"));
		}
		else
		{
			Skip(View, Ctx.TargetPath, TEXT("RenderTransform.Angle"), TEXT("这个引擎版本的 2D 变换片段取不到旋转曲线"));
		}
	}
#endif

	/** margin 轨道（插槽的 Padding）：UE 编辑器建的是整个 Padding 一条轨道四条曲线，AssetForge 建的是 Padding.Left 这样一边一条 */
	void ReadMargin(FUmgAnimView& View, UMovieSceneMarginSection* Section, const FTrackCtx& Ctx, const FString& Prop)
	{
		FString Base;
		FString Side;
		if (!Prop.Split(TEXT("."), &Base, &Side, ESearchCase::CaseSensitive, ESearchDir::FromEnd))
		{
			Base = Prop;
			Side.Reset();
		}
		if (!Ctx.bOnSlot || Base != TEXT("Padding"))
		{
			Skip(View, Ctx.TargetPath, Prop, TEXT("这个通道还不支持（margin 只支持插槽的 Padding）"));
			return;
		}
		if (!Section)
		{
			Skip(View, Ctx.TargetPath, TEXT("slot.") + Prop, TEXT("轨道上没有片段"));
			return;
		}
		struct FSide
		{
			const TCHAR* Name;
			FMovieSceneFloatChannel* Curve;
		};
		const FSide Sides[] = {{TEXT("Left"), &Section->LeftCurve}, {TEXT("Top"), &Section->TopCurve}, {TEXT("Right"), &Section->RightCurve}, {TEXT("Bottom"), &Section->BottomCurve}};
		for (const FSide& One : Sides)
		{
			if (!Side.IsEmpty() && Side != One.Name)
			{
				continue;
			}
			const FString Path = FString(TEXT("Padding.")) + One.Name;
			AddCurve(View, *One.Curve, Ctx, TEXT("slot.") + Path, Path);
		}
	}

	void ReadTrack(FUmgAnimView& View, UMovieSceneTrack* Track, const FTrackCtx& Ctx)
	{
		if (!Track)
		{
			return;
		}
		UMovieScenePropertyTrack* PropTrack = Cast<UMovieScenePropertyTrack>(Track);
		if (!PropTrack)
		{
			Skip(View, Ctx.TargetPath, FString(), FString::Printf(TEXT("不支持的轨道类型 %s"), *Track->GetClass()->GetName()));
			return;
		}
		const FString Prop = PropTrack->GetPropertyPath().ToString();
		// 一条轨道多个片段的只读第一段（UMG 动画几乎都是一段；和 AssetForge 一致）
		UMovieSceneSection* Section = nullptr;
		if (Track->GetAllSections().Num() > 0)
		{
			Section = Track->GetAllSections()[0];
		}
		if (Track->GetAllSections().Num() > 1)
		{
			Skip(View, Ctx.TargetPath, Prop, TEXT("轨道有多个片段，只读了第一段"));
		}
		if (Cast<UMovieSceneMarginTrack>(Track))
		{
			ReadMargin(View, Cast<UMovieSceneMarginSection>(Section), Ctx, Prop);
			return;
		}
		if (Cast<UMovieSceneFloatTrack>(Track))
		{
			ReadSingle(View, Cast<UMovieSceneFloatSection>(Section), Ctx, Prop);
			return;
		}
#if UELINK_UMG_DOUBLE_TRACK
		if (Cast<UMovieSceneDoubleTrack>(Track))
		{
			ReadSingle(View, Cast<UMovieSceneDoubleSection>(Section), Ctx, Prop);
			return;
		}
#endif
#if UELINK_UMG_2D_TRANSFORM
		if (Cast<UMovieScene2DTransformTrack>(Track))
		{
			UMovieScene2DTransformSection* Section2D = Cast<UMovieScene2DTransformSection>(Section);
			if (!Section2D)
			{
				Skip(View, Ctx.TargetPath, Prop, TEXT("轨道上没有片段"));
				return;
			}
			if (Ctx.bOnSlot)
			{
				Skip(View, Ctx.TargetPath, Prop, TEXT("插槽上的 2D 变换还不支持"));
				return;
			}
			Read2D(View, *Section2D, Ctx);
			return;
		}
#endif
		Skip(View, Ctx.TargetPath, Prop, FString::Printf(TEXT("不支持的轨道类型 %s"), *Track->GetClass()->GetName()));
	}

	/**
	 * 动画绑定找回设计树里的控件。引擎和 AssetForge 写绑定的习惯不完全一样（WidgetName 可能是控件名，也可能是插槽对象名，
	 * 控件名可能在 SlotWidgetName 里），两种都认：先按名字找控件，再找插槽叫这个名字的控件
	 */
	UWidget* FindBound(UWidgetTree* Tree, const FWidgetAnimationBinding& Binding)
	{
		if (!Tree)
		{
			return nullptr;
		}
		const FName Names[] = {Binding.WidgetName, Binding.SlotWidgetName};
		for (const FName& Name : Names)
		{
			if (Name.IsNone())
			{
				continue;
			}
			if (UWidget* Found = Tree->FindWidget(Name))
			{
				return Found;
			}
		}
		UWidget* BySlot = nullptr;
		Tree->ForEachWidget([&BySlot, &Binding](UWidget* W)
		{
			if (!BySlot && W && W->Slot && (W->Slot->GetFName() == Binding.WidgetName || W->Slot->GetFName() == Binding.SlotWidgetName))
			{
				BySlot = W;
			}
		});
		return BySlot;
	}

	void ReadOneAnimation(UWidgetAnimation* Anim, UWidgetTree* Tree, const TMap<const UWidget*, FString>& Paths, FUmgAnimView& View)
	{
		View.Name = Anim->GetName();
		const UMovieScene* Scene = Anim->MovieScene;
		const FFrameRate Tick = Scene->GetTickResolution();
		const TRange<FFrameNumber> Range = Scene->GetPlaybackRange();
		if (Range.HasLowerBound() && Range.HasUpperBound())
		{
			View.Length = Tick.AsSeconds(FFrameTime(Range.GetUpperBoundValue() - Range.GetLowerBoundValue()));
		}
		TMap<FGuid, const FWidgetAnimationBinding*> ByGuid;
		for (const FWidgetAnimationBinding& Binding : Anim->AnimationBindings)
		{
			ByGuid.Add(Binding.AnimationGuid, &Binding);
		}
		// 走 const 版本：5.8 起非 const 的 GetBindings() 弃用（AssetForge 1.x 实测过）
		for (const FMovieSceneBinding& SceneBinding : Scene->GetBindings())
		{
			const FWidgetAnimationBinding* const* Found = ByGuid.Find(SceneBinding.GetObjectGuid());
			const FWidgetAnimationBinding* Binding = Found ? *Found : nullptr;
			UWidget* Target = Binding ? FindBound(Tree, *Binding) : nullptr;
			FTrackCtx Ctx;
			Ctx.Tick = Tick;
			if (Target)
			{
				Ctx.TargetPath = Paths.FindRef(Target);
				Ctx.WidgetName = Target->GetFName();
				Ctx.bOnSlot = !Binding->SlotWidgetName.IsNone();
			}
			if (Ctx.TargetPath.IsEmpty())
			{
				FString Why = TEXT("绑定的控件不在控件树里");
				FString Name = SceneBinding.GetObjectGuid().ToString();
				if (Binding)
				{
					Name = Binding->WidgetName.ToString();
					if (Binding->bIsRootWidget)
					{
						Why = TEXT("绑定在控件蓝图自身上，还不支持");
					}
				}
				Skip(View, Name, FString(), Why);
				continue;
			}
			for (UMovieSceneTrack* Track : SceneBinding.GetTracks())
			{
				ReadTrack(View, Track, Ctx);
			}
		}
	}

	TSharedPtr<FJsonObject> AnimJson(const FUmgAnimView& View, int32& KeyBudget, bool& bTruncated)
	{
		TSharedPtr<FJsonObject> A = MakeShared<FJsonObject>();
		A->SetStringField(TEXT("name"), View.Name);
		A->SetNumberField(TEXT("length"), Round6(View.Length));
		TArray<TSharedPtr<FJsonValue>> Tracks;
		for (const FUmgChannelView& C : View.Channels)
		{
			if (KeyBudget <= 0)
			{
				bTruncated = true;
				break;
			}
			TSharedPtr<FJsonObject> T = MakeShared<FJsonObject>();
			T->SetStringField(TEXT("target"), C.Target);
			T->SetStringField(TEXT("channel"), C.Channel);
			TArray<TSharedPtr<FJsonValue>> Keys;
			for (const FUmgKeyView& K : C.Keys)
			{
				if (KeyBudget <= 0)
				{
					bTruncated = true;
					break;
				}
				--KeyBudget;
				TArray<TSharedPtr<FJsonValue>> Tuple;
				Tuple.Add(MakeShared<FJsonValueNumber>(Round6(K.Time)));
				Tuple.Add(MakeShared<FJsonValueNumber>(Round6(K.Value)));
				Tuple.Add(MakeShared<FJsonValueString>(FString(K.Interp)));
				Keys.Add(MakeShared<FJsonValueArray>(Tuple));
			}
			T->SetArrayField(TEXT("keys"), Keys);
			Tracks.Add(MakeShared<FJsonValueObject>(T));
		}
		A->SetArrayField(TEXT("tracks"), Tracks);
		if (View.Skipped.Num() > 0)
		{
			A->SetArrayField(TEXT("skipped"), View.Skipped);
		}
		return A;
	}
}

namespace UELinkUmgView
{
	UWidgetBlueprint* LoadWidgetBlueprint(const FString& Path, FString& Error)
	{
		UObject* Obj = AgentPanelEd::LoadAsset(Path, Error);
		if (!Obj)
		{
			return nullptr;
		}
		if (UWidgetBlueprint* BP = Cast<UWidgetBlueprint>(Obj))
		{
			return BP;
		}
		// 蓝图里的控件模板、动画这类子对象：外层就是控件蓝图
		if (UWidgetBlueprint* Outer = Obj->GetTypedOuter<UWidgetBlueprint>())
		{
			return Outer;
		}
		// 生成类（_C）、类默认对象、运行中的实例：按类找回蓝图
		const UClass* Class = Cast<UClass>(Obj);
		if (!Class)
		{
			Class = Obj->GetClass();
		}
		if (UWidgetBlueprint* FromClass = Cast<UWidgetBlueprint>(UBlueprint::GetBlueprintFromClass(Class)))
		{
			return FromClass;
		}
		Error = FString::Printf(TEXT("%s 不是控件蓝图（是 %s）：给控件蓝图的资源路径，如 /Game/UI/WBP_Main"), *Path, *Obj->GetClass()->GetName());
		return nullptr;
	}

	TMap<const UWidget*, FString> WidgetPaths(UWidgetTree* Tree)
	{
		TMap<const UWidget*, FString> Out;
		if (!Tree || !Tree->RootWidget)
		{
			return Out;
		}
		UWidget* Root = Tree->RootWidget;
		TArray<UWidget*> Stack;
		Stack.Add(Root);
		Out.Add(Root, Root->GetName());
		while (Stack.Num() > 0 && Out.Num() < UELinkUmgViewImpl::MaxNodes * 4)
		{
			UWidget* Cur = Stack.Pop();
			const FString Base = Out.FindRef(Cur);
			TArray<UWidget*> Kids;
			UELinkUmgViewImpl::DirectChildren(Cur, Kids);
			for (UWidget* Kid : Kids)
			{
				if (!IsValid(Kid) || Out.Contains(Kid))
				{
					continue;
				}
				Out.Add(Kid, Base + TEXT("/") + Kid->GetName());
				Stack.Add(Kid);
			}
		}
		return Out;
	}

	TArray<FUmgAnimView> ReadAnimations(UWidgetBlueprint* BP)
	{
		TArray<FUmgAnimView> Out;
		if (!BP)
		{
			return Out;
		}
		UWidgetTree* Tree = BP->WidgetTree;
		const TMap<const UWidget*, FString> Paths = WidgetPaths(Tree);
		for (UWidgetAnimation* Anim : BP->Animations)
		{
			if (!Anim || !Anim->MovieScene)
			{
				continue;
			}
			FUmgAnimView View;
			UELinkUmgViewImpl::ReadOneAnimation(Anim, Tree, Paths, View);
			Out.Add(MoveTemp(View));
		}
		return Out;
	}
}

namespace AgentPanelEd
{
	void RegisterUmgViewOps()
	{
		FAgentPanelBridge& B = FAgentPanelBridge::Get();

		// ---------- umg.design：控件蓝图的设计时控件树 ----------
		B.AddOp(TEXT("umg.design"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
		{
			UWidgetBlueprint* BP = UELinkUmgView::LoadWidgetBlueprint(AgentPanel::Str(A, TEXT("path")), Error);
			if (!BP)
			{
				return false;
			}
			Out->SetStringField(TEXT("asset"), BP->GetPathName());
			// 父类不是 UserWidget 本身时给出（继承别的控件蓝图或项目的 C++ 基类）
			const UClass* Parent = BP->ParentClass;
			if (Parent && Parent != UUserWidget::StaticClass())
			{
				Out->SetStringField(TEXT("parent"), Parent->GetPathName());
			}
			Out->SetNumberField(TEXT("animations"), BP->Animations.Num());
			UWidget* Root = nullptr;
			if (UWidgetTree* Tree = BP->WidgetTree)
			{
				Root = Tree->RootWidget;
			}
			if (!Root)
			{
				// 空的控件蓝图（或控件全在父蓝图里）：照常回，网页显示空树
				Out->SetField(TEXT("root"), MakeShared<FJsonValueNull>());
				return true;
			}
			TSet<UWidget*> Visited;
			Visited.Add(Root);
			int32 Budget = UELinkUmgViewImpl::MaxNodes;
			Out->SetObjectField(TEXT("root"), UELinkUmgViewImpl::DesignNode(Root, Visited, 0, Budget));
			return true;
		});

		// ---------- umg.anims：控件蓝图的动画（只读） ----------
		B.AddOp(TEXT("umg.anims"), [](const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
		{
			UWidgetBlueprint* BP = UELinkUmgView::LoadWidgetBlueprint(AgentPanel::Str(A, TEXT("path")), Error);
			if (!BP)
			{
				return false;
			}
			int32 KeyBudget = UELinkUmgViewImpl::MaxKeys;
			bool bTruncated = false;
			TArray<TSharedPtr<FJsonValue>> Items;
			for (const UELinkUmgView::FUmgAnimView& View : UELinkUmgView::ReadAnimations(BP))
			{
				Items.Add(MakeShared<FJsonValueObject>(UELinkUmgViewImpl::AnimJson(View, KeyBudget, bTruncated)));
			}
			Out->SetArrayField(TEXT("animations"), Items);
			if (bTruncated)
			{
				Out->SetBoolField(TEXT("truncated"), true);
			}
			return true;
		});

		UELinkUmgView::RegisterRenderOp();
	}
}
