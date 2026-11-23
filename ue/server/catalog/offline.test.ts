import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { luaChainGroups } from '../uekit/gt-author/lua-vars.ts'
import { pickClasses } from './classes.ts'
import { parseUClass } from './cpp-members.ts'
import { parseLuaHead } from './lua-parents.ts'
import { parseBpTags } from './uasset-tags.ts'

test('Lua 文件开头的继承写法', () => {
  assert.deepEqual(parseLuaHead('---@class ShopPanel : BasePanel\nlocal M = UnLua.Class("UI.Base.BasePanel")'), {
    cls: 'ShopPanel',
    parent: 'UI.Base.BasePanel',
  })
  assert.equal(parseLuaHead('local M = Class(require "UI/Base/BasePanel")').parent, 'UI.Base.BasePanel')
  assert.equal(parseLuaHead('local Base = require("UI.Base")\nlocal M = Class(Base)').parent, 'UI.Base')
  assert.equal(parseLuaHead('---@class Foo : Bar').parent, 'Bar')
  assert.deepEqual(parseLuaHead('local M = {}\nreturn M'), {})
})

test('.uasset 里的父类标签', () => {
  const pad = '\0'.repeat(40)
  const buf = Buffer.from(
    `WidgetBlueprintGeneratedClass${pad}NativeParentClass\0\x30\0\0\0/Script/CoreUObject.Class'/Script/UMG.UserWidget'\0` +
      `ParentClass\0\x40\0\0\0/Script/CoreUObject.Class'/Game/UI/W_Base.W_Base_C'\0`,
    'latin1',
  )
  assert.deepEqual(parseBpTags(buf), { parent: '/Game/UI/W_Base.W_Base_C', native: '/Script/UMG.UserWidget' })
  assert.equal(parseBpTags(Buffer.from('Texture2D ParentClass', 'latin1')), undefined)
})

test('离线类树：取一层、包含匹配带祖先', () => {
  const nodes = new Map(
    [
      { name: 'Object' },
      { name: 'UserWidget', parent: 'Object', kind: 'umg' as const },
      { name: 'W_Home', parent: 'UserWidget', kind: 'umg' as const, asset: '/Game/UI/W_Home.W_Home' },
      { name: 'W_Shop', parent: 'UserWidget', kind: 'umg' as const, asset: '/Game/UI/W_Shop.W_Shop' },
    ].map((n) => [n.name, n]),
  )
  const top = pickClasses(nodes, {}, 'Object')
  assert.deepEqual(
    top.items.map((x) => [x.name, x.kids]),
    [['UserWidget', 2]],
  )
  const found = pickClasses(nodes, { q: 'home' }, 'Object')
  assert.deepEqual(
    found.items.map((x) => x.name),
    ['Object', 'UserWidget', 'W_Home'],
  )
  assert.equal(found.hasMore, false)
})

test('离线 Lua 类：按目录列', () => {
  const nodes = new Map(
    ['/Module/A/X', '/Module/A/Sub/Y', '/Module/B/Z', 'Top'].map((name) => [name, { name, kind: 'lua' as const }]),
  )
  const root = pickClasses(nodes, { lua: true, dir: '' })
  assert.deepEqual(
    root.items.map((x) => x.name),
    ['Top'],
  )
  assert.deepEqual(root.dirs, [{ name: 'Module', count: 3 }])
  const a = pickClasses(nodes, { lua: true, dir: 'Module/A' })
  assert.deepEqual(
    a.items.map((x) => x.name),
    ['/Module/A/X'],
  )
  assert.deepEqual(a.dirs, [{ name: 'Module/A/Sub', count: 1 }])
})

test('离线读 C++ 头文件里的 UPROPERTY / UFUNCTION', () => {
  const h = `
UCLASS(Blueprintable)
class MYGAME_API AHomeDecoration : public AActor
{
  GENERATED_BODY()
public:
  /** 摆放时的格子大小 */
  UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Placement")
  int32 GridSize = 4;

  UPROPERTY(VisibleAnywhere, Category = Components)
  TObjectPtr<UStaticMeshComponent> Mesh;

  // 放下一个装饰
  UFUNCTION(BlueprintCallable, Category = "Placement")
  bool Place(const FVector& Where, int32 Count = 1, AActor* Owner = nullptr);

  UFUNCTION(BlueprintPure)
  FString GetLabel() const;

  UFUNCTION(BlueprintCallable)
  void ReadState(TArray<int32>& OutIds) { OutIds.Reset(); }
};`
  const r = parseUClass(h, 'HomeDecoration')!
  assert.equal(r.parent, 'Actor')
  const by = new Map(r.items.map((x) => [x.name, x]))
  assert.deepEqual([...by.keys()], ['GridSize', 'Mesh', 'Place', 'GetLabel', 'ReadState'])
  assert.equal(by.get('GridSize')!.type, 'int32')
  assert.equal(by.get('GridSize')!.cat, 'Placement')
  assert.equal(by.get('GridSize')!.note, '摆放时的格子大小')
  assert.equal(by.get('Mesh')!.readOnly, true)
  const place = by.get('Place')!
  assert.equal(place.kind, 'fn')
  assert.equal(place.note, '放下一个装饰')
  assert.equal(place.sig, '(Where: const FVector&, Count: int32, Owner: AActor*) → bool')
  assert.equal(place.args![2].object, true)
  assert.equal(by.get('GetLabel')!.readOnly, true)
  assert.equal(by.get('ReadState')!.args![0].out, true)
  assert.equal(parseUClass(h, 'Other'), undefined)
})

test('Lua 类离线连同父类列成员', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lua-chain-'))
  try {
    await mkdir(path.join(dir, 'UI'), { recursive: true })
    await writeFile(
      path.join(dir, 'UI', 'Base.lua'),
      '---@class Base\nlocal M = {}\n---@field Visible boolean\nfunction M:Show() end\nfunction M:Init(a) end\nreturn M\n',
    )
    await writeFile(
      path.join(dir, 'UI', 'Shop.lua'),
      'local Base = require("UI.Base")\n---@class Shop : Base\nlocal M = Class(Base)\n---@field Gold integer 金币\nfunction M:Init(a, b) end\nfunction M:Buy(id) end\nreturn M\n',
    )
    const groups = await luaChainGroups(dir, '/UI/Shop')
    assert.deepEqual(
      groups.map((g) => [g.title, g.items.map((x) => x.name)]),
      [
        ['Shop', ['Gold', 'Init', 'Buy']],
        ['Base', ['Visible', 'Show']],
      ],
    )
    assert.equal(groups[0].items[0].path, '@.Gold')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
