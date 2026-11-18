import { t } from '../../host.ts'
import { satisfies } from './plugins/model.ts'

/**
 * 录 UE 编辑器操作的步骤（GameTest 1.11.0 的 editor.*）给人看的写法。
 * 录制时每步的 hint 是 {via, label}：via 说明这一步是从哪录来的（编辑器事件、界面点击、快捷键、Ctrl+Alt 点），
 * label 是给人看的对象名（大纲里的标签、资源名、「停靠页 · 控件」）。执行时不读 hint，只在列表和详情里显示
 */

/** 编辑器里的 GameTest 到 1.11.0 才有 gt.editrec.*，旧版本不给选「录编辑器」 */
export const editorRecordSupported = (gameTestVersion?: string) =>
  !!gameTestVersion && satisfies(gameTestVersion, '>=1.11.0')

/** editor.ensure 是 1.x 就有的「等编辑器就绪」，不算录编辑器操作 */
export const isEditorStep = (action?: unknown) =>
  typeof action === 'string' && action.startsWith('editor.') && action !== 'editor.ensure'

const str = (def: Record<string, unknown>, k: string) => (typeof def[k] === 'string' ? (def[k] as string).trim() : '')
const hintOf = (def: Record<string, unknown>) =>
  def.hint && typeof def.hint === 'object' ? (def.hint as Record<string, unknown>) : {}
/** /Game/UI/WBP_Shop.WBP_Shop → WBP_Shop；actor:Shop/Mesh → Shop/Mesh */
const nameOf = (p: string) => (p.startsWith('actor:') ? p.slice(6) : (p.split('/').pop()?.split('.').pop() ?? p))
const listOf = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const names = (v: unknown) => {
  const all = listOf(v).map(nameOf)
  return all.length > 3 ? t('{a} 等 {n} 个', { a: all.slice(0, 3).join('、'), n: all.length }) : all.join('、')
}

/** 步骤列表、录制中每一行的一句话 */
export function editorStepTitle(def: Record<string, unknown>): string {
  const label = str(hintOf(def), 'label')
  switch (def.action) {
    case 'editor.open':
      return str(def, 'map')
        ? t('打开关卡 {m}', { m: nameOf(str(def, 'map')) })
        : t('打开资源 {a}', { a: label || nameOf(str(def, 'asset')) })
    case 'editor.select': {
      const actors = names(def.actors)
      const assets = names(def.assets)
      if (!actors && !assets) return t('清空选中')
      return t('选中 {s}', { s: [actors, assets].filter(Boolean).join('、') })
    }
    case 'editor.prop':
      return t('把 {o} 的 {p} 改成 {v}', {
        o: label || nameOf(str(def, 'object')),
        p: str(def, 'path'),
        v: clip(typeof def.value === 'string' ? def.value : JSON.stringify(def.value ?? null)),
      })
    case 'editor.spawn':
      return t('在关卡里放一个 {c}', { c: str(def, 'label') || nameOf(str(def, 'class')) })
    case 'editor.command':
      if (str(def, 'console')) return t('执行控制台命令 {c}', { c: clip(str(def, 'console'), 40) })
      return str(def, 'asset')
        ? t('在 {a} 里执行命令 {c}', { a: nameOf(str(def, 'asset')), c: str(def, 'name') })
        : t('执行编辑器命令 {c}', { c: str(def, 'name') })
    case 'editor.save':
      return listOf(def.assets).length ? t('保存 {a}', { a: names(def.assets) }) : t('保存全部改过的资源')
    case 'editor.compile':
      return t('编译 {a}', { a: label || nameOf(str(def, 'asset')) })
    case 'editor.click':
      return t('点编辑器界面上的 {w}', { w: label || widgetOf(def) })
    case 'editor.assert':
      if (str(def, 'check') === 'compiled') return t('检查 {a} 编译通过', { a: nameOf(str(def, 'asset')) })
      if (str(def, 'check') === 'saved') return t('检查 {a} 已保存', { a: nameOf(str(def, 'asset')) })
      if (str(def, 'check') === 'open') return t('检查 {a} 已打开', { a: nameOf(str(def, 'asset')) })
      return t('检查编辑器界面上有 {w}', { w: label || widgetOf(def) })
    default:
      return String(def.action ?? '')
  }
}

/** 「停靠页 · SButton「编译」」：和 C++ 那边 FGameTestEditorWidgetSpec::Describe 同一个说法 */
function widgetOf(def: Record<string, unknown>) {
  const where = str(def, 'tab') || (str(def, 'window') ? t('窗口「{w}」', { w: str(def, 'window') }) : t('编辑器'))
  const text = str(def, 'text')
  return `${where} · ${str(def, 'widget')}${text ? `「${text}」` : ''}`
}

/** 录制中每一行右边的来源标签 */
export function editorVia(def: Record<string, unknown>): string {
  switch (str(hintOf(def), 'via')) {
    case 'ui':
      return def.action === 'editor.command' ? t('命令') : t('界面点击')
    case 'pick':
      return t('Ctrl+Alt 点')
    case 'key':
      return t('快捷键')
    case 'event':
      if (def.action === 'editor.select') return t('选中事件')
      if (def.action === 'editor.prop') return t('属性改动')
      return t('资产事件')
    default:
      return def.action === 'editor.command' ? t('命令') : ''
  }
}

/** 界面点击时录制器找到的同名编辑器命令（suggest.commands）：点「换成命令」后回放不再依赖按钮在界面上的位置 */
export function commandSuggestion(def: Record<string, unknown>): { name: string; asset?: string } | undefined {
  if (def.action !== 'editor.click') return undefined
  const s = def.suggest && typeof def.suggest === 'object' ? (def.suggest as Record<string, unknown>) : undefined
  const name = listOf(s?.commands)[0]
  if (!name) return undefined
  const asset = typeof s?.asset === 'string' && s.asset ? s.asset : undefined
  return { name, asset }
}

/** 换成命令时要改的字段（交给 patchStep：undefined 的字段删掉），hint 记一笔原来是界面点击 */
export function toCommandPatch(def: Record<string, unknown>) {
  const c = commandSuggestion(def)
  if (!c) return undefined
  return {
    action: 'editor.command',
    name: c.name,
    asset: c.asset,
    tab: undefined,
    window: undefined,
    widget: undefined,
    text: undefined,
    nth: undefined,
    suggest: undefined,
    hint: { ...hintOf(def), via: 'ui', from: 'editor.click' },
  }
}

const clip = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n)}…` : s)
