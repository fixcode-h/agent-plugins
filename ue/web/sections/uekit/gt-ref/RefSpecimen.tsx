import { useState } from 'react'
import type {
  GtCloseHow,
  GtIdentItem,
  GtIdentNode,
  GtMany,
  GtPropItem,
  GtPropsResult,
  GtRef,
  GtRefForResult,
  GtTreeNode,
} from '../../../../shared/gt-script/ref/types.ts'
import { h, t } from '../../../host.ts'
import { CloseHowList, CloseVerify } from './CloseHowList.tsx'
import { CompareEditor } from './CompareEditor.tsx'
import { RefRpcProvider, type RefRpc } from './live.ts'
import { PropTree } from './PropTree.tsx'
import { RefCard } from './RefCard.tsx'
import { RefDialog } from './RefDialog.tsx'
import { SPECIMEN_LUA_PROPS } from './specimen-lua-props.ts'
import { searchText } from '../../../../shared/gt-script/ref/search-text.ts'

/**
 * 设置 →「控件样式」里 GameTest 对象引用（2.0）这组控件的示例：属性树、对象卡片、比较编辑、关闭方式、选对象面板。
 * 全是假数据，不连 UE；选对象面板的 gt.classes / gt.tree / gt.props 由 RefRpcProvider 换成本文件的假回包
 */
const PROPS: GtPropsResult = {
  class: '/Game/UI/Shop/WBP_ShopItem.WBP_ShopItem_C',
  luaModule: 'UI/Shop/ShopItem',
  siblings: 6,
  suggest: ['@.ItemId'],
  groups: [
    {
      id: 'state',
      title: '状态',
      items: [
        { prop: '@:onScreen', name: '在屏上', src: 'state', type: 'bool', kind: 'bool', value: true, distinct: 1 },
        { prop: '@:enabled', name: '能点', src: 'state', type: 'bool', kind: 'bool', value: true, distinct: 2 },
      ],
    },
    {
      id: 'self',
      title: 'WBP_ShopItem',
      class: 'WBP_ShopItem_C',
      items: [
        {
          prop: '@.ItemId',
          name: 'ItemId',
          src: 'bp',
          type: 'int32',
          kind: 'int',
          value: 1001,
          distinct: 6,
          score: 9,
        },
        {
          prop: '@.Price',
          name: 'Price',
          src: 'bp',
          type: 'int32',
          kind: 'int',
          value: 120,
          distinct: 4,
          score: 5,
        },
        {
          prop: '@.Visibility',
          name: 'Visibility',
          src: 'cpp',
          type: 'ESlateVisibility',
          kind: 'visibility',
          value: 'Visible',
          distinct: 1,
        },
        {
          prop: '@.RenderTransform',
          name: 'RenderTransform',
          src: 'cpp',
          type: 'FWidgetTransform',
          kind: 'struct',
          comparable: false,
          why: '结构体：展开后比较里面的字段',
        },
      ],
    },
    {
      id: 'TxtName',
      title: 'TxtName',
      part: 'TxtName',
      class: 'UTextBlock',
      items: [
        {
          prop: '@/TxtName:text',
          name: '文字',
          src: 'state',
          type: 'FText',
          kind: 'text',
          value: '回血药水',
          distinct: 6,
          score: 8,
        },
      ],
    },
    {
      id: 'lua',
      title: 'UI/Shop/ShopItem.lua',
      items: [
        {
          prop: '@#slot',
          name: 'slot',
          src: 'lua',
          type: 'number',
          kind: 'int',
          value: 3,
          distinct: 6,
          score: 3,
          why: '位置会变，不适合当标识',
        },
        { prop: '@#cdLeft', name: 'cdLeft', src: 'lua', type: 'number', kind: 'float', value: 2.4, changing: true },
      ],
    },
    {
      id: 'Icon',
      title: 'WBP_ItemIcon',
      part: 'Icon',
      class: 'WBP_ItemIcon_C',
      user: true,
      collapsed: true,
      items: [],
    },
  ],
}

