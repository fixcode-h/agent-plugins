import type { GtStep } from '../../../../../shared/gt-script/index.ts'
import { t } from '../../../../host.ts'
import { registerActionTitles, registerFields, type FieldDef } from './registry.ts'

/**
 * GameTest 动作表（UEKit docs/game-test.md「动作」一节）里每种原有动作的字段。
 * 标签、单位、下拉选项写给人看；字段名、取值照协议原样存。改动作表时同步这里
 */

const f = (k: string, label: () => string, kind: FieldDef['kind'], more: Partial<FieldDef> = {}): FieldDef => ({
  k,
  label,
  kind,
  ...more,
})
const opts =
  (...o: [string, () => string][]) =>
  () =>
    o.map(([value, label]) => ({ value, label: label() }))
const DEFAULT = () => t('默认')

/** 动作落点：对象 + 部件（GameTest 2.0 起不再写选择器字符串） */
const target = (optional = false) =>
  f('target', () => t('控件'), 'target', { hint: optional ? () => t('可不填') : undefined })
const at = (k = 'at', label = () => t('点在哪')) =>
  f(k, label, 'vec', { dims: 2, hint: () => t('控件内的位置，0–1，默认中心 [0.5, 0.5]') })
const client = f('client', () => t('哪一端'), 'mono', {
  placeholder: () => t('server 或 0 起的序号，单人不填'),
})
const mouseButton = f('button', () => t('鼠标键'), 'select', {
  options: opts(
    ['', () => t('左键（默认）')],
    ['RightMouseButton', () => t('右键')],
    ['MiddleMouseButton', () => t('中键')],
  ),
})

// ---------- UI 操作 ----------

registerFields('click', [
  target(),
  f('via', () => t('怎么点'), 'select', {
    options: opts(
      ['', () => t('按运行设置')],
      ['code', () => t('调按钮的点击（不动鼠标）')],
      ['pointer', () => t('真实鼠标')],
    ),
  }),
  { ...mouseButton, when: (s) => s.via === 'pointer' },
  at(),
])

registerFields('drag', [
  target(),
  f('toTarget', () => t('拖到控件'), 'target', { hint: () => t('和「位移」二选一') }),
  f('by', () => t('位移'), 'vec', {
    dims: 2,
    hint: () => t('按视口比例的 [dx, dy]，可以是负数；和「拖到控件」二选一'),
  }),
  at('at', () => t('从哪按下')),
  at('toAt', () => t('松在哪')),
  mouseButton,
])

registerFields('wheel', [
  target(true),
  f('delta', () => t('滚多少'), 'number', { placeholder: () => t('正数向上，负数向下') }),
  at(),
])

registerFields('type', [
  target(),
  f('text', () => t('文字'), 'text'),
  f('append', () => t('接着原文字打'), 'switch', { hint: () => t('关着时先全选再打') }),
  f('commit', () => t('打完按回车'), 'switch'),
  f('via', () => t('怎么打'), 'select', {
    options: opts(['', () => t('真实按键（默认）')], ['code', () => t('直接写文本')]),
  }),
])

registerFields('select', [
  target(),
  f('index', () => t('第几项'), 'number', { placeholder: () => t('从 0 数') }),
  f('property', () => t('按属性'), 'mono', { placeholder: () => t('数据项的属性名，和序号二选一') }),
  f('equals', () => t('属性等于'), 'text'),
  f('add', () => t('加选'), 'switch', { hint: () => t('多选列表里加选，不清掉已选的') }),
])

registerFields('scroll', [
  target(),
  f('mode', () => t('怎么滚'), 'select', {
    options: opts(
      ['', DEFAULT],
      ['offset', () => t('滚到偏移')],
      ['start', () => t('滚到最前')],
      ['end', () => t('滚到最后')],
      ['widget', () => t('滚到某个控件')],
    ),
  }),
  f('value', () => t('偏移'), 'number', { when: (s) => s.mode === 'offset' }),
  f('widget', () => t('滚到的控件'), 'mono', { when: (s) => s.mode === 'widget' }),
  f('index', () => t('列表第几项'), 'number', { placeholder: () => t('列表用，从 0 数') }),
])

registerFields('set', [
  target(),
  f('value', () => t('数值'), 'number', { hint: () => t('滑条、数字框') }),
  f('checked', () => t('勾选'), 'tri'),
  f('option', () => t('下拉选项'), 'text'),
  f('index', () => t('页号 / 序号'), 'number'),
  f('expanded', () => t('展开'), 'tri'),
  f('open', () => t('菜单打开'), 'tri'),
  f('key', () => t('按键'), 'mono', { hint: () => t('按键绑定控件用，UE 键名') }),
  f('property', () => t('条目属性'), 'mono'),
  f('equals', () => t('属性等于'), 'text'),
])

