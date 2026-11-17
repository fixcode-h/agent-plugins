import { t } from '../../host.ts'
import { hintOf, type GtHint } from './gt-steps.ts'
import { moveTitle } from './gt-move.ts'

/**
 * GameTest 步骤列表每一行的一句中文：只说「这一步在干什么」，选择器、hint、参数原文都留给右边的详情。
 * 先用场景里写的 note（AI 整理会给每步写一句），没有就按动作 + 控件文字 / 类名 / 选择器末段拼一句；
 * 认不出的动作退回动作名，不编造
 */
export function stepTitle(def?: Record<string, unknown>, fallbackAction?: string, fallbackTarget?: string) {
  return titleOf(def, fallbackAction, fallbackTarget).replace(/\s+/g, ' ').trim()
}

function titleOf(def?: Record<string, unknown>, fallbackAction?: string, fallbackTarget?: string): string {
  const note = typeof def?.note === 'string' ? def.note.trim() : ''
  if (note) return note
  if (!def)
    return fallbackTarget
      ? t('{a} {w}', { a: fallbackAction ?? '?', w: nameOfTarget(fallbackTarget) })
      : (fallbackAction ?? '?')
  const s = (k: string) => (typeof def[k] === 'string' ? (def[k] as string).trim() : '')
  const n = (k: string) => (typeof def[k] === 'number' ? (def[k] as number) : Number.NaN)
  const w = widgetLabel(hintOf(def), s('target'))
  const a = String(def.action ?? '')
  switch (a) {
    case 'click': {
      const b = s('button')
      if (/^Right/.test(b)) return t('右键点击{w}', { w })
      if (/^Middle/.test(b)) return t('中键点击{w}', { w })
      return t('点击{w}', { w })
    }
    case 'drag':
      return s('toTarget') ? t('把{w}拖到{d}', { w, d: widgetLabel(undefined, s('toTarget')) }) : t('拖动{w}', { w })
    case 'wheel': {
      const d = n('delta')
      return Number.isFinite(d) && d < 0 ? t('在{w}上向下滚动', { w }) : t('在{w}上向上滚动', { w })
    }
    case 'type':
      return t('在{w}里输入「{s}」', { w, s: clip(s('text')) })
    case 'key':
      return keyTitle(def, s('target') ? w : '')
    case 'input.cursor':
      return Number.isFinite(n('x')) && Number.isFinite(n('y'))
        ? t('鼠标移到画面 ({x}%, {y}%)', { x: pct(n('x')), y: pct(n('y')) })
        : t('移动鼠标')
    case 'wait':
      return waitTitle(def, w)
    case 'assert':
      if (s('text') || s('textContains'))
        return t('检查{w}的文字是「{s}」', { w, s: clip(s('text') || s('textContains')) })
      if (def.visible === false || def.exists === false) return t('检查{w}已经不在', { w })
      return t('检查{w}', { w })
    case 'select':
      return Number.isFinite(n('index'))
        ? t('在{w}里选第 {i} 项', { w, i: n('index') + 1 })
        : t('在{w}里选中条目', { w })
    case 'scroll':
      return t('滚动{w}', { w })
    case 'set':
      return t('设置{w}', { w })
    case 'find':
      return t('找到{w}', { w })
    case 'probe':
      return t('检查{w}有没有被挡住', { w })
    case 'snapshot':
      return t('记录当前界面的控件树')
    case 'screenshot':
      return s('name') ? t('截图「{s}」', { s: s('name') }) : t('截图')
    case 'mark':
      return s('text') ? t('记一笔：{s}', { s: clip(s('text'), 40) }) : t('记一笔')
    case 'console':
      return t('执行控制台命令 {s}', { s: clip(s('command'), 40) })
    case 'ping':
      return t('检查和游戏的连接')
    case 'editor.ensure':
      return t('等编辑器就绪')
    case 'pie.start':
      return s('map') ? t('启动 PIE（{m}）', { m: lastPart(s('map')) }) : t('启动 PIE')
    case 'pie.stop':
      return t('退出 PIE')
    case 'level.load':
      return t('加载关卡 {m}', { m: lastPart(s('map')) })
    case 'widget.add':
      return t('打开界面 {c}', { c: lastPart(s('class')) })
    case 'widget.remove':
      return t('关掉{w}', { w })
    case 'actor.get':
      return t('查找 Actor {c}', { c: lastPart(s('class') || s('tag')) })
    case 'move':
      return moveTitle(def)
    case 'net.compare':
      return t('核对服务器和客户端的位置一致')
    case 'stack.push':
      return t('推入界面 {c}', { c: lastPart(s('class')) })
    case 'stack.pop':
      return t('弹出{w}的当前界面', { w })
    case 'ability.input':
      return t('触发技能输入 {s}', { s: s('tag') })
    case 'input.start':
      return t('开始输入 {s}', { s: lastPart(s('asset')) })
    case 'input.stop':
      return t('停止输入 {s}', { s: lastPart(s('asset')) })
    default:
      return s('target') ? `${a} ${w}` : a || (fallbackAction ?? '?')
  }
}