/** 选对象面板的回包才带（PropTree 示例直接吃 PROPS，不走 normalizeGroups，放进去会读到没有 prop 的项） */
const FN_GROUP = {
  // UE 类的函数（GameTest 2.1.5 起，形状同 C++ 回包，经 normalizeGroups 整成行）：无参取值函数带 path 能当条件
  id: 'functions',
  title: '函数',
  items: [
    {
      name: 'GetItemId',
      params: [],
      ret: 'int32',
      src: 'bp',
      pure: true,
      path: '@.GetItemId()',
      kind: 'int',
      ops: ['eq', 'ne', 'in'],
    },
    {
      name: 'IsSoldOut',
      params: [],
      ret: 'bool',
      src: 'bp',
      pure: true,
      path: '@.IsSoldOut()',
      kind: 'bool',
      ops: ['eq'],
    },
    {
      // 带常量参数的取值函数（GameTest 2.1.6）：路径里先填零值，加进条件后在参数框里改
      name: 'GetStock',
      params: ['int32 WarehouseId'],
      ret: 'int32',
      src: 'cpp',
      pure: true,
      path: '@.GetStock(0)',
      args: 1,
      kind: 'int',
      ops: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'in'],
    },
    { name: 'SetCount', params: ['int32 NewCount'], src: 'bp' },
    { name: 'PlayBuyAnim', params: ['float Delay', 'bool bLoop'], src: 'bp' },
    {
      name: 'GetVisibility',
      params: [],
      ret: 'ESlateVisibility',
      src: 'cpp',
      from: 'Widget',
      pure: true,
      path: '@.GetVisibility()',
      kind: 'visibility',
      ops: ['eq', 'in'],
    },
    { name: 'RemoveFromParent', params: [], src: 'cpp', from: 'Widget' },
  ] as unknown as GtPropItem[],
}

/** Lua 类按类读（游戏没开）：由面板服务端的真实代码读一份仿照真实项目写的 Lua 文件生成（gt-ref/ops.ts → lua-props.ts） */
const LUA_PROPS = SPECIMEN_LUA_PROPS as unknown as GtPropsResult

const REF: GtRef = {
  class: '/Game/UI/Shop/WBP_ShopItem.WBP_ShopItem_C',
  in: { obj: 'shop', part: 'ListItems' },
  ident: [{ prop: '@.ItemId', op: 'eq', value: 1001 }],
}

/** 选对象示例里的唯一标识：两个条件组，第一组里套一个「任一满足」的子组（GameTest 2.1.6 条件组） */
const DIALOG_IDENT: GtIdentNode[] = [
  {
    all: [
      { prop: '@.ItemId', op: 'eq', value: 1001 },
      {
        any: [
          { prop: '@.GetStock(1)', op: 'gt', value: 3 },
          { prop: '@.IsSoldOut()', op: 'is', value: true, not: true },
        ],
      },
    ],
  },
  { prop: '@/TxtName:text', op: 'contains', value: '药水' },
]

const TREE: GtTreeNode[] = [
  { id: 'n1', depth: 0, class: 'WBP_Shop_C', name: 'WBP_Shop', user: true, visible: true },
  {
    id: 'n2',
    parent: 'n1',
    depth: 1,
    class: 'UTextBlock',
    name: 'TxtTitle',
    part: 'TxtTitle',
    text: '杂货铺',
    owner: 'n1',
    ownerClass: 'WBP_Shop_C',
  },
  {
    id: 'n3',
    parent: 'n1',
    depth: 1,
    class: 'UListView',
    name: 'ListItems',
    part: 'ListItems',
    container: { kind: 'list', entryClass: 'WBP_ShopItem_C', count: 6 },
  },
  {
    id: 'n4',
    parent: 'n3',
    depth: 2,
    class: 'WBP_ShopItem_C',
    name: 'WBP_ShopItem_0',
    user: true,
    entry: { container: 'n3', index: 0 },
  },
  { id: 'n5', parent: 'n4', depth: 3, class: 'UTextBlock', name: 'TxtName', part: 'TxtName', text: '回血药水' },
  { id: 'n6', parent: 'n4', depth: 3, class: 'UButton', name: 'BtnBuy', part: 'BtnBuy' },
  {
    id: 'n7',
    parent: 'n3',
    depth: 2,
    class: 'WBP_ShopItem_C',
    name: 'WBP_ShopItem_1',
    user: true,
    entry: { container: 'n3', index: 1 },
  },
  { id: 'n8', parent: 'n1', depth: 1, class: 'UButton', name: 'BtnClose', part: 'BtnClose', visible: false },
]

