// 项目头文件里 UserWidget 子类的继承链。用法：node --test ue/server/search-index/native-widgets.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseDecls, widgetClasses } from './native-widgets.ts'

test('按继承链认 UserWidget 子类，不看名字', () => {
  const parents = parseDecls(`
UCLASS(Abstract)
class MYGAME_API UPanelBase : public UCommonActivatableWidget
{
UCLASS()
class MYGAME_API UBagPanel final : public UPanelBase
UCLASS()
class UWidgetHelper : public UObject
UCLASS()
class MYGAME_API AWidgetActor : public AActor
`)
  const w = widgetClasses(parents)
  assert.ok(w.has('PanelBase'))
  assert.ok(w.has('BagPanel'))
  assert.ok(!w.has('WidgetHelper'))
  assert.ok(!w.has('WidgetActor'))
})

test('继承链绕成环不会卡住', () => {
  const w = widgetClasses(
    new Map([
      ['A', 'B'],
      ['B', 'A'],
    ]),
  )
  assert.ok(!w.has('A'))
})
