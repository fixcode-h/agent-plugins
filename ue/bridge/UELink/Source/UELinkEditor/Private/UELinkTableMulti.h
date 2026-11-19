// DataTable 一次改多行（2.14.0）：datatable.set 的 row 给数组或通配符、或带 where（按别的列的值挑行）时，
// 同一列改成同一个值，整批在一个编辑器事务里
#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"

class UDataTable;

namespace AgentPanel
{
	/** 这次 datatable.set 要不要按多行处理：row 是数组、带通配符，或给了 where */
	bool IsMultiRowSet(const TSharedPtr<FJsonObject>& A);
	/** 多行改：Out 写 count、rows（[{row, prev, value}]，多了只列前 200 行）、tx；一行都没挑中返回 false */
	bool SetTableRows(UDataTable* DT, const TSharedPtr<FJsonObject>& A, TSharedPtr<FJsonObject>& Out, FString& Error);
}
