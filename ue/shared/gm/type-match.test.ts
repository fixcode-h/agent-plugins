import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shapeOf, typeFits, wantsObject } from './type-match.ts'

test('类型形状', () => {
  assert.deepEqual(shapeOf('int32'), { k: 'num', int: true })
  assert.equal(shapeOf('FName').k, 'str')
  assert.deepEqual(shapeOf('TArray<FName>'), { k: 'arr', of: { k: 'str' } })
  assert.equal(shapeOf('class UWidget*').k, 'obj')
  assert.equal(shapeOf('TObjectPtr<UTexture2D>').k, 'obj')
  assert.deepEqual(shapeOf('TEnumAsByte<ESlateVisibility>'), { k: 'enum', name: 'ESlateVisibility' })
  assert.deepEqual(shapeOf('FVector'), { k: 'struct', name: 'FVector' })
  assert.equal(shapeOf('number?').k, 'num')
  assert.equal(shapeOf('').k, 'any')
})

test('能不能填', () => {
  assert.ok(typeFits('float', 'int32'))
  assert.ok(!typeFits('int32', 'float'))
  assert.ok(typeFits('number', 'float'))
  assert.ok(typeFits('FString', 'FText'))
  assert.ok(!typeFits('int32', 'FString'))
  assert.ok(typeFits('TArray<FString>', 'TArray<FName>'))
  assert.ok(!typeFits('TArray<int32>', 'TArray<FName>'))
  assert.ok(!typeFits('FVector', 'FLinearColor'))
  assert.ok(typeFits('table', 'FVector'))
  assert.ok(!typeFits('ESlateVisibility', 'ECheckBoxState'))
  assert.ok(typeFits('any', 'FVector'))
  assert.ok(wantsObject('AActor*') && !wantsObject('int32'))
})

test('按值、能展开', async () => {
  const { valueFits, mayContain } = await import('./type-match.ts')
  assert.ok(valueFits('float', 3))
  assert.ok(!valueFits('float', 'a'))
  assert.ok(valueFits('ESlateVisibility', 'Visible'))
  assert.ok(mayContain('float', 'FVector'))
  assert.ok(mayContain('FName', 'TArray<FName>'))
  assert.ok(!mayContain('float', 'int32'))
})
