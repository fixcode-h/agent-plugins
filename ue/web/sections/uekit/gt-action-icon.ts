import {
  Camera,
  CheckSquare,
  Clock,
  Footprints,
  Keyboard,
  type LucideIcon,
  MousePointer2,
  MousePointerClick,
  Move,
  Play,
  ScrollText,
  Square,
  Terminal,
  Type,
  Zap,
} from 'lucide-react'

/** 动作 → 小图标（步骤列表行首、流程图节点）：一眼分出点击、等待、按键，不用读动作名 */
export function actionIcon(a?: string): LucideIcon {
  switch (a) {
    case 'click':
    case 'select':
      return MousePointerClick
    case 'drag':
    case 'scroll':
    case 'wheel':
      return Move
    case 'input.cursor':
      return MousePointer2
    case 'key':
    case 'ability.input':
    case 'input.start':
    case 'input.stop':
      return Keyboard
    case 'type':
      return Type
    case 'wait':
    case 'editor.ensure':
      return Clock
    case 'assert':
    case 'probe':
    case 'net.compare':
      return CheckSquare
    case 'screenshot':
    case 'snapshot':
      return Camera
    case 'pie.start':
    case 'level.load':
      return Play
    case 'pie.stop':
      return Square
    case 'console':
      return Terminal
    case 'mark':
      return ScrollText
    case 'move':
      return Footprints
    default:
      return Zap
  }
}
