import { AppWindow, Box, Boxes, CodeXml, Component, type LucideIcon } from 'lucide-react'
import { t } from '../../../../host.ts'
import type { ClassKind } from './data.ts'

/** 类的图标：界面、Actor、组件、Lua 各一种，其余对象一种（类树、结构栏、实例栏一致） */
export const KIND_ICON: Record<ClassKind, LucideIcon> = {
  umg: AppWindow,
  actor: Boxes,
  component: Component,
  object: Box,
  lua: CodeXml,
}
export const kindLabel = (k: ClassKind) =>
  ({ umg: 'UMG', actor: 'Actor', component: t('组件'), object: 'UObject', lua: t('Lua 类') })[k]
