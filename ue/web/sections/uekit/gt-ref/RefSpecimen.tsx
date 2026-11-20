import { useState } from 'react'
import type {
  GtCloseHow,
  GtIdentItem,
  GtMany,
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
import { WidgetTreePick } from './WidgetTreePick.tsx'

/**
 * 设置 →「控件样式」里 GameTest 对象引用（2.0）这组控件的示例：属性树、对象卡片、比较编辑、关闭方式、从游戏里抓。
 * 全是假数据，不连 UE；「从游戏里抓」的 gt.tree / gt.refFor / gt.props 由 RefRpcProvider 换成本文件的假回包
 */
const PROPS: GtPropsResult = {
  class: '/Game/UI/Shop/WBP_ShopItem.WBP_ShopItem_C',
  luaModule: 'UI/Shop/ShopItem',
  siblings: 6,
  suggest: ['@self.ItemId'],
  groups: [
    {
      id: 'state',
      title: '状态',
      items: [
        { prop: ':onScreen', name: '在屏上', src: 'state', type: 'bool', kind: 'bool', value: true, distinct: 1 },
        { prop: ':enabled', name: '能点', src: 'state', type: 'bool', kind: 'bool', value: true, distinct: 2 },
      ],
    },
    {
      id: 'self',
      title: 'WBP_ShopItem',
      class: 'WBP_ShopItem_C',
      items: [
        {
          prop: '@self.ItemId',
          name: 'ItemId',
          src: 'bp',
          type: 'int32',
          kind: 'int',
          value: 1001,
          distinct: 6,
          score: 9,
        },
        {
          prop: '@self.Price',
          name: 'Price',
          src: 'bp',
          type: 'int32',
          kind: 'int',
          value: 120,
          distinct: 4,
          score: 5,
        },
        {
          prop: '@self.Visibility',
          name: 'Visibility',
          src: 'cpp',
          type: 'ESlateVisibility',
          kind: 'visibility',
          value: 'Visible',
          distinct: 1,
        },
        {
          prop: '@self.RenderTransform',
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
          prop: '@TxtName:text',
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
          prop: '@lua.slot',
          name: 'slot',
          src: 'lua',
          type: 'number',
          kind: 'int',
          value: 3,
          distinct: 6,
          score: 3,
          why: '位置会变，不适合当标识',
        },
        { prop: '@lua.cdLeft', name: 'cdLeft', src: 'lua', type: 'number', kind: 'float', value: 2.4, changing: true },
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

const REF: GtRef = {
  class: '/Game/UI/Shop/WBP_ShopItem.WBP_ShopItem_C',
  in: { obj: 'shop', part: 'ListItems' },
  ident: [{ prop: '@self.ItemId', op: 'eq', value: 1001 }],
}

const TREE: GtTreeNode[] = [
  { id: 'n1', depth: 0, class: 'WBP_Shop_C', name: 'WBP_Shop', user: true, visible: true },
  { id: 'n2', parent: 'n1', depth: 1, class: 'UTextBlock', name: 'TxtTitle', part: 'TxtTitle', text: '杂货铺' },
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

/** 假回包：只认「从游戏里抓」用到的几个操作，其余报错（和真桥接一样显示在界面上） */
const fakeRpc: RefRpc = <T,>(_project: string, name: string) => {
  const r: Record<string, unknown> = {
    'gt.tree': { nodes: TREE, total: TREE.length },
    'gt.refFor': CHAIN,
    'gt.props': PROPS,
    'gt.highlight': {},
  }
  return name in r ? Promise.resolve(r[name] as T) : Promise.reject(new Error(t('示例：不连游戏')))
}

export function RefSpecimen() {
  const { ui } = h()
  const [sel, setSel] = useState<string[]>(['@self.ItemId'])
  const [cmp, setCmp] = useState<GtIdentItem>({ prop: '@TxtName:text', op: 'eq', value: '回血药水' })
  const [vis, setVis] = useState<GtIdentItem>({
    prop: '@self.Visibility',
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
        <span className={cap}>WidgetTreePick</span>
        <p className="ue:text-footnote ue:text-subtle">
          {t('示例：左边是假的控件树，点「WBP_ShopItem_0」下的 BtnBuy 看右边')}
        </p>
        <div>
          <ui.Button size="sm" variant="secondary" onClick={() => setPick(true)}>
            {t('从游戏里抓')}
          </ui.Button>
        </div>
        {pick && (
          <RefRpcProvider value={fakeRpc}>
            <WidgetTreePick project="" mode="target" onClose={() => setPick(false)} onUse={() => setPick(false)} />
          </RefRpcProvider>
        )}
      </div>
    </div>
  )
}
