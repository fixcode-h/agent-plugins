#include "UELinkTableMulti.h"
#include "AgentPanelBridgeUtil.h"
#include "AgentPanelEditorShared.h"
#include "UELinkCompat.h"

#include "DataTableEditorUtils.h"
#include "Engine/DataTable.h"

namespace AgentPanel
{
	namespace TableMulti
	{
		/** 结果里最多列多少行：再多只给条数，回包别太长 */
		constexpr int32 MaxListed = 200;

		bool IsPattern(const FString& S)
		{
			return S.Contains(TEXT("*")) || S.Contains(TEXT("?"));
		}

		/** 一行里某一列现在的值 */
		TSharedPtr<FJsonValue> CellValue(UDataTable* DT, uint8* Row, const FString& Column, FString& Error)
		{
			FResolved R;
			if (!ResolvePath(const_cast<UScriptStruct*>(DT->GetRowStruct()), Row, DT, Column, R, Error))
			{
				return nullptr;
			}
			return ToJson(R.Prop, R.Value, 2000);
		}

		/** row 的写法挑出要改的行名：数组里每项可以是通配符；不写 row 时是全部行（再由 where 筛） */
		TArray<FName> PickRows(UDataTable* DT, const TSharedPtr<FJsonObject>& A)
		{
			TArray<FString> Wanted;
			const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
			if (A->TryGetArrayField(TEXT("row"), Arr) && Arr)
			{
				for (const TSharedPtr<FJsonValue>& V : *Arr)
				{
					FString S;
					if (V.IsValid() && V->TryGetString(S) && !S.IsEmpty())
					{
						Wanted.Add(S);
					}
				}
			}
			else
			{
				const FString One = Str(A, TEXT("row"));
				Wanted.Add(One.IsEmpty() ? FString(TEXT("*")) : One);
			}
			TArray<FName> Rows;
			for (const FName& Name : DT->GetRowNames())
			{
				const FString S = Name.ToString();
				for (const FString& W : Wanted)
				{
					if (IsPattern(W) ? S.MatchesWildcard(W, ESearchCase::IgnoreCase) : S.Equals(W, ESearchCase::IgnoreCase))
					{
						Rows.Add(Name);
						break;
					}
				}
			}
			return Rows;
		}
	}

	bool IsMultiRowSet(const TSharedPtr<FJsonObject>& A)
	{
		const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
		return A->TryGetArrayField(TEXT("row"), Arr) || TableMulti::IsPattern(Str(A, TEXT("row"))) || A->HasField(TEXT("where"));
	}

	bool SetTableRows(UDataTable* DT, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error)
	{
		using namespace TableMulti;
		const FString Column = Str(A, TEXT("column"));
		// where：{列: 值}，这一行这些列现在的值都对得上才改
		const TSharedPtr<FJsonObject>* Where = nullptr;
		const bool bWhere = A->TryGetObjectField(TEXT("where"), Where) && Where && Where->IsValid();
		TArray<FName> Rows;
		for (const FName& Name : PickRows(DT, A))
		{
			uint8* Row = DT->FindRowUnchecked(Name);
			if (!Row)
			{
				continue;
			}
			bool bMatch = true;
			if (bWhere)
			{
				for (const auto& Pair : (*Where)->Values)
				{
					FString CellError;
					const TSharedPtr<FJsonValue> Now = CellValue(DT, Row, UELINK_JSON_KEY(Pair.Key), CellError);
					if (!Now.IsValid())
					{
						Error = FString::Printf(TEXT("where 里的列 %s 不对：%s"), *UELINK_JSON_KEY(Pair.Key), *CellError);
						return false;
					}
					if (!SameJsonValue(Now, Pair.Value))
					{
						bMatch = false;
						break;
					}
				}
			}
			if (bMatch)
			{
				Rows.Add(Name);
			}
		}
		if (Rows.Num() == 0)
		{
			Error = FString::Printf(TEXT("%s 里没有对得上 row / where 的行"), *DT->GetName());
			return false;
		}

		AgentPanelEd::FTx Tx(FString::Printf(TEXT("%s %d 行.%s"), *DT->GetName(), Rows.Num(), *Column));
		DT->Modify();
		FDataTableEditorUtils::BroadcastPreChange(DT, FDataTableEditorUtils::EDataTableChangeInfo::RowData);
		TArray<TSharedPtr<FJsonValue>> Listed;
		bool bOk = true;
		for (const FName& Name : Rows)
		{
			uint8* Row = DT->FindRowUnchecked(Name);
			FResolved R;
			if (!Row || !ResolvePath(const_cast<UScriptStruct*>(DT->GetRowStruct()), Row, DT, Column, R, Error))
			{
				bOk = false;
				break;
			}
			const TSharedPtr<FJsonValue> Prev = ToJson(R.Prop, R.Value, 2000);
			if (!FromJson(R.Prop, R.Value, A->TryGetField(TEXT("value")), Error))
			{
				Error = FString::Printf(TEXT("行 %s：%s"), *Name.ToString(), *Error);
				bOk = false;
				break;
			}
			DT->HandleDataTableChanged(Name);
			if (Listed.Num() < MaxListed)
			{
				const TSharedPtr<FJsonObject> O = MakeShared<FJsonObject>();
				O->SetStringField(TEXT("row"), Name.ToString());
				O->SetField(TEXT("prev"), Prev);
				O->SetField(TEXT("value"), ToJson(R.Prop, R.Value, 2000));
				Listed.Add(MakeShared<FJsonValueObject>(O));
			}
		}
		FDataTableEditorUtils::BroadcastPostChange(DT, FDataTableEditorUtils::EDataTableChangeInfo::RowData);
		FString TxError;
		// 有一行没改成就整批撤掉（演练同理），表回到改之前
		const bool bKeep = bOk && !Bool(A, TEXT("dryRun"), false);
		const bool bFinished = Tx.IsValid() && Tx.Finish(bKeep, TxError);
		if (!bOk)
		{
			return false;
		}
		if (bKeep)
		{
			AgentPanelEd::NoteDirty(DT);
			if (bFinished)
			{
				Out->SetStringField(TEXT("tx"), Tx.Id);
			}
		}
		else
		{
			Out->SetBoolField(TEXT("dryRun"), true);
		}
		Out->SetNumberField(TEXT("count"), Rows.Num());
		Out->SetArrayField(TEXT("rows"), Listed);
		return true;
	}
}
