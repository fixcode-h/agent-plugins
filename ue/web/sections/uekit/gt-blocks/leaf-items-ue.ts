import type { GtStep } from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'
import { registerInsertItems, type InsertItem } from './registry.ts'

/**
 * GameTest 早就有、节点块里却拖不出来的动作（设计稿「GameTest常用UE工具与卡住断开区分」3.1）：
 * 开停 PIE、拖动、滚轮、角色走到、增强输入、截图、点测……按「地图 / PIE」「玩家输入」「观察 / 证据」分组，
 * 节点块的格子在 gt-edit/rail/palette-ue.ts 按组取。样子走 leaf.tsx 的兜底，字段照 fields/actions.ts
 */
const item =
  (group: () => string, prefix: string) =>
  (id: string, label: () => string, hint: () => string, make: () => GtStep, action?: string): InsertItem => ({
    id: `${prefix}-${id}`,
    group,
    label,
    hint,
    slash: id,
    // 登记时插件还没激活、t() 不能调：make 里用了 t() 的（组合键）要直接写 action
    action: action ?? String(make().action),
    make,
  })

const map = item(() => t('地图 / PIE'), 'map')
const input = item(() => t('玩家输入'), 'input')
const observe = item(() => t('观察 / 证据'), 'observe')
const direct = item(() => t('一步操作'), 'leaf')

/**
 * 组合键：按下修饰键 → 按一下主键 → 松开修饰键，三步装在一个子图里，执行走的还是真实按键（key 动作），不加新动作。
 * 默认 Ctrl+S，进子图改键名
 */
const combo = (): GtStep => ({
  action: 'group',
  name: t('组合键 Ctrl+S'),
  do: [
    { action: 'key', key: 'LeftControl', phase: 'press' },
    { action: 'key', key: 'S' },
    { action: 'key', key: 'LeftControl', phase: 'release' },
  ],
})

registerInsertItems([
  map(
    'pie.stop',
    () => t('停止 PIE'),
    () => t('退出正在玩的 PIE'),
    () => ({ action: 'pie.stop' }),
  ),
  map(
    'editor.ensure',
    () => t('等编辑器就绪'),
    () => t('等资源加载完、没有弹窗再往下'),
    () => ({ action: 'editor.ensure', assetsLoaded: true, noModal: true }),
  ),

  input(
    'drag',
    () => t('拖动'),
    () => t('按住控件拖到另一个控件或拖一段距离'),
    () => ({ action: 'drag', target: '' }),
  ),
  input(
    'wheel',
    () => t('滚轮'),
    () => t('在控件上或光标处滚动鼠标滚轮'),
    () => ({ action: 'wheel', delta: -1 }),
  ),
  input(
    'cursor',
    () => t('移动鼠标'),
    () => t('把光标移到画面上的某个位置（瞄准、悬停）'),
    () => ({ action: 'input.cursor', x: 0.5, y: 0.5 }),
  ),
  input(
    'combo',
    () => t('组合键'),
    () => t('Ctrl+S、Shift+左键这类同时按的键'),
    combo,
    'group',
  ),
  input(
    'move',
    () => t('角色走到'),
    () => t('让玩家角色走到某个点或某个 Actor 旁边'),
    () => ({ action: 'move', to: [0, 0, 0] }),
  ),
  input(
    'input.start',
    () => t('按住输入'),
    () => t('持续发增强输入动作（移动、转视角），走完整的输入链'),
    () => ({ action: 'input.start', asset: '' }),
  ),
  input(
    'input.stop',
    () => t('松开输入'),
    () => t('停掉之前按住的增强输入'),
    () => ({ action: 'input.stop', asset: '' }),
  ),
  input(
    'ability',
    () => t('技能输入'),
    () => t('发一次 GAS 技能输入标签'),
    () => ({ action: 'ability.input', tag: '' }),
  ),

  observe(
    'shot',
    () => t('截图'),
    () => t('截游戏画面（含界面）存进报告'),
    () => ({ action: 'screenshot' }),
  ),
  observe(
    'snapshot',
    () => t('控件树快照'),
    () => t('记下现在的界面结构，方便事后看停在哪'),
    () => ({ action: 'snapshot' }),
  ),
  observe(
    'probe',
    () => t('点测'),
    () => t('看画面上某个点会点到谁、有没有被挡住'),
    () => ({ action: 'probe', target: '' }),
  ),
  observe(
    'actor',
    () => t('找 Actor'),
    () => t('按类或标签找世界里的 Actor，报位置和速度'),
    () => ({ action: 'actor.get', class: '' }),
  ),
  observe(
    'net',
    () => t('对比两端'),
    () => t('多人时核对服务器和客户端的位置一致'),
    () => ({ action: 'net.compare', class: '' }),
  ),
  observe(
    'mark',
    () => t('记一笔'),
    () => t('只往报告里写一句说明'),
    () => ({ action: 'mark', text: '' }),
  ),

  // 直接改值的：给准备工作用，不是玩家的操作，说明里写清楚，提醒优先点击、按键
  direct(
    'select',
    () => t('选列表项（直接改值）'),
    () => t('不走真实输入：直接选中列表里的条目'),
    () => ({ action: 'select', target: '', index: 0 }),
  ),
  direct(
    'scroll',
    () => t('滚动（直接改值）'),
    () => t('不走真实输入：直接设滚动框位置'),
    () => ({ action: 'scroll', target: '' }),
  ),
])
