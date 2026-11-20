import type { GtPropKind } from './types.ts'

/**
 * 算出状态（协议 3.2）：属性路径里 `:` 后面的名字。C++ 那边一种一个文件（IGameTestState），
 * 面板只要知道名字、kind（选比较用）和适用于什么，所以一张表就够；GameTest 加了新状态在这里加一行。
 * on：widget 控件、actor Actor 和场景组件、entry 列表条目、container 容器 / ListView 族、any 任何对象
 */
export interface GtStateDef {
  name: string
  kind: GtPropKind
  on: 'any' | 'widget' | 'actor' | 'entry' | 'container' | 'text' | 'checkbox' | 'image'
  /** 只用于显示、不建议当标识（面板标出来） */
  notIdent?: boolean
}

const s = (name: string, kind: GtPropKind, on: GtStateDef['on'], notIdent = false): GtStateDef =>
  notIdent ? { name, kind, on, notIdent } : { name, kind, on }

export const GT_STATES: GtStateDef[] = [
  s('exists', 'bool', 'any'),
  s('onScreen', 'bool', 'widget', true),
  s('shown', 'bool', 'widget', true),
  s('enabled', 'bool', 'widget', true),
  s('text', 'text', 'text'),
  s('textKey', 'string', 'text'),
  s('count', 'int', 'container', true),
  s('index', 'int', 'entry', true),
  s('selected', 'bool', 'entry', true),
  s('checked', 'enum', 'checkbox', true),
  s('image', 'asset', 'image'),
  s('hovered', 'bool', 'widget', true),
  s('focused', 'bool', 'widget', true),
  s('pos', 'vector2', 'widget', true),
  s('size', 'vector2', 'widget', true),
  s('location', 'vector', 'actor', true),
  s('distance', 'float', 'actor', true),
  s('hiddenInGame', 'bool', 'actor', true),
  s('class', 'object', 'any'),
  // 控件自己的运行时状态（只有 getter、没有属性可读的几种），v3 的 stateKey 迁移到这里
  s('selectedIndex', 'int', 'widget', true),
  s('selectedCount', 'int', 'container', true),
  s('scrollOffset', 'float', 'widget', true),
  s('open', 'bool', 'widget', true),
  s('selectedKey', 'string', 'widget', true),
  s('activeIndex', 'int', 'widget', true),
  s('expanded', 'bool', 'widget', true),
]

const byName = new Map(GT_STATES.map((x) => [x.name.toLowerCase(), x]))

/** 按名字找（路径段大小写不敏感） */
export const stateOf = (name: string) => byName.get(name.replace(/^:/, '').toLowerCase())

export function registerState(def: GtStateDef) {
  GT_STATES.push(def)
  byName.set(def.name.toLowerCase(), def)
}