registerFields('key', [
  f('key', () => t('键'), 'key', { placeholder: () => t('UE 键名：W、SpaceBar、LeftMouseButton…') }),
  f('phase', () => t('怎么按'), 'select', {
    options: opts(['', () => t('按一下（默认）')], ['press', () => t('按下不松')], ['release', () => t('松开')]),
  }),
  f('holdMs', () => t('按住'), 'number', { unit: () => t('毫秒'), when: (s) => !s.phase || s.phase === 'tap' }),
  target(true),
])

registerFields('input.cursor', [
  f('x', () => t('横向'), 'number', { placeholder: () => '0–1' }),
  f('y', () => t('纵向'), 'number', { placeholder: () => '0–1' }),
])

registerFields('probe', [
  target(),
  f('pointX', () => t('横向'), 'number', { placeholder: () => '0–1' }),
  f('pointY', () => t('纵向'), 'number', { placeholder: () => '0–1' }),
  f('expect', () => t('应该点到'), 'mono'),
])

// ---------- 对象（协议 game-test-ref 5.3；obj.close、obj.call 有自己的检查器） ----------

registerFields('obj.find', [
  f('obj', () => t('对象'), 'obj'),
  f('saveAs', () => t('存到变量'), 'mono', { placeholder: () => t('变量名，之后写 $名字') }),
])
registerFields('obj.set', [
  f('obj', () => t('对象'), 'obj'),
  f('prop', () => t('属性'), 'prop', {
    hint: () => t('控件状态（Visibility、IsChecked、Text…）走控件自己的 Set 函数，委托照常触发'),
  }),
  f('value', () => t('设成'), 'value'),
])
registerFields('snapshot', [
  target(true),
  f('geometry', () => t('带位置大小'), 'switch'),
  f('props', () => t('带类属性'), 'switch'),
])
registerFields('screenshot', [f('name', () => t('名字'), 'text'), f('annotate', () => t('画编号框'), 'switch')])

// ---------- 界面、关卡、编辑器 ----------

registerFields('widget.add', [
  f('class', () => t('界面类'), 'mono', { placeholder: () => '/Game/UI/WBP_Shop.WBP_Shop_C' }),
  f('zOrder', () => t('层级'), 'number'),
])
registerFields('widget.remove', [target()])
registerFields('stack.push', [target(), f('class', () => t('界面类'), 'mono')])
registerFields('stack.pop', [target()])
registerFields('pie.start', [
  f('map', () => t('地图'), 'map', { placeholder: () => t('不填用编辑器当前地图') }),
  f('width', () => t('宽'), 'number', { unit: () => t('像素') }),
  f('height', () => t('高'), 'number', { unit: () => t('像素') }),
  f('netMode', () => t('网络'), 'select', {
    options: opts(['', () => t('单机（默认）')], ['listenServer', () => t('监听服务器')]),
  }),
  f('players', () => t('玩家窗口'), 'number', { when: (s) => s.netMode === 'listenServer' }),
])
registerFields('pie.stop', [])
registerFields('level.load', [f('map', () => t('地图'), 'map')])
registerFields('editor.ensure', [
  f('assetsLoaded', () => t('等资源加载完'), 'switch'),
  f('noModal', () => t('等没有弹窗'), 'switch'),
])
registerFields('ping', [])
registerFields('mark', [f('text', () => t('写一句'), 'text')])
registerFields('console', [
  f('command', () => t('命令'), 'mono', { placeholder: () => 'stat fps' }),
  f('expectContains', () => t('输出要包含'), 'text', { placeholder: () => t('可不填') }),
])

// ---------- 游戏世界 ----------

