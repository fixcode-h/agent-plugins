/**
 * 蓝图图表：图里的节点、引脚和连线。节点标题在编辑器里是 C++ 的 GetNodeTitle() 现算的，文件里没有，
 * 这里按节点类和它引用的函数 / 变量 / 事件名拼一个近似的（设计文档第 4.5 节），所以和编辑器里看到的不一定逐字一样。
 */
import { childrenOf, shortName, type Asset } from './asset.ts'
import { prop, type UObj } from './objects.ts'
import type { RawPin } from './pins.ts'

export interface GNode {
  obj: UObj
  /** NodeGuid 前 8 位（和桥接 bp.graph 一样） */
  id: string
  guid: string
  title: string
  class: string
  comment: string
  x: number
  y: number
  pins: RawPin[]
}

export interface GLink {
  from: GNode
  fromPin: RawPin
  to: GNode
  toPin: RawPin
}

export interface GGraph {
  obj: UObj
  name: string
  kind: string
  nodes: GNode[]
  links: GLink[]
}

/** 驼峰拆成词：PrintString → Print String，K2_SetActorLocation → Set Actor Location */
export function pretty(name: string) {
  return name
    .replace(/^K2_/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
}

const memberName = (v: unknown) =>
  v && typeof v === 'object' ? String((v as Record<string, unknown>).memberName ?? '') : ''

const FIXED: Record<string, string> = {
  K2Node_IfThenElse: 'Branch',
  K2Node_ExecutionSequence: 'Sequence',
  K2Node_Knot: 'Reroute',
  K2Node_Self: 'Self',
  K2Node_FunctionResult: 'Return Node',
  K2Node_CreateWidget: 'Create Widget',
  K2Node_SpawnActorFromClass: 'SpawnActor',
  K2Node_SwitchString: 'Switch on String',
  K2Node_SwitchInteger: 'Switch on Int',
  K2Node_SwitchName: 'Switch on Name',
  K2Node_MakeArray: 'Make Array',
  K2Node_Select: 'Select',
}

function nodeTitle(a: Asset, o: UObj, graphName: string): string {
  const fixed = FIXED[o.class]
  if (fixed) return fixed
  switch (o.class) {
    case 'EdGraphNode_Comment':
      return String(prop(o, 'NodeComment') ?? 'Comment')
    case 'K2Node_CallFunction':
    case 'K2Node_CallParentFunction':
    case 'K2Node_CallArrayFunction':
    case 'K2Node_CommutativeAssociativeBinaryOperator':
      return pretty(memberName(prop(o, 'FunctionReference')) || 'Call Function')
    case 'K2Node_VariableGet':
      return pretty(memberName(prop(o, 'VariableReference')))
    case 'K2Node_VariableSet':
      return `Set ${pretty(memberName(prop(o, 'VariableReference')))}`
    case 'K2Node_Event': {
      const ev = memberName(prop(o, 'EventReference'))
      return `Event ${pretty(ev.replace(/^Receive/, ''))}`
    }
    case 'K2Node_CustomEvent':
      return String(prop(o, 'CustomFunctionName') ?? 'Custom Event')
    case 'K2Node_FunctionEntry':
      return pretty(graphName)
    case 'K2Node_MacroInstance': {
      const m = prop(o, 'MacroGraphReference') as Record<string, unknown> | undefined
      return pretty(shortName(m?.macroGraph) || 'Macro')
    }
    case 'K2Node_DynamicCast':
      return `Cast To ${shortName(prop(o, 'TargetType')).replace(/_C$/, '')}`
    case 'K2Node_EnhancedInputAction':
    case 'K2Node_InputAction':
      return shortName(prop(o, 'InputAction')) || String(prop(o, 'InputActionName') ?? 'Input Action')
    case 'K2Node_InputKey':
      return String((prop(o, 'InputKey') as Record<string, unknown> | undefined)?.keyName ?? 'Input Key')
    case 'K2Node_Timeline':
      return String(prop(o, 'TimelineName') ?? 'Timeline')
    default:
      return pretty(o.class.replace(/^(K2Node_|EdGraphNode_|AnimGraphNode_|MaterialGraphNode_?)/, '')) || o.class
  }
}

const guidOf = (o: UObj) => String(prop(o, 'NodeGuid') ?? '').toLowerCase()

/** 读一张图：节点按 Nodes 属性的顺序（没有就按导出顺序），连线由输出引脚的 LinkedTo 解出来 */
export function readGraph(a: Asset, g: UObj, kind: string): GGraph {
  const list = prop(g, 'Nodes')
  const objs = Array.isArray(list)
    ? list.map((p) => a.byPath.get(String(p))).filter((x): x is UObj => !!x)
    : childrenOf(a, g).filter((x) => x.pins)
  const nodes: GNode[] = objs.map((o) => {
    const guid = guidOf(o)
    return {
      obj: o,
      id: guid.slice(0, 8),
      guid,
      title: nodeTitle(a, o, g.name).replace(/\s*\n\s*/g, ' '),
      class: o.class,
      comment: o.class === 'EdGraphNode_Comment' ? '' : String(prop(o, 'NodeComment') ?? ''),
      x: Number(prop(o, 'NodePosX') ?? 0),
      y: Number(prop(o, 'NodePosY') ?? 0),
      pins: o.pins ?? [],
    }
  })
  const byRef = new Map(nodes.map((n) => [n.obj.ref, n]))
  const links: GLink[] = []
  for (const n of nodes)
    for (const p of n.pins) {
      if (p.direction !== 1) continue
      for (const l of p.linkedTo) {
        const to = byRef.get(l.node)
        const toPin = to?.pins.find((x) => x.id === l.pin)
        if (to && toPin) links.push({ from: n, fromPin: p, to, toPin })
      }
    }
  return { obj: g, name: g.name, kind, nodes, links }
}

export const isExec = (p: RawPin) => p.category === 'exec'

/** 没连线时引脚的默认值：对象给路径，文本给原文，其余给字符串（和桥接 PinDefault 一样） */
export const pinDefault = (p: RawPin) => p.defaultObject ?? (p.defaultText || p.defaultValue)