const CHAIN: GtRefForResult = {
  chain: [
    { node: 'n6', class: 'UButton', kind: 'widget', part: 'BtnBuy', note: '被点的' },
    { node: 'n4', class: 'WBP_ShopItem_C', kind: 'entry', note: 'ListItems 第 1 项' },
    { node: 'n1', class: 'WBP_Shop_C', kind: 'widget' },
  ],
  ref: REF,
  target: { obj: REF, part: 'BtnBuy' },
  matches: 1,
}

const CLASSES = {
  items: [
    { name: 'Object', kind: 'object', kids: 2 },
    { name: 'UserWidget', parent: 'Object', kind: 'umg', kids: 2 },
    { name: 'WBP_Shop_C', parent: 'UserWidget', kind: 'umg', asset: '/Game/UI/Shop/WBP_Shop', kids: 0, live: 1 },
    {
      name: 'WBP_ShopItem_C',
      parent: 'UserWidget',
      kind: 'umg',
      asset: '/Game/UI/Shop/WBP_ShopItem',
      kids: 0,
      live: 6,
    },
    { name: 'Actor', parent: 'Object', kind: 'actor', kids: 1 },
    { name: 'BP_ShopNpc_C', parent: 'Actor', kind: 'actor', kids: 0, live: 3 },
  ],
}

/** 假回包：只认选对象面板用到的几个操作，其余报错（和真桥接一样显示在界面上） */
/** Lua 类：按目录（dir）或按名字搜，两个目录几个模块 */
const LUA = [
  'UI.Shop.ShopPanel',
  'UI.Shop.ShopItem',
  'UI.Common.Tips',
  'GDefine',
  'Module.MainModule_HomeDecoration.SM_HD_HomeDecoration.s_HD_HD_HomeDecoration',
  'Module.MainModule_HomeDecoration.SM_HD_HomeDecoration.HomeDecoration.lt_HD_HardDecoration_Instance',
  'Module.MainModule_HomeDecoration.SM_HD_HomeDecoration.SM_HD_HomeDecoration',
]
function fakeLua(args: Record<string, unknown>) {
  const item = (name: string) => ({ name, kind: 'lua', kids: 0 })
  const q = String(args.q ?? '').toLowerCase()
  if (q) {
    const items = LUA.filter((n) => searchText(n, q).includes(q)).map(item)
    return { items, total: items.length, hasMore: false }
  }
  const dir = String(args.dir ?? '').replace(/\./g, '/')
  const pre = dir ? `${dir}/` : ''
  const items = LUA.filter((n) => n.split('.').slice(0, -1).join('/') === dir).map(item)
  const sub = new Map<string, number>()
  for (const n of LUA) {
    const f = n.split('.').slice(0, -1).join('/')
    if (f && f !== dir && f.startsWith(pre)) {
      const k = pre + f.slice(pre.length).split('/')[0]
      sub.set(k, (sub.get(k) ?? 0) + 1)
    }
  }
  return { items, total: items.length, hasMore: false, dirs: [...sub].map(([name, count]) => ({ name, count })) }
}