registerFields('actor.get', [
  f('class', () => t('类'), 'mono'),
  f('tag', () => t('标签'), 'mono'),
  client,
  f('locallyControlled', () => t('本端控制的'), 'tri'),
])
registerFields('net.compare', [
  f('class', () => t('类'), 'mono'),
  f('tag', () => t('标签'), 'mono'),
  f('tolerance', () => t('允许偏差'), 'number', { unit: () => t('厘米') }),
])
registerFields('move', [
  f('to', () => t('走到'), 'vec', {
    dims: 3,
    unit: () => t('厘米'),
    hint: () => t('世界坐标；和「走到 Actor」二选一'),
  }),
  f('toActor', () => t('走到 Actor'), 'mono', { placeholder: () => t('类名') }),
  f('toTag', () => t('或按标签'), 'mono'),
  f('radius', () => t('到达半径'), 'number', { unit: () => t('厘米'), placeholder: () => t('自动') }),
  f('yaw', () => t('到了朝向'), 'number', { unit: () => '°' }),
  f('pitch', () => t('俯仰'), 'number', { unit: () => '°' }),
  f('via', () => t('怎么走'), 'select', {
    options: opts(
      ['', () => t('自动（默认）')],
      ['nav', () => t('导航网格')],
      ['path', () => t('按录制轨迹')],
      ['probe', () => t('探路')],
      ['teleport', () => t('直接瞬移')],
    ),
  }),
  f('fallback', () => t('走不到时'), 'select', {
    options: opts(['', () => t('报错（默认）')], ['teleport', () => t('瞬移过去')]),
  }),
  f('teleportCommand', () => t('瞬移命令'), 'mono', {
    placeholder: () => t('{x} {y} {z} {yaw} 会被换掉，不填用 TeleportTo'),
    when: (s) => s.via === 'teleport' || s.fallback === 'teleport',
  }),
  f('drive', () => t('怎么推'), 'select', {
    options: opts(['', () => t('移动输入（默认）')], ['keys', () => t('按住前进键')]),
  }),
  f('forwardKey', () => t('前进键'), 'mono', { placeholder: () => 'W', when: (s) => s.drive === 'keys' }),
  client,
])
registerFields('ability.input', [
  f('tag', () => t('输入标签'), 'mono'),
  f('phase', () => t('怎么发'), 'select', {
    options: opts(['', () => t('按下（默认）')], ['release', () => t('松开')]),
  }),
  f('class', () => t('发给谁'), 'mono', { placeholder: () => t('不填是本地玩家 Pawn') }),
])
registerFields('input.start', [f('asset', () => t('输入资产'), 'mono'), f('value', () => t('值'), 'text'), client])
registerFields('input.stop', [f('asset', () => t('输入资产'), 'mono'), client])

// ---------- 等待（不带条件组的老写法） ----------

/** 等待方式：until 的几种取值；cond 交给条件组编辑器（cond-leaves.tsx） */
export const WAIT_MODES = () => [
  { value: 'seconds', label: t('等几秒') },
  { value: 'cond', label: t('等到条件成立') },
  { value: 'pieReady', label: t('等 PIE 跑起来') },
  { value: 'pieStopped', label: t('等 PIE 退出') },
  { value: 'actorNear', label: t('等角色走到附近') },
]
const until =
  (...m: string[]) =>
  (s: GtStep) =>
    m.includes(String(s.until ?? 'seconds'))

registerFields('wait', [
  f('seconds', () => t('等多久'), 'number', { unit: () => t('秒'), when: until('seconds'), placeholder: () => '1' }),
  f('actor', () => t('角色类'), 'mono', { when: until('actorNear') }),
  f('tag', () => t('或按标签'), 'mono', { when: until('actorNear') }),
  f('point', () => t('附近哪'), 'vec', { dims: 3, unit: () => t('厘米'), when: until('actorNear') }),
  f('radius', () => t('半径'), 'number', { unit: () => t('厘米'), when: until('actorNear') }),
])

// 检查只用条件组（cond-leaves.tsx）：v3 按控件写的 exists / visible / text… GameTest 2.0 不认，旧格式不迁移
registerFields('assert', [])

registerActionTitles({
  click: () => t('点击'),
  drag: () => t('拖动'),
  wheel: () => t('滚轮'),
  type: () => t('输入文字'),
  select: () => t('选列表项'),
  scroll: () => t('滚动'),
  key: () => t('按键'),
  'input.cursor': () => t('移动鼠标'),
  probe: () => t('点测'),
  'obj.find': () => t('找对象'),
  'obj.set': () => t('设属性'),
  'obj.call': () => t('调函数'),
  'obj.close': () => t('关闭'),
  'obj.wait': () => t('等对象'),
  snapshot: () => t('控件树快照'),
  screenshot: () => t('截图'),
  'widget.add': () => t('打开界面'),
  'widget.remove': () => t('关掉界面'),
  'stack.push': () => t('压栈界面'),
  'stack.pop': () => t('出栈界面'),
  'pie.start': () => t('启动 PIE'),
  'pie.stop': () => t('停止 PIE'),
  'level.load': () => t('加载关卡'),
  'editor.ensure': () => t('等编辑器就绪'),
  ping: () => t('连通检查'),
  mark: () => t('标记'),
  console: () => t('控制台命令'),
  'actor.get': () => t('找 Actor'),
  'net.compare': () => t('对比两端'),
  move: () => t('移动角色'),
  'ability.input': () => t('技能输入'),
  'input.start': () => t('开始输入'),
  'input.stop': () => t('停止输入'),
})