/** UE 键名 → 人话；没列的（W、F1……）原样 */
function keyName(k: string) {
  switch (k) {
    case 'LeftMouseButton':
      return t('鼠标左键')
    case 'RightMouseButton':
      return t('鼠标右键')
    case 'MiddleMouseButton':
      return t('鼠标中键')
    case 'SpaceBar':
      return t('空格键')
    case 'Enter':
      return t('回车')
    case 'BackSpace':
      return t('退格')
    default:
      return k
  }
}

function keyTitle(def: Record<string, unknown>, w: string) {
  const raw = typeof def.key === 'string' ? def.key : '?'
  const key = keyName(raw)
  const hold = Number(def.holdMs)
  const where = w ? t('在{w}上', { w }) : ''
  if (def.phase === 'press') return t('{p}按住 {k}', { p: where, k: key })
  if (def.phase === 'release') return t('{p}松开 {k}', { p: where, k: key })
  if (hold > 0) return t('{p}长按 {k} {s} 秒', { p: where, k: key, s: (hold / 1000).toFixed(1) })
  return t('{p}按一下 {k}', { p: where, k: key })
}

function waitTitle(def: Record<string, unknown>, w: string) {
  const sec = Number(def.seconds)
  switch (def.until) {
    case 'pieReady':
      return t('等 PIE 跑起来')
    case 'pieStopped':
      return t('等 PIE 退出')
    case 'widget':
      return t('等{w}出现', { w })
    case 'widgetGone':
      return t('等{w}消失', { w })
    case 'actorNear':
      return t('等 Actor 走到指定位置')
    default:
      return Number.isFinite(sec) ? t('等待 {s} 秒', { s: +sec.toFixed(2) }) : t('等待')
  }
}

/** 控件类 → 称呼；只认常见的几类，项目自己的类（SPButton 之类）按词尾认 */
function kindOf(cls?: string) {
  if (!cls) return ''
  const c = cls.replace(/<.*$/, '')
  if (/Button$|Btn/i.test(c)) return t('按钮')
  if (/CheckBox/i.test(c)) return t('复选框')
  if (/EditableText|TextBox/i.test(c)) return t('输入框')
  if (/ComboBox/i.test(c)) return t('下拉框')
  if (/Slider|SpinBox/i.test(c)) return t('滑条')
  if (/TableRow|ListView|TileView/i.test(c)) return t('列表项')
  if (/ScrollBox/i.test(c)) return t('滚动区')
  return ''
}

/**
 * 一个控件的称呼：有可见文字时「常用」按钮；没文字时用控件名（选择器末段，或 hint 里的资源名），
 * 前后带空格方便直接拼进句子（「点击「常用」按钮」「点击 Btn_Close」）
 */
export function widgetLabel(h: GtHint | undefined, target?: string) {
  const kind = kindOf(h?.class)
  if (h?.text) return t('「{s}」{k}', { s: clip(h.text), k: kind })
  // 控件里取不到字（字画在贴图里）时用录制截图认出来的字
  if (h?.ocr) return t('「{s}」{k}', { s: clip(h.ocr), k: kind })
  const name = nameOfTarget(target) || lastPart(h?.asset)
  if (name) return ` ${name} `
  return kind || t('控件')
}

/** 选择器 WBP_Main:Root/#Panel>Btn_Close[2] → Btn_Close：取最后一段，去掉 #、下标和条件 */
export function nameOfTarget(target?: string) {
  if (!target) return ''
  const last = target.split(/[/>:]/).filter(Boolean).pop() ?? ''
  return last.replace(/^[#@]/, '').replace(/\[.*$/, '').replace(/\{.*$/, '').trim()
}

/** /Game/UI/WBP_Login.WBP_Login_C → WBP_Login */
const lastPart = (p?: string) => (p ? (p.split('/').pop()?.split('.').pop()?.replace(/_C$/, '') ?? p) : '')

const pct = (v: number) => Math.round(v * 100)

const clip = (s: string, n = 20) => (s.length > n ? `${s.slice(0, n)}…` : s)
