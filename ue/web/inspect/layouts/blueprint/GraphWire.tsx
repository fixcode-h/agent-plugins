import { memo } from 'react'
import { Background, BackgroundVariant, BaseEdge, Panel, type Edge, type EdgeProps } from '@xyflow/react'
import { t } from '../../../host.ts'
import { wirePath } from './ue-style.ts'
import { UE_CANVAS, UE_TEXT, UE_WIRE } from './ue-theme.ts'

export type WireData = { color: string; exec: boolean; hot: boolean; dim: boolean }

/**
 * UE 样式的连线：从输出右侧水平出、输入左侧水平进的贝塞尔（曲线算法在 ue-style.ts 的 wirePath），
 * 执行线白色较粗，数据线按类型色；和选中节点相关的线加粗，其余压暗
 */
export const UeWire = memo(function UeWire(p: EdgeProps<Edge<WireData>>) {
  const d = p.data!
  const [path] = wirePath(p.sourceX, p.sourceY, p.targetX, p.targetY)
  const base = d.exec ? UE_WIRE.exec : UE_WIRE.data
  return (
    <BaseEdge
      id={p.id}
      path={path}
      style={{
        stroke: d.color,
        strokeWidth: d.hot ? base * UE_WIRE.hotScale : base,
        opacity: d.dim ? UE_WIRE.dimOpacity : 1,
      }}
    />
  )
})

export const WIRE_TYPES = { ue: UeWire }

/**
 * UE 蓝图编辑器的深灰网格：细线每 16 单位、每 8 格一条更暗的粗线，跟着平移缩放走。
 * 用 xyflow 的 Background 画在共用画布里（叠在面板默认的点状底上面，bgColor 不透明把它盖住），不另造画布；
 * 右下角是 UE 的「BLUEPRINT」水印（英文界面大写成 BLUEPRINT；有小地图时往上让开）
 */
export function UeBackdrop() {
  const g = UE_CANVAS.gridSize
  return (
    <>
      <Background
        id="ue-grid"
        variant={BackgroundVariant.Lines}
        gap={g}
        lineWidth={1}
        color={UE_CANVAS.gridLine}
        bgColor={UE_CANVAS.bg}
      />
      <Background
        id="ue-rule"
        variant={BackgroundVariant.Lines}
        gap={g * UE_CANVAS.gridRuleEvery}
        lineWidth={1.5}
        color={UE_CANVAS.gridRule}
      />
      <Panel position="bottom-right" className="ue:pointer-events-none ue:select-none">
        {/* 让开小地图的边距放在字上：xyflow 给 Panel 的 margin 不在层里，会盖掉 Panel 上的工具类 */}
        <span
          className="ue:block ue:text-[34px] ue:font-black ue:tracking-[0.06em] ue:uppercase ue:@2xl:mb-36"
          style={{ color: UE_CANVAS.watermark, ...UE_TEXT }}
        >
          {t('蓝图')}
        </span>
      </Panel>
    </>
  )
}
