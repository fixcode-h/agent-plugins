import type { ComponentType } from 'react'
import { t } from '../../../host.ts'
import type { LayoutProps } from '../types.ts'
import type { UmgData } from './use-umg.ts'

/**
 * UMG 布局页头的视图切换（设计器 / 图表 / 配置原文 / 摘要与引用）。设计器是布局本身（控件树、预览、细节、时间轴几块区域），
 * 其余视图占满中间。视图按这张表画：别的视图（例如「标记视图」：把配置画成类似 XAML 的标签树）在自己的文件里写好组件，
 * 调 addUmgView 登记进来即可，不用改 UmgLayout。
 */
export interface UmgViewProps extends Pick<LayoutProps, 'path' | 'onOpen' | 'onChanged' | 'offline'> {
  data: UmgData
  /** 换到设计器并选中这个控件（视图里点了控件时用；key 是从根起的名字路径） */
  selectWidget: (key: string) => void
}

export interface UmgView {
  id: string
  label: () => string
  View: ComponentType<UmgViewProps>
  /** 什么时候列出（图表要 UE、配置原文要有配置或 UE 的控件树） */
  when?: (p: { offline?: boolean; data: UmgData }) => boolean
}

const views: UmgView[] = []

/** 登记一个视图；after 给了就插在那个视图后面，否则放最后 */
export function addUmgView(v: UmgView, after?: string) {
  const old = views.findIndex((x) => x.id === v.id)
  if (old >= 0) views.splice(old, 1)
  const i = after ? views.findIndex((x) => x.id === after) : -1
  views.splice(i >= 0 ? i + 1 : views.length, 0, v)
}

export const umgViews = () => views

/** 设计器自己的 id（不在表里，由布局直接画） */
export const DESIGNER = 'designer'
export const designerLabel = () => t('设计器')