export const fakeRpc: RefRpc = <T,>(_project: string, name: string, args: Record<string, unknown>) => {
  // 类树：按 parent 给一层（省略 = Object，和 UE 一致），按 q 给名字里含它的
  const q = String(args?.q ?? '').toLowerCase()
  const cls = CLASSES.items.filter((c) =>
    q ? c.name.toLowerCase().includes(q) : (c.parent ?? '') === String(args?.parent ?? (args?.lua ? '' : 'Object')),
  )
  const r: Record<string, unknown> = {
    'gt.classes': args?.lua ? fakeLua(args) : { items: cls, total: cls.length, hasMore: false },
    'gt.tree': { nodes: TREE, total: TREE.length },
    'gt.refFor': CHAIN,
    'gt.props': String(args?.class ?? '').startsWith('lua:')
      ? LUA_PROPS
      : { ...PROPS, groups: [...PROPS.groups, FN_GROUP] },
    'gt.highlight': {},
  }
  return name in r ? Promise.resolve(r[name] as T) : Promise.reject(new Error(t('示例：不连游戏')))
}

export function RefSpecimen() {
  const { ui } = h()
  const [sel, setSel] = useState<string[]>(['@.ItemId'])
  const [cmp, setCmp] = useState<GtIdentItem>({ prop: '@/TxtName:text', op: 'eq', value: '回血药水' })
  const [vis, setVis] = useState<GtIdentItem>({
    prop: '@.Visibility',
    op: 'in',
    value: ['Visible', 'SelfHitTestInvisible'],
  })
  const [many, setMany] = useState<GtMany>('error')
  const [how, setHow] = useState<GtCloseHow[]>([
    { by: 'call', function: 'ClosePanel' },
    { by: 'click', part: 'BtnClose' },
    { by: 'key', key: 'Escape' },
  ])
  const [verify, setVerify] = useState<{ verify?: 'gone' | 'hidden' | 'none'; verifyMs?: number }>({})
  const [pick, setPick] = useState(false)
  const toggle = (p: string) => setSel(sel.includes(p) ? sel.filter((x) => x !== p) : [...sel, p])
  const box = 'ue:flex ue:flex-col ue:gap-2 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:p-3'
  const cap = 'ue:text-caption ue:text-subtle'
  return (
    <div className="ue:grid ue:grid-cols-1 ue:gap-3 ue:lg:grid-cols-2">
      <div className="ue:flex ue:h-[380px] ue:flex-col ue:overflow-hidden ue:rounded-(--c-row-radius) ue:border ue:border-line ue:lg:row-span-2">
        <PropTree
          className="ue:min-h-0 ue:flex-1"
          data={PROPS}
          mode="ident"
          selected={sel}
          onPick={(it) => toggle(it.prop)}
        />
      </div>
      <div className={box}>
        <span className={cap}>RefCard</span>
        <RefCard name="item" value={{ ...REF, many }} hit={{ count: 1 }} onEdit={() => undefined} onMany={setMany} />
        <RefCard name="shop" value={{ class: 'WBP_Shop_C', in: 'screen' }} hit={{ count: 0 }} compact />
        <RefCard value={{ class: 'WBP_ShopItem_C' }} hit={{ count: 6 }} compact />
      </div>
      <div className={box}>
        <span className={cap}>CompareEditor</span>
        <CompareEditor value={cmp} onChange={setCmp} kind="text" textKey="Shop.Item.1001" />
        <CompareEditor value={vis} onChange={setVis} kind="visibility" />
      </div>
      <div className={box}>
        <span className={cap}>CloseHowList</span>
        <CloseHowList value={how} onChange={setHow} parts={[{ part: 'BtnClose', class: 'UButton' }]} />
        <CloseVerify verify={verify.verify} verifyMs={verify.verifyMs} onChange={setVerify} />
      </div>
      <div className={box}>
        <span className={cap}>RefDialog</span>
        <p className="ue:text-footnote ue:text-subtle">{t('示例：假的类树和属性，不连游戏')}</p>
        <div>
          <ui.Button size="sm" variant="secondary" onClick={() => setPick(true)}>
            {t('选对象')}
          </ui.Button>
        </div>
        {pick && (
          <RefRpcProvider value={fakeRpc}>
            <RefDialog
              project=""
              live={false}
              value={{ class: 'WBP_ShopItem_C', ident: DIALOG_IDENT }}
              onClose={() => setPick(false)}
              onSave={() => setPick(false)}
            />
          </RefRpcProvider>
        )}
      </div>
    </div>
  )
}
