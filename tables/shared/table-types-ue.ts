/**
 * UE 5.4 常用数据结构的类型预设：项目设置 → 表格 → 类型里「导入 UE 常用类型」写进类型表，之后和自己加的一样能改能删。
 * 字段顺序和显示样式照 UE 的 ExportText（DataTable 导入 CSV 时格子的写法）；存储样式默认用逗号连字段，
 * 项目表格里实际怎么存，用户在设置里改模板，或让 AI 分析现有表格时调整。
 * FName、FString、FText、int32 这些基础类型不用预设，类型名本身就认得。
 */
import type { TableType, TableTypes, TypeField } from './table-types.ts'

const f = (name: string, type: string, extra: Partial<TypeField> = {}): TypeField => ({ name, type, ...extra })
const struct = (fields: TypeField[], extra: Partial<TableType> = {}): TableType => ({
  kind: 'struct',
  fields,
  ...extra,
})

/** 资源路径：/Game/… 或 Texture2D'/Game/…'，None 表示空 */
const ASSET = "None|(\\w+')?/[\\w/.\\-]+'?"

export function ueTypes(): TableTypes {
  return {
    FVector: struct([f('X', 'double'), f('Y', 'double'), f('Z', 'double')], { aliases: ['Vector'] }),
    FVector2D: struct([f('X', 'double'), f('Y', 'double')], { aliases: ['Vector2D'] }),
    FVector4: struct([f('X', 'double'), f('Y', 'double'), f('Z', 'double'), f('W', 'double')], {
      aliases: ['Vector4'],
    }),
    FIntPoint: struct([f('X', 'int32'), f('Y', 'int32')], { aliases: ['IntPoint'] }),
    FIntVector: struct([f('X', 'int32'), f('Y', 'int32'), f('Z', 'int32')], { aliases: ['IntVector'] }),
    FRotator: struct([f('Pitch', 'double'), f('Yaw', 'double'), f('Roll', 'double')], { aliases: ['Rotator'] }),
    FQuat: struct([f('X', 'double'), f('Y', 'double'), f('Z', 'double'), f('W', 'double')], { aliases: ['Quat'] }),
    FTransform: struct([f('Rotation', 'FQuat'), f('Translation', 'FVector'), f('Scale3D', 'FVector')], {
      aliases: ['Transform'],
      // 字段自己用逗号，字段之间换一个符号才拆得开
      store: '{Rotation}|{Translation}|{Scale3D}',
    }),
    FLinearColor: struct(
      [
        f('R', 'float', { min: 0 }),
        f('G', 'float', { min: 0 }),
        f('B', 'float', { min: 0 }),
        f('A', 'float', { min: 0, optional: true, default: '1' }),
      ],
      { aliases: ['LinearColor'] },
    ),
    // UE 导出的顺序是 B G R A；存储按人习惯的 R G B A
    FColor: struct(
      [f('B', 'uint8'), f('G', 'uint8'), f('R', 'uint8'), f('A', 'uint8', { optional: true, default: '255' })],
      { aliases: ['Color'], store: '{R},{G},{B},{A}' },
    ),
    FGameplayTag: struct([f('TagName', 'FName')], {
      aliases: ['GameplayTag'],
      store: '{TagName}',
      show: '(TagName="{TagName}")',
    }),
    FGameplayTagContainer: struct([f('GameplayTags', 'TArray<FGameplayTag>')], {
      aliases: ['GameplayTagContainer'],
      store: '{GameplayTags}',
      show: '(GameplayTags={GameplayTags})',
    }),
    FSoftObjectPath: {
      kind: 'string',
      aliases: [
        'SoftObjectPath',
        'TSoftObjectPtr',
        'FSoftClassPath',
        'TSoftClassPtr',
        'TSubclassOf',
        'UClass',
        'UObject',
      ],
      pattern: ASSET,
      note: '资源路径，例如 /Game/Items/SM_Sword.SM_Sword',
    },
    FDataTableRowHandle: struct([f('DataTable', 'FSoftObjectPath'), f('RowName', 'FName')], {
      aliases: ['DataTableRowHandle'],
      store: '{DataTable}:{RowName}',
      show: '(DataTable={DataTable},RowName="{RowName}")',
    }),
  }
}
